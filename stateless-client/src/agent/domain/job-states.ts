import type { JobStatus, RelayProofStage } from "../contracts.js";
import { ALL_RELAY_STAGES, isProofRelayStage } from "../../relay/stages.js";

// ---------------------------------------------------------------------------
// All known relay stages — derived from the canonical registry
// ---------------------------------------------------------------------------

export const STAGE_ORDER: RelayProofStage[] = ALL_RELAY_STAGES;

/** Stages that require RISC Zero proof generation. */
export const PROOF_STAGES = new Set<RelayProofStage>(ALL_RELAY_STAGES.filter(isProofRelayStage));

/** Stages that are direct contract calls (no proof needed). */
export const DIRECT_STAGES = new Set<RelayProofStage>(
  ALL_RELAY_STAGES.filter((s) => !isProofRelayStage(s)),
);

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
