import { describe, expect, it } from "vitest";
import {
  ALL_RELAY_STAGES,
  RELAY_STAGE_REGISTRY,
  RELAY_STAGE_TO_PROOF_HOST,
  RELAY_STAGE_TO_SUBMISSION_METHOD,
  RELAY_STAGE_TO_VERIFY_STAGE,
  isProofRelayStage,
} from "../../src/relay/stages.js";
import type { RelayProofStage } from "../../src/core/types.js";

// ---------------------------------------------------------------------------
// Legacy export correctness (keep existing coverage)
// ---------------------------------------------------------------------------

describe("relay stage mappings", () => {
  it("maps relay stages to verification stages", () => {
    expect(RELAY_STAGE_TO_VERIFY_STAGE.lock).toBe("source-deposit");
    expect(RELAY_STAGE_TO_VERIFY_STAGE.mint).toBe("destination-funds-released");
    expect(RELAY_STAGE_TO_VERIFY_STAGE.ack).toBe("source-ack-ready");
  });

  it("maps relay stages to submission methods", () => {
    expect(RELAY_STAGE_TO_SUBMISSION_METHOD.lock).toBe("submitLockProof");
    expect(RELAY_STAGE_TO_SUBMISSION_METHOD.mint).toBe("submitMintProof");
    expect(RELAY_STAGE_TO_SUBMISSION_METHOD.ack).toBe("submitAckProof");
  });

  it("maps relay stages to proof hosts", () => {
    expect(RELAY_STAGE_TO_PROOF_HOST.lock.localPackage).toBe("lock-proof-host");
    expect(RELAY_STAGE_TO_PROOF_HOST.mint.localPackage).toBe("mint-proof-host");
    expect(RELAY_STAGE_TO_PROOF_HOST.ack.localPackage).toBe("ack-proof-host");
  });
});

// ---------------------------------------------------------------------------
// Registry invariants
// ---------------------------------------------------------------------------

describe("RELAY_STAGE_REGISTRY invariants", () => {
  it("contains exactly 7 stages in ALL_RELAY_STAGES order", () => {
    expect(ALL_RELAY_STAGES).toHaveLength(7);
    expect(ALL_RELAY_STAGES).toEqual([
      "lock",
      "mint",
      "ack",
      "refund-initiate",
      "refund-claim",
      "execute-burn",
      "burn-proof",
    ]);
  });

  it("every stage has a non-empty submissionMethod", () => {
    for (const stage of ALL_RELAY_STAGES) {
      expect(
        RELAY_STAGE_REGISTRY[stage].submissionMethod,
        `${stage} missing submissionMethod`,
      ).toBeTruthy();
    }
  });

  it("every stage has a submissionSide of source or destination", () => {
    for (const stage of ALL_RELAY_STAGES) {
      const side = RELAY_STAGE_REGISTRY[stage].submissionSide;
      expect(["source", "destination"], `${stage} has invalid submissionSide`).toContain(side);
    }
  });

  it("every proof stage has verifyStage and proofHost defined", () => {
    for (const stage of ALL_RELAY_STAGES) {
      const spec = RELAY_STAGE_REGISTRY[stage];
      if (spec.actionKind === "proof") {
        expect(spec.verifyStage, `${stage} proof stage missing verifyStage`).toBeTruthy();
        expect(spec.proofHost, `${stage} proof stage missing proofHost`).toBeDefined();
        expect(
          spec.proofHost?.localPackage,
          `${stage} proof stage missing proofHost.localPackage`,
        ).toBeTruthy();
        expect(
          spec.proofHost?.localBin,
          `${stage} proof stage missing proofHost.localBin`,
        ).toBeTruthy();
      }
    }
  });

  it("direct stages have no verifyStage or proofHost", () => {
    for (const stage of ALL_RELAY_STAGES) {
      const spec = RELAY_STAGE_REGISTRY[stage];
      if (spec.actionKind === "direct") {
        expect(spec.verifyStage, `${stage} direct stage should not have verifyStage`).toBeUndefined();
        expect(spec.proofHost, `${stage} direct stage should not have proofHost`).toBeUndefined();
      }
    }
  });

  it("exactly 5 proof stages and 2 direct stages", () => {
    const proofStages = ALL_RELAY_STAGES.filter(
      (s) => RELAY_STAGE_REGISTRY[s].actionKind === "proof",
    );
    const directStages = ALL_RELAY_STAGES.filter(
      (s) => RELAY_STAGE_REGISTRY[s].actionKind === "direct",
    );
    expect(proofStages).toHaveLength(5);
    expect(directStages).toHaveLength(2);
  });

  it("only lock/mint/ack have expectedPostSubmitStatus set", () => {
    const asserted = ALL_RELAY_STAGES.filter(
      (s) => RELAY_STAGE_REGISTRY[s].expectedPostSubmitStatus !== null,
    );
    expect(asserted.sort()).toEqual(["ack", "lock", "mint"]);
  });

  it("isProofRelayStage returns true only for proof stages", () => {
    const proofStages: RelayProofStage[] = ["lock", "mint", "ack", "refund-claim", "burn-proof"];
    const directStages: RelayProofStage[] = ["refund-initiate", "execute-burn"];

    for (const s of proofStages) {
      expect(isProofRelayStage(s), `${s} should be proof`).toBe(true);
    }
    for (const s of directStages) {
      expect(isProofRelayStage(s), `${s} should not be proof`).toBe(false);
    }
  });

  it("RELAY_STAGE_TO_VERIFY_STAGE derived values match registry", () => {
    for (const stage of ALL_RELAY_STAGES) {
      const spec = RELAY_STAGE_REGISTRY[stage];
      if (spec.actionKind === "proof") {
        expect(RELAY_STAGE_TO_VERIFY_STAGE[stage as keyof typeof RELAY_STAGE_TO_VERIFY_STAGE]).toBe(
          spec.verifyStage,
        );
      }
    }
  });

  it("RELAY_STAGE_TO_SUBMISSION_METHOD derived values match registry", () => {
    for (const stage of ALL_RELAY_STAGES) {
      expect(RELAY_STAGE_TO_SUBMISSION_METHOD[stage]).toBe(
        RELAY_STAGE_REGISTRY[stage].submissionMethod,
      );
    }
  });
});
