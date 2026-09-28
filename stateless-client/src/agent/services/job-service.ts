/**
 * Job service — orchestrates state transitions for relay jobs.
 *
 * Flow:
 *   POST /jobs        → createJob()     → awaiting_confirmation
 *   POST /confirm     → confirmJob()    → preparing_stage → ready_for_signature
 *   POST /receipts    → recordReceipt() → waiting_for_receipt → (preparing_stage | completed)
 */

import type {
  EnrichedStagePayload,
  PlannerAction,
  PostSubmitBehavior,
  RelayJob,
  RelayMode,
  RelayProofStage,
  StageDetails,
  TransferIntent,
  VerificationSummary,
} from "../contracts.js";
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
import {
  canConfirm,
  canReceiveReceipt,
  DIRECT_STAGES,
  isTerminal,
  PROOF_STAGES,
} from "../domain/job-states.js";
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
import type { ResumeDecision, StageVerificationHistoryEntry } from "../../core/types.js";
import { errorMessage } from "../../core/utils.js";
import { isRelayStage, isVerifyStage } from "../../relay/stages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireJob(jobId: string): RelayJob {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return job;
}

function failJob(jobId: string, lastError: string): void {
  updateJob(jobId, { status: "failed", lastError });
}

/** Runs a detached task, logging (not throwing) any failure. The HTTP layer has already replied. */
function runInBackground(label: string, task: Promise<void>): void {
  task.catch((err: unknown) => {
    console.error(`[job-service] ${label}: ${errorMessage(err)}`);
  });
}

function plannerActionToStage(action: PlannerAction): RelayProofStage | undefined {
  return isRelayStage(action) ? action : undefined;
}

function plannerReasonWithMismatch(
  plannerAction: PlannerAction,
  plannerReason: string,
  requestedStage: RelayProofStage,
  force?: boolean,
): string {
  if (plannerAction === requestedStage) {
    return plannerReason;
  }
  const base = `Planner recommends '${plannerAction}' (${plannerReason}).`;
  if (force) {
    return `${base} Preparing '${requestedStage}' with force=true.`;
  }
  return `${base} Requested '${requestedStage}' without force override.`;
}

function collectPriorProofStageVerifications(jobId: string): StageVerificationHistoryEntry[] {
  const entries: StageVerificationHistoryEntry[] = [];

  for (const stage of PROOF_STAGES) {
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
        !isVerifyStage(parsed.verifiedStage) ||
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
  decision?: ResumeDecision,
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

async function ensureRepoRootAvailable(jobId: string): Promise<boolean> {
  try {
    await resolveRepoRoot();
    return true;
  } catch {
    failJob(jobId, "Cannot locate repository root. Run from inside the repo or pass --repo-root.");
    return false;
  }
}

function readPlannerDecision(job: RelayJob): Promise<ResumeDecision> {
  const recoveryMeta = getJobRecoveryMetadata(job.id);
  return getResumeDecision(job.intent, job.txId, recoveryMeta?.executionBlocks);
}

/** Reads the planner decision, marking the job failed (and returning undefined) on RPC errors. */
async function readPlannerDecisionOrFail(job: RelayJob): Promise<ResumeDecision | undefined> {
  try {
    return await readPlannerDecision(job);
  } catch (err) {
    failJob(job.id, errorMessage(err));
    return undefined;
  }
}

function persistPlannerDecision(
  jobId: string,
  decision: ResumeDecision,
  plannerReason: string = decision.reason,
): void {
  updateJob(jobId, {
    sourceStatus: decision.sourceStatus,
    destinationStatus: decision.destinationStatus,
    plannerAction: decision.action,
    plannerReason,
  });
}

/**
 * Settles the job when the planner reports `noop` (completed) or `error` (failed);
 * otherwise returns the stage the planner wants to run next.
 */
function plannedStageOrSettle(
  jobId: string,
  decision: ResumeDecision,
): RelayProofStage | undefined {
  if (decision.action === "noop") {
    updateJob(jobId, { status: "completed", currentStage: "completed" });
    return undefined;
  }
  if (decision.action === "error") {
    failJob(jobId, decision.reason);
    return undefined;
  }
  return decision.action;
}

async function runStagePreparation(
  jobId: string,
  stage: RelayProofStage,
  decision?: ResumeDecision,
  opts?: {
    regenerate?: boolean;
  },
): Promise<void> {
  const job = requireJob(jobId);

  // Resume: reuse an existing checkpoint payload whenever one is present.
  // We intentionally reuse even when completedAt is set (i.e. the user already submitted this
  // stage once). Proof payloads are stable for a given txId — if the on-chain submission failed
  // and the planner re-queues the same stage, re-running the proof host against an increasingly
  // old event block risks hitting "historical state not available" on public non-archive RPCs.
  // Explicit regeneration is still possible via opts.regenerate.
  const existing = getCheckpoint(jobId, stage);
  if (existing?.payloadJson && !opts?.regenerate) {
    updateJob(jobId, { status: "ready_for_signature", currentStage: stage });
    return;
  }

  updateJob(jobId, { status: "preparing_stage", currentStage: stage });

  // Thread execution blocks from recovery metadata (if this is a recovered job).
  const executionBlocks = getJobRecoveryMetadata(jobId)?.executionBlocks;

  try {
    let enrichedPayload: EnrichedStagePayload;
    let verificationSummary: VerificationSummary | undefined;

    if (DIRECT_STAGES.has(stage)) {
      // Direct action: no proof generation needed — build payload immediately.
      enrichedPayload = buildDirectPayload(
        job.intent,
        job.txId,
        stage as "refund-initiate" | "execute-burn",
        executionBlocks,
      );
    } else {
      const { payload, verification } = await runPrepareStage(
        job.intent,
        job.txId,
        stage,
        executionBlocks,
        buildStageVerificationHints(jobId, stage, decision),
      );
      enrichedPayload = {
        ...payload,
        verificationMode: verification?.mode,
        verificationDegraded: verification?.degraded,
        verificationDegradeReason: verification?.degradeReason,
        verifiedStage: verification?.stage,
      };
      verificationSummary = verification && {
        mode: verification.mode,
        degraded: verification.degraded,
        degradeReason: verification.degradeReason,
        verifiedStage: verification.stage,
      };
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
      verificationSummary,
      lastError: null,
    });
  } catch (err) {
    const message = errorMessage(err);
    console.error(`[job-service] stage preparation failed for ${jobId} (${stage}): ${message}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    failJob(jobId, message);
  }
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

export interface UpdateJobSettingsInput {
  relayMode?: RelayMode;
  postSubmitBehavior?: PostSubmitBehavior;
}

export interface PrepareJobStageOptions {
  stage?: RelayProofStage;
  force?: boolean;
  regenerate?: boolean;
}

export function updateJobSettings(jobId: string, input: UpdateJobSettingsInput): RelayJob {
  requireJob(jobId);

  updateJob(jobId, {
    relayMode: input.relayMode,
    postSubmitBehavior: input.postSubmitBehavior,
  });

  return requireJob(jobId);
}

export async function refreshJob(jobId: string): Promise<RelayJob> {
  const decision = await readPlannerDecision(requireJob(jobId));
  persistPlannerDecision(jobId, decision);
  return requireJob(jobId);
}

/**
 * Prepares the requested stage, or the planner's recommendation when none is given.
 * A requested stage that differs from the planner's is still prepared; the
 * mismatch is recorded in `plannerReason`.
 */
export async function prepareJobStage(
  jobId: string,
  options: PrepareJobStageOptions = {},
): Promise<void> {
  const job = requireJob(jobId);

  if (isTerminal(job.status)) {
    throw new Error(`Job ${jobId} is in terminal state ${job.status} and cannot prepare stages.`);
  }

  if (!(await ensureRepoRootAvailable(jobId))) {
    return;
  }

  const decision = await readPlannerDecisionOrFail(job);
  if (!decision) return;

  const requestedStage = options.stage ?? plannerActionToStage(decision.action);
  persistPlannerDecision(
    jobId,
    decision,
    requestedStage
      ? plannerReasonWithMismatch(decision.action, decision.reason, requestedStage, options.force)
      : decision.reason,
  );

  if (!requestedStage) {
    plannedStageOrSettle(jobId, decision);
    return;
  }

  runInBackground(
    `manual prepare error for ${jobId} stage ${requestedStage}`,
    runStagePreparation(jobId, requestedStage, decision, { regenerate: options.regenerate }),
  );
}

/**
 * Confirms a pending job and kicks off stage preparation.
 * Throws if the job is not in a confirmable state.
 */
export async function confirmJob(jobId: string): Promise<void> {
  const job = requireJob(jobId);

  if (isTerminal(job.status)) {
    throw new Error(`Job ${jobId} is in terminal state ${job.status} and cannot be confirmed.`);
  }

  if (!canConfirm(job.status)) {
    throw new Error(
      `Job ${jobId} cannot be confirmed in state ${job.status}. Expected awaiting_confirmation or failed.`,
    );
  }

  if (!(await ensureRepoRootAvailable(jobId))) {
    return;
  }

  const decision = await readPlannerDecisionOrFail(job);
  if (!decision) return;

  persistPlannerDecision(jobId, decision);

  const stage = plannedStageOrSettle(jobId, decision);
  if (!stage) return;

  // Fire-and-forget — HTTP handler already returned 202
  runInBackground(
    `stage preparation error for ${jobId}`,
    runStagePreparation(jobId, stage, decision),
  );
}

/**
 * Records a browser-submitted relay receipt and advances the job to the next
 * stage using the planner (not a fixed stage sequence).
 */
export function recordReceipt(jobId: string, stage: RelayProofStage, txHash: string): void {
  const job = requireJob(jobId);

  if (!canReceiveReceipt(job.status)) {
    throw new Error(
      `Job ${jobId} cannot accept a receipt in state ${job.status}. Expected ready_for_signature.`,
    );
  }

  // A receipt must follow a prepared payload. Otherwise the stage would be left with an
  // empty checkpoint that later preparation would mistake for a prepared payload.
  const checkpoint = getCheckpoint(jobId, stage);
  if (!checkpoint) {
    throw new Error(
      `Job ${jobId} has no prepared payload for stage '${stage}'. Prepare the stage before recording a receipt.`,
    );
  }

  updateJob(jobId, { status: "waiting_for_receipt" });

  // Mark this stage complete
  upsertCheckpoint({
    jobId,
    stage,
    payloadJson: checkpoint.payloadJson,
    verificationJson: checkpoint.verificationJson,
    completedAt: Date.now(),
    submissionTxHash: txHash,
  });

  updateJob(jobId, { latestSubmissionTxHash: txHash });

  // Planner-driven: consult chain state to find the next action
  runInBackground(`post-receipt advance error for ${jobId}`, processPostReceipt(jobId));
}

async function processPostReceipt(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  const decision = await readPlannerDecisionOrFail(job);
  if (!decision) return;

  persistPlannerDecision(jobId, decision);

  const latest = getJob(jobId);
  if (!latest) return;

  const next = plannedStageOrSettle(jobId, decision);
  if (!next) return;

  updateJob(jobId, { currentStage: next, status: "awaiting_confirmation" });

  // Manual mode with "pause" waits for the user to confirm the next stage.
  if (latest.relayMode === "manual" && latest.postSubmitBehavior === "pause") {
    return;
  }

  runInBackground(
    `stage-preparation error for ${jobId} stage ${next}`,
    runStagePreparation(jobId, next, decision),
  );
}

export function getStageDetails(jobId: string, stage: RelayProofStage): StageDetails {
  const job = requireJob(jobId);

  const plannerFields = {
    stage,
    plannerAction: job.plannerAction,
    plannerReason: job.plannerReason,
    plannerMismatch: Boolean(job.plannerAction && job.plannerAction !== stage),
  };

  const checkpoint = getCheckpoint(jobId, stage);
  if (!checkpoint) {
    return { ...plannerFields, checkpointState: "missing" };
  }

  return {
    ...plannerFields,
    checkpointState: checkpoint.completedAt ? "submitted" : "prepared",
    preparedPayload: parseJsonOrUndefined<EnrichedStagePayload>(checkpoint.payloadJson),
    verificationSummary: parseJsonOrUndefined<VerificationSummary>(checkpoint.verificationJson),
    submissionTxHash: checkpoint.submissionTxHash,
    completedAt: checkpoint.completedAt,
  };
}

function parseJsonOrUndefined<T>(json: string | undefined): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
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
