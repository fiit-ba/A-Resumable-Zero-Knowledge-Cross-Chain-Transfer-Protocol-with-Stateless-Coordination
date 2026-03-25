/**
 * Job service — orchestrates state transitions for relay jobs.
 *
 * Flow:
 *   POST /jobs        → createJob()     → awaiting_confirmation
 *   POST /confirm     → confirmJob()    → preparing_stage → ready_for_signature
 *   POST /receipts    → recordReceipt() → waiting_for_receipt → (preparing_stage | completed)
 */

import type { RelayProofStage } from "agent-shared";
import {
  getJob,
  updateJob,
  upsertCheckpoint,
  getCheckpoint
} from "../db.js";
import {
  canConfirm,
  canReceiveReceipt,
  isRefundState,
  isTerminal,
  nextStage,
  STAGE_ORDER
} from "../domain/job-states.js";
import {
  getResumeDecision,
  runPrepareStage
} from "../integrations/stateless-client/index.js";

// ---------------------------------------------------------------------------
// Stage preparation
// ---------------------------------------------------------------------------

async function runStagePreparation(jobId: string, stage: RelayProofStage): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  // Resume: if checkpoint already exists and not yet completed, surface it
  const existing = getCheckpoint(jobId, stage);
  if (existing && !existing.completedAt) {
    updateJob(jobId, { status: "ready_for_signature", currentStage: stage });
    return;
  }

  updateJob(jobId, { status: "preparing_stage", currentStage: stage });

  try {
    const { payload, verification } = await runPrepareStage(
      job.intent,
      job.txId,
      stage
    );

    const enrichedPayload = {
      ...payload,
      verificationMode: verification.mode,
      verificationDegraded: verification.degraded,
      verifiedStage: verification.stage
    };

    const verificationSummary = {
      mode: verification.mode,
      degraded: verification.degraded,
      verifiedStage: verification.stage
    };

    upsertCheckpoint({
      jobId,
      stage,
      payloadJson: JSON.stringify(enrichedPayload),
      verificationJson: JSON.stringify(verification)
    });

    updateJob(jobId, {
      status: "ready_for_signature",
      currentStage: stage,
      verificationSummary,
      lastError: null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[job-service] stage preparation failed for ${jobId} (${stage}): ${message}`
    );
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    updateJob(jobId, { status: "failed", lastError: message });
  }
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

/**
 * Confirms a pending job and kicks off stage preparation.
 * Returns the updated job or throws if the job is not in a confirmable state.
 */
export async function confirmJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (isTerminal(job.status)) {
    throw new Error(`Job ${jobId} is in terminal state ${job.status} and cannot be confirmed.`);
  }

  if (!canConfirm(job.status)) {
    throw new Error(
      `Job ${jobId} cannot be confirmed in state ${job.status}. Expected awaiting_confirmation or failed.`
    );
  }

  // Determine which stage to start
  let repoRoot: string;
  try {
    const { discoverRepoRoot } = await import("stateless-client");
    repoRoot = discoverRepoRoot(process.cwd());
    void repoRoot; // existence check only
  } catch {
    updateJob(jobId, {
      status: "failed",
      lastError:
        "Cannot locate repository root. Run from inside the repo or pass --repo-root."
    });
    return;
  }

  // Read chain statuses to decide which stage to prepare
  let decision;
  try {
    decision = await getResumeDecision(job.intent, job.txId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", lastError: message });
    return;
  }

  updateJob(jobId, {
    sourceStatus: decision.sourceStatus,
    destinationStatus: decision.destinationStatus
  });

  if (isRefundState(decision.sourceStatus, decision.destinationStatus)) {
    updateJob(jobId, {
      status: "unsupported",
      lastError: `Refund state (srcStatus=${decision.sourceStatus}, dstStatus=${decision.destinationStatus}). Manual recovery required.`
    });
    return;
  }

  if (decision.action === "noop") {
    updateJob(jobId, { status: "completed", currentStage: "completed" });
    return;
  }

  if (decision.action === "error") {
    updateJob(jobId, { status: "failed", lastError: decision.reason });
    return;
  }

  const stage = decision.action as RelayProofStage;

  // Fire-and-forget — HTTP handler already returned 202
  runStagePreparation(jobId, stage).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] stage preparation error for ${jobId}: ${message}`);
  });
}

/**
 * Records a browser-submitted relay receipt and advances the job to the next stage.
 */
export function recordReceipt(
  jobId: string,
  stage: RelayProofStage,
  txHash: string
): void {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (!canReceiveReceipt(job.status)) {
    throw new Error(
      `Job ${jobId} cannot accept a receipt in state ${job.status}. Expected ready_for_signature.`
    );
  }

  // Mark this stage complete
  updateJob(jobId, { status: "waiting_for_receipt" });

  upsertCheckpoint({
    jobId,
    stage,
    payloadJson: getCheckpoint(jobId, stage)?.payloadJson ?? "{}",
    verificationJson: getCheckpoint(jobId, stage)?.verificationJson,
    completedAt: Date.now(),
    submissionTxHash: txHash
  });

  updateJob(jobId, { latestSubmissionTxHash: txHash });

  const next = nextStage(stage);
  if (next === "completed") {
    updateJob(jobId, { status: "completed", currentStage: "completed" });
    return;
  }

  // Advance to next stage — fire-and-forget
  updateJob(jobId, { currentStage: next, status: "awaiting_confirmation" });
  runStagePreparation(jobId, next).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] next-stage error for ${jobId} stage ${next}: ${message}`);
  });
}
