import { describe, expect, it } from "vitest";
import {
  RELAY_STAGE_TO_PROOF_HOST,
  RELAY_STAGE_TO_SUBMISSION_METHOD,
  RELAY_STAGE_TO_VERIFY_STAGE,
} from "../../src/relay/stages.js";

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
