import { describe, expect, it } from "vitest";
import {
  ALL_RELAY_STAGES,
  RELAY_STAGE_REGISTRY,
  VERIFY_STAGES,
  isProofRelayStage,
  isRelayStage,
  isVerifyStage,
} from "../../src/relay/stages.js";
import type { RelayProofStage } from "../../src/core/types.js";

describe("relay stage mappings", () => {
  it("maps relay stages to verification stages", () => {
    expect(RELAY_STAGE_REGISTRY.lock.verifyStage).toBe("source-deposit");
    expect(RELAY_STAGE_REGISTRY.mint.verifyStage).toBe("destination-funds-released");
    expect(RELAY_STAGE_REGISTRY.ack.verifyStage).toBe("source-ack-ready");
  });

  it("maps relay stages to submission methods", () => {
    expect(RELAY_STAGE_REGISTRY.lock.submissionMethod).toBe("submitLockProof");
    expect(RELAY_STAGE_REGISTRY.mint.submissionMethod).toBe("submitMintProof");
    expect(RELAY_STAGE_REGISTRY.ack.submissionMethod).toBe("submitAckProof");
  });

  it("maps relay stages to proof hosts", () => {
    expect(RELAY_STAGE_REGISTRY.lock.proofHost?.localPackage).toBe("lock-proof-host");
    expect(RELAY_STAGE_REGISTRY.mint.proofHost?.localPackage).toBe("mint-proof-host");
    expect(RELAY_STAGE_REGISTRY.ack.proofHost?.localPackage).toBe("ack-proof-host");
  });
});

describe("stage type guards", () => {
  it("isRelayStage accepts every registered stage and rejects anything else", () => {
    for (const stage of ALL_RELAY_STAGES) {
      expect(isRelayStage(stage), stage).toBe(true);
    }
    for (const value of ["", "LOCK", "toString", "source-deposit", 1, null, undefined]) {
      expect(isRelayStage(value), String(value)).toBe(false);
    }
  });

  it("isVerifyStage accepts exactly the verifiable on-chain stages", () => {
    expect(VERIFY_STAGES).toEqual([
      "source-deposit",
      "destination-funds-released",
      "source-ack-ready",
      "source-refund-initiated",
      "destination-burn-executed",
    ]);
    for (const stage of VERIFY_STAGES) {
      expect(isVerifyStage(stage), stage).toBe(true);
    }
    for (const value of ["lock", "constructor", 0, undefined]) {
      expect(isVerifyStage(value), String(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Registry invariants
// ---------------------------------------------------------------------------

describe("RELAY_STAGE_REGISTRY invariants", () => {
  it("contains exactly 8 stages in ALL_RELAY_STAGES order", () => {
    expect(ALL_RELAY_STAGES).toHaveLength(8);
    expect(ALL_RELAY_STAGES).toEqual([
      "lock",
      "mint",
      "ack",
      "refund-initiate",
      "refund-claim",
      "execute-burn",
      "burn-proof",
      "non-accept-proof",
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
        expect(
          spec.verifyStage,
          `${stage} direct stage should not have verifyStage`,
        ).toBeUndefined();
        expect(spec.proofHost, `${stage} direct stage should not have proofHost`).toBeUndefined();
      }
    }
  });

  it("exactly 6 proof stages and 2 direct stages", () => {
    const proofStages = ALL_RELAY_STAGES.filter(
      (s) => RELAY_STAGE_REGISTRY[s].actionKind === "proof",
    );
    const directStages = ALL_RELAY_STAGES.filter(
      (s) => RELAY_STAGE_REGISTRY[s].actionKind === "direct",
    );
    expect(proofStages).toHaveLength(6);
    expect(directStages).toHaveLength(2);
  });

  it("only lock/mint/ack have expectedPostSubmitStatus set", () => {
    const asserted = ALL_RELAY_STAGES.filter(
      (s) => RELAY_STAGE_REGISTRY[s].expectedPostSubmitStatus !== null,
    );
    expect(asserted.sort()).toEqual(["ack", "lock", "mint"]);
  });

  it("isProofRelayStage returns true only for proof stages", () => {
    const proofStages: RelayProofStage[] = [
      "lock",
      "mint",
      "ack",
      "refund-claim",
      "burn-proof",
      "non-accept-proof",
    ];
    const directStages: RelayProofStage[] = ["refund-initiate", "execute-burn"];

    for (const s of proofStages) {
      expect(isProofRelayStage(s), `${s} should be proof`).toBe(true);
    }
    for (const s of directStages) {
      expect(isProofRelayStage(s), `${s} should not be proof`).toBe(false);
    }
  });
});
