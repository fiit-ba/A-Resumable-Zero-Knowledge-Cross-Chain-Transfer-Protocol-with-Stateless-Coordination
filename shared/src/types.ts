// ---------------------------------------------------------------------------
// Browser-safe DTOs shared between local-agent (HTTP layer) and web-app
// ---------------------------------------------------------------------------

export type RelayProofStage = "lock" | "mint" | "ack";

export type VerificationMode = "colibri" | "rpc-fallback";

/**
 * Job lifecycle states in the new confirmed-preparation model.
 *
 * awaiting_confirmation → (confirm) → preparing_stage
 * preparing_stage       → (proof done) → ready_for_signature
 * ready_for_signature   → (browser submits) → waiting_for_receipt
 * waiting_for_receipt   → (receipt recorded) → preparing_stage | completed
 * completed             terminal
 * failed                terminal (retryable via re-confirm)
 * unsupported           terminal (refund path)
 */
export type JobStatus =
  | "awaiting_confirmation"
  | "preparing_stage"
  | "ready_for_signature"
  | "waiting_for_receipt"
  | "completed"
  | "failed"
  | "unsupported";

export interface TransferIntent {
  sourceProfile: string;
  destinationProfile: string;
  sourceConnector: string;
  destinationConnector: string;
  tokenFrom: string;
  tokenTo: string;
  /** Amount as a decimal string (bigint-safe JSON). */
  amount: string;
  receiver: string;
}

export interface VerificationSummary {
  mode: VerificationMode;
  degraded: boolean;
  /** Verify-stage key, e.g. "source-deposit". */
  verifiedStage: string;
}

/** Full job state returned by GET /jobs/:id */
export interface RelayJob {
  id: string;
  txId: string;
  currentStage: RelayProofStage | "pending" | "completed";
  status: JobStatus;
  sourceStatus: number;
  destinationStatus: number;
  lastError?: string;
  latestSubmissionTxHash?: string;
  intent: TransferIntent;
  /** Populated once stage preparation completes. */
  verificationSummary?: VerificationSummary;
  createdAt: number;
  updatedAt: number;
}

/** Proof payload returned by GET /jobs/:id/stages/:stage/proof (legacy endpoint) */
export interface StageReadyPayload {
  stage: RelayProofStage;
  proofPayload: string;
  contractMethod: string;
  contractArgs: unknown[];
  targetChainId: number;
  targetConnector: string;
}

/** Enriched payload returned by GET /jobs/:id/next-stage */
export interface EnrichedStagePayload extends StageReadyPayload {
  verificationMode: VerificationMode;
  verificationDegraded: boolean;
  verifiedStage: string;
}

export interface AgentHealth {
  ok: boolean;
  version: string;
  pid: number;
}
