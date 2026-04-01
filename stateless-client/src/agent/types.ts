import type { StageExecutionBlocks } from "../core/types.js";
import type { RelayProofStage, TransferIntent } from "./contracts.js";
export type { StageExecutionBlocks };

// ---------------------------------------------------------------------------
// Agent-internal types
// ---------------------------------------------------------------------------

/** Persisted stage checkpoint written to SQLite. */
export interface StageCheckpoint {
  jobId: string;
  stage: RelayProofStage;
  payloadJson: string; // JSON of EnrichedStagePayload
  verificationJson?: string; // JSON of StageVerificationResult from stateless-client
  completedAt?: number; // unix ms, set after receipt confirmed
  submissionTxHash?: string;
}

/** Body sent to POST /jobs */
export interface CreateJobBody {
  txId: string;
  intent: TransferIntent;
}

/** Body sent to POST /jobs/:id/confirm */
// No additional fields required for now; future use for attestation tokens.
export type ConfirmJobBody = Record<string, never>;

/** Body sent to POST /jobs/:id/receipts — accepts all relay stage names */
export interface ReceiptBody {
  stage: RelayProofStage;
  txHash: string;
}

// ---------------------------------------------------------------------------
// Recovery types
// ---------------------------------------------------------------------------

/**
 * Body sent to POST /jobs/recover.
 * Only the txId is required; profile hints narrow the discovery scan when
 * the automatic scan returns multiple candidates (409).
 */
export interface RecoverJobBody {
  txId: string;
  sourceProfileHint?: string;
  destinationProfileHint?: string;
}

/**
 * One candidate returned in a 409 response when recovery is ambiguous.
 * The UI presents the list so the user can select the right profile pair
 * and retry with sourceProfileHint / destinationProfileHint set.
 */
export interface RecoveryCandidate {
  sourceProfile: string;
  sourceConnector: string;
  destinationProfile: string;
  destinationConnector: string;
  /** On-chain statuses at discovery time. */
  sourceStatus: number;
  destinationStatus: number;
}

/**
 * Metadata written alongside a recovered job.  Not exposed in RelayJob API
 * responses; used internally to thread discovered execution blocks into
 * proof preparation and to improve resume accuracy beyond the default 50 k-block
 * lookback window.
 */
export interface JobRecoveryMetadata {
  discoveredAt: number; // unix ms
  sourceProfile: string;
  destinationProfile: string;
  sourceConnector: string;
  destinationConnector: string;
  executionBlocks: StageExecutionBlocks;
  historyHints: {
    depositLocked: boolean;
    fundsReleased: boolean;
    ackReady: boolean;
    refundInitiated: boolean;
    burnExecuted: boolean;
  };
}
