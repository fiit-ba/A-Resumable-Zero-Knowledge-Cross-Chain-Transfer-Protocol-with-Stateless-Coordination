#!/usr/bin/env node

import Colibri, { MethodType } from "@corpus-core/colibri-stateless";
import { Interface, getAddress } from "ethers";

const CONNECTOR_ABI = [
  "event DepositLocked(bytes32 indexed txId,address indexed from,address to,uint256 amount,address currencyFrom,address currencyTo,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint256 nonce,uint256 sourceChainId)",
  "event FundsReleased(bytes32 indexed txId,uint256 amount,address currencyFrom,address currencyTo,address indexed from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint8 proofType,bytes32 proofHash,bytes32 commitment,bytes proofPayload)",
  "event AckReady(bytes32 indexed txId,uint256 amount,address currencyFrom,address currencyTo,address indexed from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint8 proofType,bytes32 proofHash,bytes32 commitment,bytes proofPayload)",
  "function getTx(bytes32 _txId) view returns ((bytes32 txId,uint256 amount,address currencyFrom,address currencyTo,address from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint64 finalizedAt,uint64 mintedAt,uint64 ackDeadline,uint8 status,uint256 nonce))"
];

const STAGES = {
  "source-deposit": {
    eventName: "DepositLocked",
    expectedStatus: 1
  },
  "destination-funds-released": {
    eventName: "FundsReleased",
    expectedStatus: 4
  },
  "source-ack-ready": {
    eventName: "AckReady",
    expectedStatus: 2
  }
};

const iface = new Interface(CONNECTOR_ABI);

function usage() {
  console.error(
    "Usage: node src/verify-connector-stage.mjs " +
      "--stage <source-deposit|destination-funds-released|source-ack-ready> " +
      "--chain-id <id> --connector <address> --tx-id <bytes32> " +
      "--expected-src-connector <address> --expected-dst-connector <address> " +
      "--rpc-urls <csv> [--prover-urls <csv>] [--beacon-urls <csv>] [--checkpointz-urls <csv>] " +
      "[--from-block <hex|latest>] [--to-block <hex|latest>] [--debug]"
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function parseCsv(value) {
  if (!value || value === true) {
    return [];
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function requireArg(args, key) {
  const value = args[key];
  if (value === undefined || value === true || value === "") {
    throw new Error(`Missing required argument --${key}`);
  }
  return String(value);
}

function parseChainId(value) {
  const text = String(value).trim();
  if (text.length === 0) {
    throw new Error("chain id must not be empty");
  }
  const asNumber = text.startsWith("0x") ? Number(BigInt(text)) : Number(text);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    throw new Error(`Invalid chain id: ${text}`);
  }
  return asNumber;
}

function normalizeBytes32(value, fieldName) {
  const text = String(value).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(text)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return text;
}

function normalizeAddress(value, fieldName) {
  try {
    return getAddress(String(value));
  } catch (error) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
}

function normalizeBlockTag(value, fallback) {
  if (!value || value === true) {
    return fallback;
  }
  return String(value);
}

async function callProofable(client, method, params, chainId) {
  const support = await client.getMethodSupport(method, params);
  if (support !== MethodType.PROOFABLE) {
    if (support === 0) {
      const error = new Error(
        `Colibri chain support missing for chain ${chainId}. ` +
          `Method ${method} cannot be verified trustlessly (methodSupport=0). ` +
          `Local dev chains like 31337/31338 are not proofable.`
      );
      error.code = "COLIBRI_UNSUPPORTED_CHAIN";
      throw error;
    }
    throw new Error(
      `Method ${method} is not proofable via Colibri on chain ${chainId}. methodSupport=${support}`
    );
  }
  return client.rpc(method, params, MethodType.PROOFABLE);
}

function assertEqualBytes32(actual, expected, fieldName) {
  if (normalizeBytes32(actual, fieldName) !== normalizeBytes32(expected, fieldName)) {
    throw new Error(`${fieldName} mismatch: expected ${expected}, got ${actual}`);
  }
}

function assertEqualAddress(actual, expected, fieldName) {
  if (normalizeAddress(actual, fieldName).toLowerCase() !== normalizeAddress(expected, fieldName).toLowerCase()) {
    throw new Error(`${fieldName} mismatch: expected ${expected}, got ${actual}`);
  }
}

function parseStatus(value) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  throw new Error(`Unsupported status value type: ${typeof value}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const stageKey = requireArg(args, "stage");
  const stage = STAGES[stageKey];
  if (!stage) {
    throw new Error(`Unsupported stage '${stageKey}'`);
  }

  const chainId = parseChainId(requireArg(args, "chain-id"));
  const connector = normalizeAddress(requireArg(args, "connector"), "connector");
  const txId = normalizeBytes32(requireArg(args, "tx-id"), "tx-id");
  const expectedSrcConnector = normalizeAddress(
    requireArg(args, "expected-src-connector"),
    "expected-src-connector"
  );
  const expectedDstConnector = normalizeAddress(
    requireArg(args, "expected-dst-connector"),
    "expected-dst-connector"
  );

  const rpcUrls = parseCsv(requireArg(args, "rpc-urls"));
  const proverUrls = parseCsv(args["prover-urls"]);
  const beaconUrls = parseCsv(args["beacon-urls"]);
  const checkpointzUrls = parseCsv(args["checkpointz-urls"]);
  const fromBlock = normalizeBlockTag(args["from-block"], "0x0");
  const toBlock = normalizeBlockTag(args["to-block"], "latest");
  const debug = Boolean(args.debug);

  if (rpcUrls.length === 0) {
    throw new Error("At least one RPC URL is required in --rpc-urls");
  }

  const client = new Colibri({
    chainId,
    rpcs: rpcUrls,
    prover: proverUrls,
    proofer: proverUrls,
    beacon_apis: beaconUrls,
    checkpointz: checkpointzUrls,
    debug
  });

  const eventFragment = iface.getEvent(stage.eventName);
  const eventTopic = eventFragment.topicHash;
  const filter = {
    address: connector,
    topics: [eventTopic, txId],
    fromBlock,
    toBlock
  };

  const logs = await callProofable(client, "eth_getLogs", [filter], chainId);
  if (!Array.isArray(logs) || logs.length === 0) {
    throw new Error(`No ${stage.eventName} event found for txId ${txId}`);
  }
  if (logs.length !== 1) {
    throw new Error(`Expected exactly 1 ${stage.eventName} event for txId ${txId}, got ${logs.length}`);
  }

  const log = logs[0];
  assertEqualAddress(log.address, connector, "log.address");

  const decodedEvent = iface.decodeEventLog(stage.eventName, log.data, log.topics);
  assertEqualBytes32(decodedEvent.txId, txId, `${stage.eventName}.txId`);
  assertEqualAddress(decodedEvent.srcChainConnector, expectedSrcConnector, `${stage.eventName}.srcChainConnector`);
  assertEqualAddress(decodedEvent.dstChainConnector, expectedDstConnector, `${stage.eventName}.dstChainConnector`);

  const getTxCallData = iface.encodeFunctionData("getTx", [txId]);
  // Use the same block tag as the log query.
  // On low-activity testnets, proving against "latest" can repeatedly target
  // an unsigned tip and never converge across retries.
  const callBlockTag = toBlock;
  const getTxRaw = await callProofable(
    client,
    "eth_call",
    [{ to: connector, data: getTxCallData }, callBlockTag],
    chainId
  );
  if (typeof getTxRaw !== "string" || !getTxRaw.startsWith("0x")) {
    throw new Error(`Unexpected eth_call getTx response: ${JSON.stringify(getTxRaw)}`);
  }

  const [tx] = iface.decodeFunctionResult("getTx", getTxRaw);
  assertEqualBytes32(tx.txId, txId, "getTx.txId");
  assertEqualAddress(tx.srcChainConnector, expectedSrcConnector, "getTx.srcChainConnector");
  assertEqualAddress(tx.dstChainConnector, expectedDstConnector, "getTx.dstChainConnector");

  const status = parseStatus(tx.status);
  if (status !== stage.expectedStatus) {
    throw new Error(
      `getTx.status mismatch for stage ${stageKey}: expected ${stage.expectedStatus}, got ${status}`
    );
  }

  console.log(
    `[colibri] stage=${stageKey} event=${stage.eventName} txId=${txId} status=${status} connector=${connector} verified`
  );
}

main().catch((error) => {
  const message = String(error?.message || error);
  if (
    !error?.code &&
    (message.includes("Unsupported chain") ||
      message.includes("verification for proof of chain") ||
      message.includes("not supported"))
  ) {
    error.code = "COLIBRI_UNSUPPORTED_CHAIN";
  }

  console.error(`[colibri] verification failed: ${error?.message || String(error)}`);
  if (error?.code === "COLIBRI_UNSUPPORTED_CHAIN") {
    process.exit(2);
  }
  process.exit(1);
});
