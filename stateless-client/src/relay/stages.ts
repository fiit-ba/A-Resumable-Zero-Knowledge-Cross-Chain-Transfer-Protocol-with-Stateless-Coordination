import type { ProofRelayStage, RelayProofStage, Stage, StageDefinition } from "../core/types.js";

export const STAGE_DEFINITIONS: Record<Stage, StageDefinition> = {
  "source-deposit": {
    stage: "source-deposit",
    eventName: "DepositLocked",
    expectedStatus: 1,
    side: "source",
  },
  "destination-funds-released": {
    stage: "destination-funds-released",
    eventName: "FundsReleased",
    expectedStatus: 4,
    side: "destination",
  },
  "source-ack-ready": {
    stage: "source-ack-ready",
    eventName: "AckReady",
    expectedStatus: 2,
    side: "source",
  },
  "source-refund-initiated": {
    stage: "source-refund-initiated",
    eventName: "RefundInitiated",
    expectedStatus: 3,
    side: "source",
  },
  "destination-burn-executed": {
    stage: "destination-burn-executed",
    eventName: "BurnExecuted",
    expectedStatus: 5,
    side: "destination",
  },
};

/** Which stages require RISC Zero proof generation vs direct contract call. */
export const ACTION_KIND_BY_STAGE: Record<RelayProofStage, "proof" | "direct"> = {
  lock: "proof",
  mint: "proof",
  ack: "proof",
  "refund-initiate": "direct",
  "refund-claim": "proof",
  "execute-burn": "direct",
  "burn-proof": "proof",
};

export const RELAY_STAGE_TO_VERIFY_STAGE: Record<ProofRelayStage, Stage> = {
  lock: "source-deposit",
  mint: "destination-funds-released",
  ack: "source-ack-ready",
  "refund-claim": "source-refund-initiated",
  "burn-proof": "destination-burn-executed",
};

export const RELAY_STAGE_TO_SUBMISSION_METHOD: Record<RelayProofStage, string> = {
  lock: "submitLockProof",
  mint: "submitMintProof",
  ack: "submitAckProof",
  "refund-initiate": "initiateRefund",
  "refund-claim": "submitRefundClaimProof",
  "execute-burn": "executeBurn",
  "burn-proof": "submitBurnProof",
};

export const RELAY_STAGE_TO_PROOF_HOST: Record<
  ProofRelayStage,
  {
    workspaceKey:
      | "lockWorkspace"
      | "mintWorkspace"
      | "ackWorkspace"
      | "refundClaimWorkspace"
      | "burnWorkspace";
    dockerScriptKey:
      | "lockDockerScript"
      | "mintDockerScript"
      | "ackDockerScript"
      | "refundClaimDockerScript"
      | "burnDockerScript";
    localPackage: string;
    localBin: string;
  }
> = {
  lock: {
    workspaceKey: "lockWorkspace",
    dockerScriptKey: "lockDockerScript",
    localPackage: "lock-proof-host",
    localBin: "lock-proof-host",
  },
  mint: {
    workspaceKey: "mintWorkspace",
    dockerScriptKey: "mintDockerScript",
    localPackage: "mint-proof-host",
    localBin: "mint-proof-host",
  },
  ack: {
    workspaceKey: "ackWorkspace",
    dockerScriptKey: "ackDockerScript",
    localPackage: "ack-proof-host",
    localBin: "ack-proof-host",
  },
  "refund-claim": {
    workspaceKey: "refundClaimWorkspace",
    dockerScriptKey: "refundClaimDockerScript",
    localPackage: "refund-claim-proof-host",
    localBin: "refund-claim-proof-host",
  },
  "burn-proof": {
    workspaceKey: "burnWorkspace",
    dockerScriptKey: "burnDockerScript",
    localPackage: "burn-proof-host",
    localBin: "burn-proof-host",
  },
};
