/**
 * Job service — orchestrates state transitions for relay jobs.
 *
 * Flow:
 *   POST /jobs        → createJob()     → awaiting_confirmation
 *   POST /confirm     → confirmJob()    → preparing_stage → ready_for_signature
 *   POST /receipts    → recordReceipt() → waiting_for_receipt → (preparing_stage | completed)
 */

import type { RelayJob, RelayProofStage, TransferIntent } from "../contracts.js";
import {
  createJob,
  getJob,
  getJobByTxId,
  getJobRecoveryMetadata,
  setJobRecoveryMetadata,
  updateJob,
  upsertCheckpoint,
  getCheckpoint,
} from "../db.js";
import { canConfirm, canReceiveReceipt, DIRECT_STAGES, isTerminal } from "../domain/job-states.js";
import {
  buildDirectPayload,
  discoverTransferByTxId,
  getResumeDecision,
  resolveRepoRoot,
  runPrepareStage,
  shouldUsePrunedAckVerification,
} from "../integrations/relay.js";
import type {
  NetworkProfileName,
  StageVerificationHints,
  TransferDiscoveryMatch,
} from "../integrations/relay.js";
import type { RecoveryCandidate } from "../types.js";
import type { Stage } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Stage preparation
// ---------------------------------------------------------------------------

const CHECKPOINT_PROOF_STAGES: RelayProofStage[] = [
  "lock",
  "mint",
  "ack",
  "refund-claim",
  "burn-proof",
];

const VERIFIED_STAGE_VALUES: Stage[] = [
  "source-deposit",
  "destination-funds-released",
  "source-ack-ready",
  "source-refund-initiated",
  "destination-burn-executed",
];

function isVerifiedStage(value: unknown): value is Stage {
  return typeof value === "string" && VERIFIED_STAGE_VALUES.includes(value as Stage);
}

function collectPriorProofStageVerifications(
  jobId: string,
): NonNullable<StageVerificationHints["priorProofStageVerifications"]> {
  const entries: NonNullable<StageVerificationHints["priorProofStageVerifications"]> = [];

  for (const stage of CHECKPOINT_PROOF_STAGES) {
    const checkpoint = getCheckpoint(jobId, stage);
    if (!checkpoint?.verificationJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(checkpoint.verificationJson) as {
        mode?: unknown;
        degraded?: unknown;
        verifiedStage?: unknown;
      };
      if (
        !isVerifiedStage(parsed.verifiedStage) ||
        (parsed.mode !== "colibri" && parsed.mode !== "rpc-fallback") ||
        typeof parsed.degraded !== "boolean"
      ) {
        continue;
      }

      entries.push({
        stage: parsed.verifiedStage,
        mode: parsed.mode,
        degraded: parsed.degraded,
      });
    } catch {
      // Ignore malformed historical checkpoint payloads.
    }
  }

  return entries;
}

function buildStageVerificationHints(
  jobId: string,
  stage: RelayProofStage,
  decision?: Awaited<ReturnType<typeof getResumeDecision>>,
): StageVerificationHints | undefined {
  const priorProofStageVerifications = collectPriorProofStageVerifications(jobId);
  const hints: StageVerificationHints = {};

  if (priorProofStageVerifications.length > 0) {
    hints.priorProofStageVerifications = priorProofStageVerifications;
  }

  if (
    stage === "ack" &&
    decision &&
    shouldUsePrunedAckVerification(decision.sourceStatus, decision.destinationStatus)
  ) {
    hints.ackVariant = "pruned-source-origin";
  }

  if (!hints.ackVariant && !hints.priorProofStageVerifications) {
    return undefined;
  }
  return hints;
}

async function runStagePreparation(
  jobId: string,
  stage: RelayProofStage,
  decision?: Awaited<ReturnType<typeof getResumeDecision>>,
): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  // Resume: if checkpoint already exists and not yet completed, surface it
  const existing = getCheckpoint(jobId, stage);
  if (existing && !existing.completedAt) {
    updateJob(jobId, { status: "ready_for_signature", currentStage: stage });
    return;
  }

  updateJob(jobId, { status: "preparing_stage", currentStage: stage });

  // Thread execution blocks from recovery metadata (if this is a recovered job).
  const recoveryMeta = getJobRecoveryMetadata(jobId);
  const executionBlocks = recoveryMeta?.executionBlocks;
  const verificationHints = buildStageVerificationHints(jobId, stage, decision);

  try {
    let enrichedPayload: Record<string, unknown>;
    let verificationSummary: Record<string, unknown> | undefined;

    if (DIRECT_STAGES.has(stage)) {
      // Direct action: no proof generation needed — build payload immediately.
      const payload = buildDirectPayload(
        job.intent,
        job.txId,
        stage as "refund-initiate" | "execute-burn",
        executionBlocks,
      );
      enrichedPayload = { ...payload };
      verificationSummary = undefined;
    } else {
      // Proof stage: run full preparation pipeline.
      const { payload, verification } = await runPrepareStage(
        job.intent,
        job.txId,
        stage,
        executionBlocks,
        verificationHints,
      );
      enrichedPayload = {
        ...payload,
        verificationMode: verification?.mode,
        verificationDegraded: verification?.degraded,
        verificationDegradeReason: verification?.degradeReason,
        verifiedStage: verification?.stage,
      };
      verificationSummary = verification
        ? {
            mode: verification.mode,
            degraded: verification.degraded,
            degradeReason: verification.degradeReason,
            verifiedStage: verification.stage,
          }
        : undefined;
    }

    upsertCheckpoint({
      jobId,
      stage,
      payloadJson: JSON.stringify(enrichedPayload),
      verificationJson: verificationSummary ? JSON.stringify(verificationSummary) : undefined,
    });

    updateJob(jobId, {
      status: "ready_for_signature",
      currentStage: stage,
      verificationSummary: verificationSummary as Parameters<
        typeof updateJob
      >[1]["verificationSummary"],
      lastError: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] stage preparation failed for ${jobId} (${stage}): ${message}`);
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
      `Job ${jobId} cannot be confirmed in state ${job.status}. Expected awaiting_confirmation or failed.`,
    );
  }

  // Verify repo root is reachable
  try {
    await resolveRepoRoot();
  } catch {
    updateJob(jobId, {
      status: "failed",
      lastError: "Cannot locate repository root. Run from inside the repo or pass --repo-root.",
    });
    return;
  }

  // Read chain statuses to decide which stage to prepare
  const recoveryMeta = getJobRecoveryMetadata(jobId);
  let decision;
  try {
    decision = await getResumeDecision(job.intent, job.txId, recoveryMeta?.executionBlocks);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", lastError: message });
    return;
  }

  updateJob(jobId, {
    sourceStatus: decision.sourceStatus,
    destinationStatus: decision.destinationStatus,
  });

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
  runStagePreparation(jobId, stage, decision).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] stage preparation error for ${jobId}: ${message}`);
  });
}

/**
 * Records a browser-submitted relay receipt and advances the job to the next
 * stage using the planner (not a fixed stage sequence).
 */
export function recordReceipt(jobId: string, stage: RelayProofStage, txHash: string): void {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (!canReceiveReceipt(job.status)) {
    throw new Error(
      `Job ${jobId} cannot accept a receipt in state ${job.status}. Expected ready_for_signature.`,
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
    submissionTxHash: txHash,
  });

  updateJob(jobId, { latestSubmissionTxHash: txHash });

  // Planner-driven: consult chain state to find the next action
  advanceToNextStage(jobId).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] next-stage advance error for ${jobId}: ${message}`);
  });
}

async function advanceToNextStage(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  const recoveryMeta = getJobRecoveryMetadata(jobId);
  let decision;
  try {
    decision = await getResumeDecision(job.intent, job.txId, recoveryMeta?.executionBlocks);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", lastError: message });
    return;
  }

  updateJob(jobId, {
    sourceStatus: decision.sourceStatus,
    destinationStatus: decision.destinationStatus,
  });

  if (decision.action === "noop") {
    updateJob(jobId, { status: "completed", currentStage: "completed" });
    return;
  }

  if (decision.action === "error") {
    updateJob(jobId, { status: "failed", lastError: decision.reason });
    return;
  }

  const next = decision.action as RelayProofStage;
  updateJob(jobId, { currentStage: next, status: "awaiting_confirmation" });
  runStagePreparation(jobId, next, decision).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] next-stage error for ${jobId} stage ${next}: ${message}`);
  });
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export type RecoverJobResult =
  | { type: "created"; job: RelayJob }
  | { type: "resumed"; job: RelayJob }
  | { type: "ambiguous"; candidates: RecoveryCandidate[] };

/**
 * Reconstructs a relay job for a given txId by scanning on-chain evidence.
 *
 * - Returns `{ type: "resumed" }` if a local job already exists for the txId.
 * - Returns `{ type: "ambiguous" }` (409) when multiple source candidates are
 *   found and profile hints aren't specific enough.
 * - Throws when no on-chain evidence is found (404 case).
 * - Returns `{ type: "created" }` on successful discovery + job creation.
 */
export async function recoverJob(
  txId: string,
  sourceProfileHint?: string,
  destinationProfileHint?: string,
): Promise<RecoverJobResult> {
  // Fast path: local DB already has a record.
  const existing = getJobByTxId(txId);
  if (existing) return { type: "resumed", job: existing };

  // Build profile scan list; if hints provided, limit scan to only those two
  // profiles (fast disambiguation after a previous 409 response).
  const profileHints =
    sourceProfileHint || destinationProfileHint
      ? ([sourceProfileHint, destinationProfileHint].filter(Boolean) as NetworkProfileName[])
      : undefined;

  const result = await discoverTransferByTxId(txId, { profileHints });

  if (result.matches.length === 0) {
    throw new Error(
      `No on-chain evidence found for txId ${txId} across ${result.scannedProfiles.join(", ") || "all profiles"}.`,
    );
  }

  if (result.matches.length > 1) {
    const candidates: RecoveryCandidate[] = result.matches.map((m) => ({
      sourceProfile: m.sourceProfile,
      sourceConnector: m.sourceConnector,
      destinationProfile: m.destinationProfile,
      destinationConnector: m.destinationConnector,
      sourceStatus: m.sourceStatus,
      destinationStatus: m.destinationStatus,
    }));
    return { type: "ambiguous", candidates };
  }

  const match: TransferDiscoveryMatch = result.matches[0];

  const intent: TransferIntent = {
    sourceProfile: match.sourceProfile,
    destinationProfile: match.destinationProfile,
    sourceConnector: match.sourceConnector,
    destinationConnector: match.destinationConnector,
    tokenFrom: match.transferData?.tokenFrom ?? "",
    tokenTo: match.transferData?.tokenTo ?? "",
    amount: match.transferData?.amount?.toString() ?? "0",
    receiver: match.transferData?.receiver ?? "",
  };

  const job = createJob(intent, txId);

  setJobRecoveryMetadata(job.id, {
    discoveredAt: Date.now(),
    sourceProfile: match.sourceProfile,
    destinationProfile: match.destinationProfile,
    sourceConnector: match.sourceConnector,
    destinationConnector: match.destinationConnector,
    executionBlocks: match.executionBlocks,
    historyHints: match.historyHints,
  });

  return { type: "created", job };
}
