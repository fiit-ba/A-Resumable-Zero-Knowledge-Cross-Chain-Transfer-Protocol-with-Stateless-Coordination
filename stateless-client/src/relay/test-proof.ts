/**
 * Test proofs for `--proof-backend test`, for local chains only.
 *
 * No proof host runs. Each stage reads from the chain the values its RISC Zero guest would
 * commit and encodes them as a SnarkJS payload with zero proof points. Like the guests, lock,
 * mint and refund-claim take the chain ids from the transfer data, while ack, burn-proof and
 * non-accept-proof take them from the relay config. It carries no proof, so it works only
 * against a SnarkAdapter backed by an always-true mock verifier.
 */
import { AbiCoder, type Result } from "ethers";
import { connectorInterface, eventTopic } from "../contracts/abi.js";
import type { BlockTagInput, ProofArtifact, ProofRelayStage, Side } from "../core/types.js";
import {
  normalizeAddress,
  normalizeBlockTag,
  normalizeBytes32,
  toRpcBlockTag,
} from "../core/utils.js";
import type { ConnectorReader } from "./endpoints.js";

const coder = AbiCoder.defaultAbiCoder();

export interface TestProofInput {
  stage: ProofRelayStage;
  txId: string;
  sourceChainId: number;
  destinationChainId: number;
  /** Required by non-accept-proof: the ackDeadline from the source transfer record. */
  ackDeadline?: string;
  executionBlock: BlockTagInput;
  readers: Record<Side, ConnectorReader>;
}

/**
 * Encodes public inputs the way SnarkAdapter decodes them: `(a, b, c, uint256[] input)`, one
 * 32-byte word of `abi.encode(values)` per input, with zero proof points.
 */
export function encodeTestSnarkPayload(types: string[], values: unknown[]): string {
  const encoded = coder.encode(types, values).slice(2);
  const words: bigint[] = [];
  for (let start = 0; start < encoded.length; start += 64) {
    words.push(BigInt(`0x${encoded.slice(start, start + 64)}`));
  }
  return coder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[]"],
    [
      [0n, 0n],
      [
        [0n, 0n],
        [0n, 0n],
      ],
      [0n, 0n],
      words,
    ],
  );
}

/** Reads the single `eventName` log for `txId` emitted by the connector up to `blockTag`. */
async function readEvent(
  reader: ConnectorReader,
  eventName: string,
  txId: string,
  blockTag: string,
): Promise<Result> {
  const logs = await reader.provider.getLogs({
    address: reader.address,
    topics: [eventTopic(eventName), txId],
    fromBlock: 0,
    toBlock: blockTag,
  });
  if (logs.length !== 1) {
    throw new Error(`Expected exactly 1 ${eventName} event for txId ${txId}, got ${logs.length}`);
  }
  return connectorInterface.decodeEventLog(eventName, logs[0].data, logs[0].topics);
}

/** Builds the test proof of one stage from on-chain data. */
export async function buildTestProof(input: TestProofInput): Promise<ProofArtifact> {
  const txId = normalizeBytes32(input.txId, "tx-id");
  const blockTag = toRpcBlockTag(normalizeBlockTag(input.executionBlock, "latest"));
  const { source, destination } = input.readers;
  const configChainIds = [input.sourceChainId, input.destinationChainId];
  const artifact = (
    types: string[],
    values: unknown[],
    fields: Partial<ProofArtifact>,
  ): ProofArtifact => ({
    stage: input.stage,
    backend: "test",
    proofPayload: encodeTestSnarkPayload(types, values),
    txId,
    metadata: {},
    rawOutput: "",
    ...fields,
  });

  switch (input.stage) {
    case "lock": {
      // The source record holds the DepositLocked values the lock guest commits.
      const tx = await source.contract.getTx(txId, { blockTag });
      const fields = {
        amount: BigInt(tx.amount),
        sender: normalizeAddress(tx.from, "getTx.from"),
        receiver: normalizeAddress(tx.to, "getTx.to"),
        currencyFrom: normalizeAddress(tx.currencyFrom, "getTx.currencyFrom"),
        currencyTo: normalizeAddress(tx.currencyTo, "getTx.currencyTo"),
        srcChainConnector: normalizeAddress(tx.srcChainConnector, "getTx.srcChainConnector"),
        dstChainConnector: normalizeAddress(tx.dstChainConnector, "getTx.dstChainConnector"),
        originAckDeadline: BigInt(tx.ackDeadline),
        nonce: BigInt(tx.nonce),
        sourceChainId: Number(tx.sourceChainId),
        destChainId: Number(tx.destinationChainId),
      };
      return artifact(
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
        [
          txId,
          fields.amount,
          fields.sender,
          fields.receiver,
          fields.currencyFrom,
          fields.currencyTo,
          fields.srcChainConnector,
          fields.dstChainConnector,
          fields.originAckDeadline,
          fields.nonce,
          fields.sourceChainId,
          fields.destChainId,
        ],
        fields,
      );
    }
    case "mint": {
      // The destination record in MINTED_IN_HOLDING, as the mint guest reads it.
      const tx = await destination.contract.getTx(txId, { blockTag });
      const fields = {
        amount: BigInt(tx.amount),
        receiver: normalizeAddress(tx.to, "getTx.to"),
        dstChainConnector: normalizeAddress(tx.dstChainConnector, "getTx.dstChainConnector"),
      };
      return artifact(
        ["bytes32", "address", "uint256", "address", "uint256", "uint256"],
        [
          txId,
          fields.dstChainConnector,
          fields.amount,
          fields.receiver,
          tx.sourceChainId,
          tx.destinationChainId,
        ],
        fields,
      );
    }
    case "ack": {
      // submitMintProof deletes the source record, so the ack guest reads the AckReady event.
      const event = await readEvent(source, "AckReady", txId, blockTag);
      const fields = {
        srcChainConnector: normalizeAddress(event.srcChainConnector, "AckReady.srcChainConnector"),
        dstChainConnector: normalizeAddress(event.dstChainConnector, "AckReady.dstChainConnector"),
      };
      return artifact(
        ["bytes32", "address", "address", "uint256", "uint256"],
        [txId, fields.srcChainConnector, fields.dstChainConnector, ...configChainIds],
        fields,
      );
    }
    case "refund-claim": {
      // The source record in REFUND_INITIATED, as the refund-claim guest reads it.
      const tx = await source.contract.getTx(txId, { blockTag });
      return artifact(
        ["bytes32", "address", "uint256", "uint256", "uint256"],
        [txId, tx.srcChainConnector, tx.amount, tx.sourceChainId, tx.destinationChainId],
        {},
      );
    }
    case "burn-proof": {
      // executeBurn deletes the destination record, so the burn guest reads DestTxClosed.
      const event = await readEvent(destination, "DestTxClosed", txId, blockTag);
      return artifact(
        ["bytes32", "address", "uint256", "uint256", "uint256"],
        [txId, event.dstChainConnector, event.amount, ...configChainIds],
        {},
      );
    }
    case "non-accept-proof": {
      // The two checks the non-accept guest makes on the destination block.
      if (input.ackDeadline === undefined) {
        throw new Error("non-accept-proof test proof requires ackDeadline");
      }
      const ackDeadline = BigInt(input.ackDeadline);
      const accepted = await destination.contract.destinationLockAccepted(txId, { blockTag });
      if (accepted) {
        throw new Error(
          `Destination lock already accepted for txId ${txId}; non-accept-proof is not possible.`,
        );
      }
      const block = await destination.provider.getBlock(blockTag);
      if (!block) {
        throw new Error(`Cannot fetch destination block ${blockTag} for non-accept-proof.`);
      }
      if (BigInt(block.timestamp) < ackDeadline) {
        throw new Error(
          `ACK window still open on destination chain: ` +
            `deadline=${ackDeadline.toString()}, timestamp=${block.timestamp}.`,
        );
      }
      const fields = {
        dstChainConnector: normalizeAddress(destination.address, "destination connector"),
        originAckDeadline: ackDeadline,
        sourceChainId: input.sourceChainId,
        destChainId: input.destinationChainId,
      };
      return artifact(
        ["bytes32", "address", "uint64", "uint256", "uint256"],
        [txId, fields.dstChainConnector, ackDeadline, ...configChainIds],
        fields,
      );
    }
  }
}
