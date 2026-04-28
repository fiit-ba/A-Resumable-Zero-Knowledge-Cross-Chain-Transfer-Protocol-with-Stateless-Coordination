import type { RelayProofStage } from "../api/types";

export const TX_STATUS_LABELS: Record<number, string> = {
  0: "NONE",
  1: "DEPOSIT_LOCKED",
  2: "REFUND_INITIATED",
  3: "MINTED_IN_HOLDING",
  4: "REFUND_CLAIM_ACCEPTED",
};

export const EXPECTED_TX_STATUS_BY_STAGE: Partial<Record<RelayProofStage, number>> = {
  lock: 0,
  mint: 1,
  ack: 3,
  "refund-initiate": 1,
  "refund-claim": 3,
  "execute-burn": 4,
  "burn-proof": 2,
  "non-accept-proof": 2,
};

export function txStatusLabel(status: number): string {
  return TX_STATUS_LABELS[status] ?? "UNKNOWN";
}

export function stageRequiresActiveAckWindow(stage: RelayProofStage): boolean {
  return stage === "lock" || stage === "mint";
}
