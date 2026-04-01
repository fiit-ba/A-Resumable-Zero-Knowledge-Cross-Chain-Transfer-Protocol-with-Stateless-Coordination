import type { JobStatus, RelayProofStage } from "../contracts.js";

// ---------------------------------------------------------------------------
// All known relay stages (happy path + refund path)
// ---------------------------------------------------------------------------

export const STAGE_ORDER: RelayProofStage[] = [
  "lock",
  "mint",
  "ack",
  "refund-initiate",
  "refund-claim",
  "execute-burn",
  "burn-proof",
];

/** Stages that require RISC Zero proof generation. */
export const PROOF_STAGES = new Set<RelayProofStage>([
  "lock",
  "mint",
  "ack",
  "refund-claim",
  "burn-proof",
]);

/** Stages that are direct contract calls (no proof needed). */
export const DIRECT_STAGES = new Set<RelayProofStage>(["refund-initiate", "execute-burn"]);

// ---------------------------------------------------------------------------
// Transition guards
// ---------------------------------------------------------------------------

export function canConfirm(status: JobStatus): boolean {
  return status === "awaiting_confirmation" || status === "failed";
}

export function canReceiveReceipt(status: JobStatus): boolean {
  return status === "ready_for_signature";
}

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "unsupported";
}
