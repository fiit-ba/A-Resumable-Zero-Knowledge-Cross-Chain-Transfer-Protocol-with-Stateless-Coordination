import { describe, it, expect } from "vitest";
import { buildStagePayload } from "../../src/stage-payload.js";
import type { ProofArtifact } from "stateless-client";

const BASE_PROOF: ProofArtifact = {
  stage: "lock",
  backend: "local",
  proofPayload: "0xdeadbeef",
  txId: "0x" + "ab".repeat(32),
  metadata: {},
  rawOutput: "",
  amount: 1_000_000_000_000_000_000n,
  sender: "0x1111111111111111111111111111111111111111",
  receiver: "0x2222222222222222222222222222222222222222",
  currencyFrom: "0x3333333333333333333333333333333333333333",
  currencyTo: "0x4444444444444444444444444444444444444444",
  srcChainConnector: "0x5555555555555555555555555555555555555555",
  dstChainConnector: "0x6666666666666666666666666666666666666666",
  originAckDeadline: 9999n,
  nonce: 1n,
  sourceChainId: 31337,
  destChainId: 31338
};

const SRC_CHAIN = 31337;
const DST_CHAIN = 31338;
const SRC_CONNECTOR = "0xaaaa";
const DST_CONNECTOR = "0xbbbb";

describe("buildStagePayload – lock", () => {
  it("sets the correct target chain and connector (destination)", () => {
    const payload = buildStagePayload(
      BASE_PROOF,
      "lock",
      SRC_CHAIN,
      DST_CHAIN,
      SRC_CONNECTOR,
      DST_CONNECTOR
    );
    expect(payload.stage).toBe("lock");
    expect(payload.targetChainId).toBe(DST_CHAIN);
    expect(payload.targetConnector).toBe(DST_CONNECTOR);
    expect(payload.contractMethod).toBe("submitLockProof");
  });

  it("serialises bigint fields as decimal strings", () => {
    const payload = buildStagePayload(
      BASE_PROOF,
      "lock",
      SRC_CHAIN,
      DST_CHAIN,
      SRC_CONNECTOR,
      DST_CONNECTOR
    );
    // Verify JSON round-trip is safe (no BigInt in contractArgs)
    expect(() => JSON.stringify(payload)).not.toThrow();
    // amount and nonce should be strings
    const args = payload.contractArgs as unknown[];
    expect(args[3]).toBe("1000000000000000000");  // amount
    expect(args[10]).toBe("1");                    // nonce
  });
});

describe("buildStagePayload – mint", () => {
  it("targets source chain", () => {
    const mintProof: ProofArtifact = { ...BASE_PROOF, stage: "mint" };
    const payload = buildStagePayload(
      mintProof,
      "mint",
      SRC_CHAIN,
      DST_CHAIN,
      SRC_CONNECTOR,
      DST_CONNECTOR
    );
    expect(payload.targetChainId).toBe(SRC_CHAIN);
    expect(payload.targetConnector).toBe(SRC_CONNECTOR);
    expect(payload.contractMethod).toBe("submitMintProof");
  });
});

describe("buildStagePayload – ack", () => {
  it("targets destination chain", () => {
    const ackProof: ProofArtifact = { ...BASE_PROOF, stage: "ack" };
    const payload = buildStagePayload(
      ackProof,
      "ack",
      SRC_CHAIN,
      DST_CHAIN,
      SRC_CONNECTOR,
      DST_CONNECTOR
    );
    expect(payload.targetChainId).toBe(DST_CHAIN);
    expect(payload.targetConnector).toBe(DST_CONNECTOR);
    expect(payload.contractMethod).toBe("submitAckProof");
  });
});
