import type { JobStatus, RelayProofStage } from "agent-shared";

// ---------------------------------------------------------------------------
// Happy-path stage order
// ---------------------------------------------------------------------------

export const STAGE_ORDER: RelayProofStage[] = ["lock", "mint", "ack"];

export function nextStage(
  current: RelayProofStage
): RelayProofStage | "completed" {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx + 1 >= STAGE_ORDER.length) return "completed";
  return STAGE_ORDER[idx + 1]!;
}

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
  return (
    status === "completed" ||
    status === "unsupported"
  );
}

// ---------------------------------------------------------------------------
// Source / destination status interpretation
// ---------------------------------------------------------------------------

export const REFUND_SOURCE_STATUSES = new Set([3]);
export const REFUND_DESTINATION_STATUSES = new Set([5]);

export function isRefundState(sourceStatus: number, destinationStatus: number): boolean {
  return (
    REFUND_SOURCE_STATUSES.has(sourceStatus) ||
    REFUND_DESTINATION_STATUSES.has(destinationStatus)
  );
}
