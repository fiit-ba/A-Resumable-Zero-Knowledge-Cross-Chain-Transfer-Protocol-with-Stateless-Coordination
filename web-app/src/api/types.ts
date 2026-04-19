// IMPORTANT: This file intentionally mirrors stateless-client/src/agent/contracts.ts.
// Keep both files in sync whenever the agent HTTP contract changes.

export type RelayProofStage =
  | "lock"
  | "mint"
  | "ack"
  | "refund-initiate"
  | "refund-claim"
  | "execute-burn"
  | "burn-proof"
  | "non-accept-proof";

export type VerificationMode = "colibri" | "rpc-fallback";

export type VerificationDegradeReason =
  | "chiado_sync_backwards"
  | "chiado_ssz_parse"
  | "chiado_parent_beacon_missing"
  | "chiado_finalization"
  | "chiado_block_not_signed"
  | "chiado_bootstrap_unsupported"
  | "local_chain";

export type RelayMode = "auto" | "manual";
export type PostSubmitBehavior = "pause" | "auto_prepare";
export type PlannerAction = RelayProofStage | "noop" | "error";

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
  /** Present only when degraded is true; identifies the root cause of fallback. */
  degradeReason?: VerificationDegradeReason;
  /** Verify-stage key, e.g. "source-deposit". */
  verifiedStage: string;
}

export interface RelayJob {
  id: string;
  txId: string;
  currentStage: RelayProofStage | "pending" | "completed";
  status: JobStatus;
  relayMode: RelayMode;
  postSubmitBehavior: PostSubmitBehavior;
  plannerAction?: PlannerAction;
  plannerReason?: string;
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

export interface StageReadyPayload {
  stage: RelayProofStage;
  /** "proof" stages require RISC Zero proof generation; "direct" stages call the contract immediately. */
  actionKind: "proof" | "direct";
  /** null/undefined for direct actions. */
  proofPayload?: string | null;
  contractMethod: string;
  contractArgs: unknown[];
  targetChainId: number;
  targetConnector: string;
}

export interface EnrichedStagePayload extends StageReadyPayload {
  /** Only populated for proof stages. */
  verificationMode?: VerificationMode;
  /** Only populated for proof stages. */
  verificationDegraded?: boolean;
  verificationDegradeReason?: VerificationDegradeReason;
  /** Only populated for proof stages. */
  verifiedStage?: string;
}

export type StageCheckpointState = "missing" | "prepared" | "submitted";

export interface StageDetails {
  stage: RelayProofStage;
  checkpointState: StageCheckpointState;
  plannerAction?: PlannerAction;
  plannerReason?: string;
  plannerMismatch: boolean;
  preparedPayload?: EnrichedStagePayload;
  verificationSummary?: VerificationSummary;
  submissionTxHash?: string;
  completedAt?: number;
}

export interface AgentHealth {
  ok: boolean;
  version: string;
  pid: number;
}
