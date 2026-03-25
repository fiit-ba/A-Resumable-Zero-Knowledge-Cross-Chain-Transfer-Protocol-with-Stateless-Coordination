// All HTTP-layer types come from the shared browser-safe package so the
// web-app can import the same definitions without pulling in Node.js modules.
export type {
  AgentHealth,
  EnrichedStagePayload,
  JobStatus,
  RelayJob,
  RelayProofStage,
  StageReadyPayload,
  TransferIntent,
  VerificationMode,
  VerificationSummary
} from "agent-shared";

// ---------------------------------------------------------------------------
// Agent-internal types
// ---------------------------------------------------------------------------

/** Persisted stage checkpoint written to SQLite. */
export interface StageCheckpoint {
  jobId: string;
  stage: import("agent-shared").RelayProofStage;
  payloadJson: string;          // JSON of EnrichedStagePayload
  verificationJson?: string;    // JSON of StageVerificationResult from stateless-client
  completedAt?: number;         // unix ms, set after receipt confirmed
  submissionTxHash?: string;
}

/** Body sent to POST /jobs */
export interface CreateJobBody {
  txId: string;
  intent: import("agent-shared").TransferIntent;
}

/** Body sent to POST /jobs/:id/confirm */
export interface ConfirmJobBody {
  // No additional fields required for now; future use for attestation tokens.
}

/** Body sent to POST /jobs/:id/receipts */
export interface ReceiptBody {
  stage: import("agent-shared").RelayProofStage;
  txHash: string;
}
