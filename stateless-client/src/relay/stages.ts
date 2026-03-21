import type { RelayProofStage, Stage, StageDefinition } from "../core/types.js";

export const STAGE_DEFINITIONS: Record<Stage, StageDefinition> = {
  "source-deposit": {
    stage: "source-deposit",
    eventName: "DepositLocked",
    expectedStatus: 1,
    side: "source"
  },
  "destination-funds-released": {
    stage: "destination-funds-released",
    eventName: "FundsReleased",
    expectedStatus: 4,
    side: "destination"
  },
  "source-ack-ready": {
    stage: "source-ack-ready",
    eventName: "AckReady",
    expectedStatus: 2,
    side: "source"
  }
};

export const RELAY_STAGE_TO_VERIFY_STAGE: Record<RelayProofStage, Stage> = {
  lock: "source-deposit",
  mint: "destination-funds-released",
  ack: "source-ack-ready"
};

export const RELAY_STAGE_TO_SUBMISSION_METHOD: Record<RelayProofStage, string> = {
  lock: "submitLockProof",
  mint: "submitMintProof",
  ack: "submitAckProof"
};

export const RELAY_STAGE_TO_PROOF_HOST: Record<
  RelayProofStage,
  {
    workspaceKey: "lockWorkspace" | "mintWorkspace" | "ackWorkspace";
    dockerScriptKey: "lockDockerScript" | "mintDockerScript" | "ackDockerScript";
    localPackage: "lock-proof-host" | "mint-proof-host" | "ack-proof-host";
    localBin: "lock-proof-host" | "mint-proof-host" | "ack-proof-host";
  }
> = {
  lock: {
    workspaceKey: "lockWorkspace",
    dockerScriptKey: "lockDockerScript",
    localPackage: "lock-proof-host",
    localBin: "lock-proof-host"
  },
  mint: {
    workspaceKey: "mintWorkspace",
    dockerScriptKey: "mintDockerScript",
    localPackage: "mint-proof-host",
    localBin: "mint-proof-host"
  },
  ack: {
    workspaceKey: "ackWorkspace",
    dockerScriptKey: "ackDockerScript",
    localPackage: "ack-proof-host",
    localBin: "ack-proof-host"
  }
};
