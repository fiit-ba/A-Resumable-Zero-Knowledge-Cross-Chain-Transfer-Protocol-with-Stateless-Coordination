import type { RelayProofStage } from "../api/types";

/** Mirrors `Enums.TxStatus` in smart-contracts/src/libs/Enums.sol. */
export const TX_STATUS = {
  NONE: 0,
  DEPOSIT_LOCKED: 1,
  REFUND_INITIATED: 2,
  MINTED_IN_HOLDING: 3,
  REFUND_CLAIM_ACCEPTED: 4,
} as const;

export const TX_STATUS_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(TX_STATUS).map(([label, status]) => [status, label]),
);

/** On-chain status the target connector must report before each stage can be submitted. */
export const EXPECTED_TX_STATUS_BY_STAGE: Partial<Record<RelayProofStage, number>> = {
  lock: TX_STATUS.NONE,
  mint: TX_STATUS.DEPOSIT_LOCKED,
  ack: TX_STATUS.MINTED_IN_HOLDING,
  "refund-initiate": TX_STATUS.DEPOSIT_LOCKED,
  "refund-claim": TX_STATUS.MINTED_IN_HOLDING,
  "execute-burn": TX_STATUS.REFUND_CLAIM_ACCEPTED,
  "burn-proof": TX_STATUS.REFUND_INITIATED,
  "non-accept-proof": TX_STATUS.REFUND_INITIATED,
};

/** `Enums.ProofType.RISC0`. */
export const PROOF_TYPE_RISC0 = 0;

/** `Enums.VerifierRoute` used to look up each proof stage's expected RISC Zero image ID. */
export const RISC0_ROUTE_BY_STAGE: Partial<Record<RelayProofStage, number>> = {
  mint: 0, // ORIGIN_MINT
  "burn-proof": 1, // ORIGIN_BURN
  lock: 2, // DEST_LOCK
  ack: 3, // DEST_ACK
  "refund-claim": 4, // DEST_REFUND_CLAIM
  "non-accept-proof": 5, // ORIGIN_NON_ACCEPT
};

export function txStatusLabel(status: number): string {
  return TX_STATUS_LABELS[status] ?? "UNKNOWN";
}

export function stageRequiresActiveAckWindow(stage: RelayProofStage): boolean {
  return stage === "lock" || stage === "mint";
}
