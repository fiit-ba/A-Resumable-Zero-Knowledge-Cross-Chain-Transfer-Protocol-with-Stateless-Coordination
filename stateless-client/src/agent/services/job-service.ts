/**
 * Job service — orchestrates state transitions for relay jobs.
 *
 * Flow:
 *   POST /jobs        → createJob()     → awaiting_confirmation
 *   POST /confirm     → confirmJob()    → preparing_stage → ready_for_signature
 *   POST /receipts    → recordReceipt() → waiting_for_receipt → (preparing_stage | completed)
 */

import type {
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
import { ALL_RELAY_STAGES, RELAY_STAGE_REGISTRY } from "../../relay/stages.js";

// ---------------------------------------------------------------------------
// Stage preparation — stage lists derived from the canonical registry
// ---------------------------------------------------------------------------

const CHECKPOINT_PROOF_STAGES: RelayProofStage[] = ALL_RELAY_STAGES.filter(
  (s) => RELAY_STAGE_REGISTRY[s].actionKind === "proof",
);

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

function isRelayProofStage(value: unknown): value is RelayProofStage {
  return typeof value === "string" && ALL_RELAY_STAGES.includes(value as RelayProofStage);
}

function plannerActionToStage(action: PlannerAction): RelayProofStage | undefined {
  return isRelayProofStage(action) ? action : undefined;
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

async function ensureRepoRootAvailable(jobId: string): Promise<boolean> {
  try {
    await resolveRepoRoot();
    return true;
  } catch {
    updateJob(jobId, {
      status: "failed",
      lastError: "Cannot locate repository root. Run from inside the repo or pass --repo-root.",
    });
    return false;
  }
}

async function readPlannerDecision(job: RelayJob): Promise<Awaited<ReturnType<typeof getResumeDecision>>> {
  const recoveryMeta = getJobRecoveryMetadata(job.id);
  return getResumeDecision(job.intent, job.txId, recoveryMeta?.executionBlocks);
}

function persistPlannerDecision(
  jobId: string,
  decision: Awaited<ReturnType<typeof getResumeDecision>>,
  overrides?: {
    plannerReason?: string;
  },
): void {
  updateJob(jobId, {
    sourceStatus: decision.sourceStatus,
    destinationStatus: decision.destinationStatus,
    plannerAction: decision.action,
    plannerReason: overrides?.plannerReason ?? decision.reason,
  });
}

async function runStagePreparation(
  jobId: string,
  stage: RelayProofStage,
  decision?: Awaited<ReturnType<typeof getResumeDecision>>,
  opts?: {
    regenerate?: boolean;
  },
): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

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
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  updateJob(jobId, {
    relayMode: input.relayMode,
    postSubmitBehavior: input.postSubmitBehavior,
  });

  return getJob(jobId)!;
}

export async function refreshJob(jobId: string): Promise<RelayJob> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const decision = await readPlannerDecision(job);
  persistPlannerDecision(jobId, decision);
  return getJob(jobId)!;
}

export async function prepareJobStage(
  jobId: string,
  options: PrepareJobStageOptions = {},
): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (isTerminal(job.status)) {
    throw new Error(`Job ${jobId} is in terminal state ${job.status} and cannot prepare stages.`);
  }

  if (!(await ensureRepoRootAvailable(jobId))) {
    return;
  }

  let decision: Awaited<ReturnType<typeof getResumeDecision>>;
  try {
    decision = await readPlannerDecision(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", lastError: message });
    return;
  }

  const plannerStage = plannerActionToStage(decision.action);
  const requestedStage = options.stage ?? plannerStage;
  const plannerReason = requestedStage
    ? plannerReasonWithMismatch(decision.action, decision.reason, requestedStage, options.force)
    : decision.reason;
  persistPlannerDecision(jobId, decision, { plannerReason });

  if (!requestedStage) {
    if (decision.action === "noop") {
      updateJob(jobId, { status: "completed", currentStage: "completed" });
      return;
    }
    updateJob(jobId, { status: "failed", lastError: decision.reason });
    return;
  }

  runStagePreparation(jobId, requestedStage, decision, {
    regenerate: options.regenerate,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] manual prepare error for ${jobId} stage ${requestedStage}: ${message}`);
  });
}

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

  if (!(await ensureRepoRootAvailable(jobId))) {
    return;
  }

  let decision: Awaited<ReturnType<typeof getResumeDecision>>;
  try {
    decision = await readPlannerDecision(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", lastError: message });
    return;
  }

  persistPlannerDecision(jobId, decision);

  if (decision.action === "noop") {
    updateJob(jobId, { status: "completed", currentStage: "completed" });
    return;
  }

  if (decision.action === "error") {
    updateJob(jobId, { status: "failed", lastError: decision.reason });
    return;
  }

  const stage = plannerActionToStage(decision.action);
  if (!stage) {
    updateJob(jobId, { status: "failed", lastError: decision.reason });
    return;
  }

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
  processPostReceipt(jobId).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] post-receipt advance error for ${jobId}: ${message}`);
  });
}

async function processPostReceipt(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  let decision: Awaited<ReturnType<typeof getResumeDecision>>;
  try {
    decision = await readPlannerDecision(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", lastError: message });
    return;
  }

  persistPlannerDecision(jobId, decision);

  const latest = getJob(jobId);
  if (!latest) return;

  if (decision.action === "noop") {
    updateJob(jobId, { status: "completed", currentStage: "completed" });
    return;
  }

  if (decision.action === "error") {
    updateJob(jobId, { status: "failed", lastError: decision.reason });
    return;
  }

  if (latest.relayMode === "manual" && latest.postSubmitBehavior === "pause") {
    const pausedNext = plannerActionToStage(decision.action);
    updateJob(jobId, {
      status: "awaiting_confirmation",
      currentStage: pausedNext ?? latest.currentStage,
    });
    return;
  }

  const next = plannerActionToStage(decision.action);
  if (!next) {
    updateJob(jobId, { status: "failed", lastError: decision.reason });
    return;
  }

  updateJob(jobId, { currentStage: next, status: "awaiting_confirmation" });

  runStagePreparation(jobId, next, decision).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job-service] stage-preparation error for ${jobId} stage ${next}: ${message}`);
  });
}

export function getStageDetails(jobId: string, stage: RelayProofStage): StageDetails {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const checkpoint = getCheckpoint(jobId, stage);
  if (!checkpoint) {
    return {
      stage,
      checkpointState: "missing",
      plannerAction: job.plannerAction,
      plannerReason: job.plannerReason,
      plannerMismatch: Boolean(job.plannerAction && job.plannerAction !== stage),
    };
  }

  let preparedPayload: StageDetails["preparedPayload"];
  let verificationSummary: VerificationSummary | undefined;
  try {
    preparedPayload = JSON.parse(checkpoint.payloadJson) as StageDetails["preparedPayload"];
  } catch {
    preparedPayload = undefined;
  }
  if (checkpoint.verificationJson) {
    try {
      verificationSummary = JSON.parse(checkpoint.verificationJson) as VerificationSummary;
    } catch {
      verificationSummary = undefined;
    }
  }

  return {
    stage,
    checkpointState: checkpoint.completedAt ? "submitted" : "prepared",
    plannerAction: job.plannerAction,
    plannerReason: job.plannerReason,
    plannerMismatch: Boolean(job.plannerAction && job.plannerAction !== stage),
    preparedPayload,
    verificationSummary,
    submissionTxHash: checkpoint.submissionTxHash,
    completedAt: checkpoint.completedAt,
  };
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
