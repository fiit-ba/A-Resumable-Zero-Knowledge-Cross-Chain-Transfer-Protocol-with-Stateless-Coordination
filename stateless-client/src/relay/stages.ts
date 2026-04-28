import type {
  ProofPaths,
  ProofRelayStage,
  RelayProofStage,
  Stage,
  StageDefinition,
} from "../core/types.js";

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
    expectedStatus: 3, // MINTED_IN_HOLDING — set by submitLockProof on the destination
    side: "destination",
  },
  "source-ack-ready": {
    stage: "source-ack-ready",
    eventName: "AckReady",
    expectedStatus: 0, // NONE — submitMintProof calls _cleanupTx, deleting the source record
    side: "source",
  },
  "source-refund-initiated": {
    stage: "source-refund-initiated",
    eventName: "RefundClaimed",
    expectedStatus: 2, // REFUND_INITIATED — set by initiateRefund on the source
    side: "source",
  },
  "destination-burn-executed": {
    stage: "destination-burn-executed",
    eventName: "DestTxClosed",
    expectedStatus: 0, // NONE — executeBurn calls _cleanupTx, deleting the destination record
    side: "destination",
  },
};

// ---------------------------------------------------------------------------
// Canonical stage registry
// ---------------------------------------------------------------------------

/** Complete per-stage metadata used by relay execution, agent orchestration, and server validation. */
export interface RelayStageSpec {
  stage: RelayProofStage;
  actionKind: "proof" | "direct";
  submissionSide: "source" | "destination";
  submissionMethod: string;
  /** Which on-chain Stage to verify before generating proof. Absent for direct stages. */
  verifyStage?: Stage;
  /** Expected on-chain status after successful submission. null = not asserted. */
  expectedPostSubmitStatus: number | null;
  /**
   * Override which chain's RPC URL and connector address is passed to the proof
   * host. Defaults to the side implied by verifyStage. Used by non-accept-proof,
   * whose verifyStage is on the source but whose proof runs against the destination.
   */
  proofHostSide?: "source" | "destination";
  /** Proof host configuration. Absent for direct stages. */
  proofHost?: {
    workspaceKey: keyof ProofPaths;
    dockerScriptKey: keyof ProofPaths;
    localPackage: string;
    localBin: string;
  };
}

/** Ordered list of all relay stages (happy path + refund path). */
export const ALL_RELAY_STAGES: RelayProofStage[] = [
  "lock",
  "mint",
  "ack",
  "refund-initiate",
  "refund-claim",
  "execute-burn",
  "burn-proof",
  "non-accept-proof",
];

/** Single authoritative source for every stage's relay metadata. */
export const RELAY_STAGE_REGISTRY: Record<RelayProofStage, RelayStageSpec> = {
  lock: {
    stage: "lock",
    actionKind: "proof",
    submissionSide: "destination",
    submissionMethod: "submitLockProof",
    verifyStage: "source-deposit",
    expectedPostSubmitStatus: 3, // MINTED_IN_HOLDING on destination after submitLockProof
    proofHost: {
      workspaceKey: "lockWorkspace",
      dockerScriptKey: "lockDockerScript",
      localPackage: "lock-proof-host",
      localBin: "lock-proof-host",
    },
  },
  mint: {
    stage: "mint",
    actionKind: "proof",
    submissionSide: "source",
    submissionMethod: "submitMintProof",
    verifyStage: "destination-funds-released",
    expectedPostSubmitStatus: 0, // NONE — submitMintProof calls _cleanupTx, source record deleted
    proofHost: {
      workspaceKey: "mintWorkspace",
      dockerScriptKey: "mintDockerScript",
      localPackage: "mint-proof-host",
      localBin: "mint-proof-host",
    },
  },
  ack: {
    stage: "ack",
    actionKind: "proof",
    submissionSide: "destination",
    submissionMethod: "submitAckProof",
    verifyStage: "source-ack-ready",
    expectedPostSubmitStatus: 0,
    proofHost: {
      workspaceKey: "ackWorkspace",
      dockerScriptKey: "ackDockerScript",
      localPackage: "ack-proof-host",
      localBin: "ack-proof-host",
    },
  },
  "refund-initiate": {
    stage: "refund-initiate",
    actionKind: "direct",
    submissionSide: "source",
    submissionMethod: "initiateRefund",
    expectedPostSubmitStatus: null,
  },
  "refund-claim": {
    stage: "refund-claim",
    actionKind: "proof",
    submissionSide: "destination",
    submissionMethod: "submitRefundClaimProof",
    verifyStage: "source-refund-initiated",
    expectedPostSubmitStatus: null,
    proofHost: {
      workspaceKey: "refundClaimWorkspace",
      dockerScriptKey: "refundClaimDockerScript",
      localPackage: "refund-claim-proof-host",
      localBin: "refund-claim-proof-host",
    },
  },
  "execute-burn": {
    stage: "execute-burn",
    actionKind: "direct",
    submissionSide: "destination",
    submissionMethod: "executeBurn",
    expectedPostSubmitStatus: null,
  },
  "burn-proof": {
    stage: "burn-proof",
    actionKind: "proof",
    submissionSide: "source",
    submissionMethod: "submitBurnProof",
    verifyStage: "destination-burn-executed",
    expectedPostSubmitStatus: null,
    proofHost: {
      workspaceKey: "burnWorkspace",
      dockerScriptKey: "burnDockerScript",
      localPackage: "burn-proof-host",
      localBin: "burn-proof-host",
    },
  },
  "non-accept-proof": {
    stage: "non-accept-proof",
    actionKind: "proof",
    // Submitted on the origin (source) chain: submitNonAcceptanceProof
    submissionSide: "source",
    submissionMethod: "submitNonAcceptanceProof",
    // Verify that source initiated refund before generating the proof.
    verifyStage: "source-refund-initiated",
    expectedPostSubmitStatus: null,
    // The proof itself reads the destination chain, not the source.
    proofHostSide: "destination",
    proofHost: {
      workspaceKey: "nonAcceptWorkspace",
      dockerScriptKey: "nonAcceptDockerScript",
      localPackage: "non-accept-proof-host",
      localBin: "non-accept-proof-host",
    },
  },
};

// ---------------------------------------------------------------------------
// Registry-derived helpers
// ---------------------------------------------------------------------------

/** Type guard: true if the stage requires RISC Zero proof generation. */
export function isProofRelayStage(stage: RelayProofStage): stage is ProofRelayStage {
  return RELAY_STAGE_REGISTRY[stage].actionKind === "proof";
}

// ---------------------------------------------------------------------------
// Legacy exports derived from the registry (kept for backward compatibility)
// ---------------------------------------------------------------------------

/** Which stages require RISC Zero proof generation vs direct contract call. */
export const ACTION_KIND_BY_STAGE: Record<RelayProofStage, "proof" | "direct"> = Object.fromEntries(
  ALL_RELAY_STAGES.map((s) => [s, RELAY_STAGE_REGISTRY[s].actionKind]),
) as Record<RelayProofStage, "proof" | "direct">;

export const RELAY_STAGE_TO_VERIFY_STAGE: Record<ProofRelayStage, Stage> = Object.fromEntries(
  ALL_RELAY_STAGES.filter(isProofRelayStage).map((s) => [s, RELAY_STAGE_REGISTRY[s].verifyStage]),
) as Record<ProofRelayStage, Stage>;

export const RELAY_STAGE_TO_SUBMISSION_METHOD: Record<RelayProofStage, string> = Object.fromEntries(
  ALL_RELAY_STAGES.map((s) => [s, RELAY_STAGE_REGISTRY[s].submissionMethod]),
) as Record<RelayProofStage, string>;

export const RELAY_STAGE_TO_PROOF_HOST: Record<
  ProofRelayStage,
  NonNullable<RelayStageSpec["proofHost"]>
> = Object.fromEntries(
  ALL_RELAY_STAGES.filter(isProofRelayStage).map((s) => [s, RELAY_STAGE_REGISTRY[s].proofHost]),
) as Record<ProofRelayStage, NonNullable<RelayStageSpec["proofHost"]>>;
