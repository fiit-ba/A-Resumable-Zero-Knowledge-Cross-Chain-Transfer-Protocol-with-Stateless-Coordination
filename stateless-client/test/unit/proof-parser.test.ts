import { describe, expect, it } from "vitest";
import { parseProofArtifact } from "../../src/relay/proof-runner.js";

const LOCK_OUTPUT = [
  "proofPayload: 0x1234",
  "txId: 0x1111111111111111111111111111111111111111111111111111111111111111",
  "amount: 1000",
  "sender: 0x3000000000000000000000000000000000000003",
  "receiver: 0x4000000000000000000000000000000000000004",
  "currencyFrom: 0x5000000000000000000000000000000000000005",
  "currencyTo: 0x6000000000000000000000000000000000000006",
  "srcChainConnector: 0x1000000000000000000000000000000000000001",
  "dstChainConnector: 0x2000000000000000000000000000000000000002",
  "originAckDeadline: 999",
  "nonce: 7",
  "sourceChainId: 31337",
  "destChainId: 31338",
].join("\n");

describe("parseProofArtifact", () => {
  it("parses lock proof output with required fields", () => {
    const artifact = parseProofArtifact("lock", "local", LOCK_OUTPUT);

    expect(artifact.stage).toBe("lock");
    expect(artifact.proofPayload).toBe("0x1234");
    expect(artifact.amount).toBe(1000n);
    expect(artifact.sourceChainId).toBe(31337);
    expect(artifact.destChainId).toBe(31338);
  });

  it("fails when required fields are missing", () => {
    expect(() => parseProofArtifact("mint", "docker", "txId: 0x1234")).toThrow(/proofPayload/i);
  });

  it("fails when numeric fields are malformed", () => {
    const malformed = LOCK_OUTPUT.replace("amount: 1000", "amount: abc");
    expect(() => parseProofArtifact("lock", "local", malformed)).toThrow(/amount/i);
  });

  it("parses ack proof output", () => {
    const output = [
      "proofPayload: 0xabcd",
      "txId: 0x1111111111111111111111111111111111111111111111111111111111111111",
      "srcChainConnector: 0x1000000000000000000000000000000000000001",
      "dstChainConnector: 0x2000000000000000000000000000000000000002",
    ].join("\n");

    const artifact = parseProofArtifact("ack", "docker", output);
    expect(artifact.srcChainConnector).toBe("0x1000000000000000000000000000000000000001");
    expect(artifact.dstChainConnector).toBe("0x2000000000000000000000000000000000000002");
  });
});
