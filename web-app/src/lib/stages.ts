import type { JobStatus, RelayJob, RelayProofStage } from "../api/types";

/** Every relay stage in protocol order: happy path first, then the refund path. */
export const ALL_STAGES: RelayProofStage[] = [
  "lock",
  "mint",
  "ack",
  "refund-initiate",
  "refund-claim",
  "execute-burn",
  "burn-proof",
  "non-accept-proof",
];

export const STAGE_LABELS: Record<RelayProofStage, string> = {
  lock: "1/3 – Lock (destination)",
  mint: "2/3 – Mint (source)",
  ack: "3/3 – Ack (destination)",
  "refund-initiate": "Refund – Initiate (source)",
  "refund-claim": "Refund – Claim proof (destination)",
  "execute-burn": "Refund – Execute burn (destination)",
  "burn-proof": "Refund – Burn proof (source)",
  "non-accept-proof": "Refund – Non-acceptance proof (source)",
};

export function stageLabel(stage: RelayJob["currentStage"] | RelayJob["plannerAction"]): string {
  if (stage === "pending") return "Pending";
  if (stage === "completed") return "Completed";
  if (!stage) return "n/a";
  return STAGE_LABELS[stage as RelayProofStage] ?? stage;
}

export const REFUND_STAGES: ReadonlySet<RelayProofStage> = new Set([
  "refund-initiate",
  "refund-claim",
  "execute-burn",
  "burn-proof",
  "non-accept-proof",
]);

/** Stages submitted as plain contract calls, without a ZK proof. */
export const DIRECT_ACTION_STAGES: ReadonlySet<RelayProofStage> = new Set([
  "refund-initiate",
  "execute-burn",
]);

export const REFUND_STAGE_CONTEXT: Partial<Record<RelayProofStage, string>> = {
  "refund-initiate":
    "The ACK window has expired. Submit this transaction on the source chain to begin the refund process.",
  "refund-claim": "Refund initiated. Submit the refund-claim proof on the destination chain.",
  "execute-burn": "Refund claim accepted. Execute the burn on the destination chain.",
  "burn-proof": "Burn executed. Submit the burn proof on the source chain to complete the refund.",
  "non-accept-proof":
    "The destination never accepted the lock. Submit a ZK non-acceptance proof on the source chain to recover your funds without destination interaction.",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  awaiting_confirmation: "Awaiting confirmation",
  preparing_stage: "Preparing…",
  ready_for_signature: "Ready for signature",
  waiting_for_receipt: "Waiting for receipt…",
  completed: "Completed",
  failed: "Failed",
  unsupported: "Unsupported",
};

/** Job statuses that will never advance again. */
export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(["completed", "unsupported"]);
