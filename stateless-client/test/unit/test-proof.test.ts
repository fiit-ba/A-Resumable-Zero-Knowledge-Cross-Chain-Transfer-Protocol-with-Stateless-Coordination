import { AbiCoder, getAddress, keccak256 } from "ethers";
import { describe, expect, it } from "vitest";
import { connectorInterface } from "../../src/contracts/abi.js";
import type { ProofRelayStage } from "../../src/core/types.js";
import type { ConnectorReader } from "../../src/relay/endpoints.js";
import {
  buildTestProof,
  encodeTestSnarkPayload,
  type TestProofInput,
} from "../../src/relay/test-proof.js";

const coder = AbiCoder.defaultAbiCoder();

// Checksummed, as normalizeAddress returns them.
const TX_ID = `0x${"11".repeat(32)}`;
const SOURCE = getAddress("0x00000000000000000000000000000000000000a1");
const DEST = getAddress("0x00000000000000000000000000000000000000b2");
const SENDER = getAddress("0x00000000000000000000000000000000000000c3");
const RECEIVER = getAddress("0x00000000000000000000000000000000000000d4");
const TOKEN = getAddress("0x00000000000000000000000000000000000000e5");
const WRAPPED = getAddress("0x00000000000000000000000000000000000000f6");

// The transfer data and the relay config carry different chain ids, so each test shows which
// of the two a stage commits.
const RECORD = {
  txId: TX_ID,
  amount: 1000n,
  currencyFrom: TOKEN,
  currencyTo: WRAPPED,
  from: SENDER,
  to: RECEIVER,
  srcChainConnector: SOURCE,
  dstChainConnector: DEST,
  ackDeadline: 5000n,
  nonce: 7n,
  sourceChainId: 31337n,
  destinationChainId: 31338n,
};
const CONFIG_SOURCE_CHAIN_ID = 1;
const CONFIG_DESTINATION_CHAIN_ID = 2;

function logOf(eventName: string, values: unknown[]) {
  const event = connectorInterface.getEvent(eventName);
  if (!event) throw new Error(`no ${eventName}`);
  return connectorInterface.encodeEventLog(event, values);
}

function fakeReader(
  address: string,
  options: {
    logs?: { data: string; topics: string[] }[];
    accepted?: boolean;
    blockTimestamp?: number;
  } = {},
): ConnectorReader {
  return {
    address,
    provider: {
      getLogs: async () => options.logs ?? [],
      getBlock: async () => ({ timestamp: options.blockTimestamp ?? 0 }),
    },
    contract: {
      getTx: async () => RECORD,
      destinationLockAccepted: async () => options.accepted ?? false,
    },
  } as unknown as ConnectorReader;
}

/** The public inputs of a test payload, as SnarkAdapter decodes them. */
function publicInputs(payload: string): string {
  const [, , , input] = coder.decode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[]"],
    payload,
  );
  return coder.encode(
    input.map(() => "uint256"),
    [...input],
  );
}

function testInput(stage: ProofRelayStage, readers: TestProofInput["readers"]): TestProofInput {
  return {
    stage,
    txId: TX_ID,
    sourceChainId: CONFIG_SOURCE_CHAIN_ID,
    destinationChainId: CONFIG_DESTINATION_CHAIN_ID,
    ackDeadline: "5000",
    executionBlock: 12,
    readers,
  };
}

describe("encodeTestSnarkPayload", () => {
  it("splits abi.encode(values) into one public input per 32-byte word", () => {
    const encoded = coder.encode(["bytes32", "address", "uint256"], [TX_ID, DEST, 5n]);
    const payload = encodeTestSnarkPayload(["bytes32", "address", "uint256"], [TX_ID, DEST, 5n]);
    // SnarkAdapter commits to keccak256(abi.encodePacked(input)), the connector to
    // keccak256(abi.encode(values)): the two must be equal.
    expect(keccak256(publicInputs(payload))).toBe(keccak256(encoded));
  });
});

describe("buildTestProof", () => {
  const readers = { source: fakeReader(SOURCE), destination: fakeReader(DEST) };

  it("builds the lock proof from the source record, chain ids included", async () => {
    const proof = await buildTestProof(testInput("lock", readers));
    expect(proof.backend).toBe("test");
    expect(proof.amount).toBe(1000n);
    expect(proof.sender).toBe(SENDER);
    expect(proof.originAckDeadline).toBe(5000n);
    expect(proof.sourceChainId).toBe(31337);
    expect(proof.destChainId).toBe(31338);
    expect(publicInputs(proof.proofPayload)).toBe(
      coder.encode(
        [
          "bytes32",
          "uint256",
          "address",
          "address",
          "address",
          "address",
          "address",
          "address",
          "uint64",
          "uint256",
          "uint256",
          "uint256",
        ],
        [TX_ID, 1000n, SENDER, RECEIVER, TOKEN, WRAPPED, SOURCE, DEST, 5000n, 7n, 31337, 31338],
      ),
    );
  });

  it("builds the mint proof from the destination record, chain ids included", async () => {
    const proof = await buildTestProof(testInput("mint", readers));
    expect(publicInputs(proof.proofPayload)).toBe(
      coder.encode(
        ["bytes32", "address", "uint256", "address", "uint256", "uint256"],
        [TX_ID, DEST, 1000n, RECEIVER, 31337, 31338],
      ),
    );
  });

  it("builds the ack proof from the AckReady event and the configured chain ids", async () => {
    const ackReady = logOf("AckReady", [
      TX_ID,
      1000n,
      TOKEN,
      WRAPPED,
      SENDER,
      RECEIVER,
      SOURCE,
      DEST,
      1n,
      1,
      TX_ID,
      TX_ID,
    ]);
    const withEvent = {
      source: fakeReader(SOURCE, { logs: [ackReady] }),
      destination: readers.destination,
    };
    const proof = await buildTestProof(testInput("ack", withEvent));
    expect(proof.srcChainConnector).toBe(SOURCE);
    expect(proof.dstChainConnector).toBe(DEST);
    expect(publicInputs(proof.proofPayload)).toBe(
      coder.encode(
        ["bytes32", "address", "address", "uint256", "uint256"],
        [TX_ID, SOURCE, DEST, CONFIG_SOURCE_CHAIN_ID, CONFIG_DESTINATION_CHAIN_ID],
      ),
    );
  });

  it("fails the ack proof unless there is exactly one AckReady event", async () => {
    await expect(buildTestProof(testInput("ack", readers))).rejects.toThrow(
      /Expected exactly 1 AckReady event for txId .*, got 0/,
    );
  });

  it("builds the burn proof from the DestTxClosed event and the configured chain ids", async () => {
    const closed = logOf("DestTxClosed", [
      TX_ID,
      1000n,
      TOKEN,
      WRAPPED,
      SENDER,
      RECEIVER,
      SOURCE,
      DEST,
      1n,
      2n,
    ]);
    const withEvent = { source: readers.source, destination: fakeReader(DEST, { logs: [closed] }) };
    const proof = await buildTestProof(testInput("burn-proof", withEvent));
    expect(publicInputs(proof.proofPayload)).toBe(
      coder.encode(
        ["bytes32", "address", "uint256", "uint256", "uint256"],
        [TX_ID, DEST, 1000n, CONFIG_SOURCE_CHAIN_ID, CONFIG_DESTINATION_CHAIN_ID],
      ),
    );
  });

  it("builds the refund-claim proof from the source record, chain ids included", async () => {
    const proof = await buildTestProof(testInput("refund-claim", readers));
    expect(publicInputs(proof.proofPayload)).toBe(
      coder.encode(
        ["bytes32", "address", "uint256", "uint256", "uint256"],
        [TX_ID, SOURCE, 1000n, 31337, 31338],
      ),
    );
  });

  it("builds the non-accept proof only after the deadline and without an accepted lock", async () => {
    const late = {
      source: readers.source,
      destination: fakeReader(DEST, { blockTimestamp: 5000 }),
    };
    const proof = await buildTestProof(testInput("non-accept-proof", late));
    expect(publicInputs(proof.proofPayload)).toBe(
      coder.encode(
        ["bytes32", "address", "uint64", "uint256", "uint256"],
        [TX_ID, DEST, 5000n, CONFIG_SOURCE_CHAIN_ID, CONFIG_DESTINATION_CHAIN_ID],
      ),
    );

    const early = {
      source: readers.source,
      destination: fakeReader(DEST, { blockTimestamp: 4999 }),
    };
    await expect(buildTestProof(testInput("non-accept-proof", early))).rejects.toThrow(
      /ACK window still open on destination chain: deadline=5000, timestamp=4999/,
    );

    const accepted = {
      source: readers.source,
      destination: fakeReader(DEST, { blockTimestamp: 5000, accepted: true }),
    };
    await expect(buildTestProof(testInput("non-accept-proof", accepted))).rejects.toThrow(
      /Destination lock already accepted/,
    );
  });
});
