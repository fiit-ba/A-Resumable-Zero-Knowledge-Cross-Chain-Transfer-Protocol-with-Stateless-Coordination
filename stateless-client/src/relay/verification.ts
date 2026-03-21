import Colibri, { MethodType } from "@corpus-core/colibri-stateless";
import {
  JsonRpcProvider,
  type Log
} from "ethers";
import { connectorInterface } from "../contracts/abi.js";
import { STAGE_DEFINITIONS } from "./stages.js";
import type {
  BlockTagInput,
  ChainConfig,
  Stage,
  StageVerificationResult,
  VerificationMode
} from "../core/types.js";
import {
  normalizeAddress,
  normalizeBlockTag,
  normalizeBytes32,
  toNumberStatus,
  toRpcBlockTag
} from "../core/utils.js";

export interface VerificationPolicyInput {
  isLocal: boolean;
  getLogsSupport: number;
  ethCallSupport: number;
}

export interface VerifyStageRequest {
  stage: Stage;
  chain: ChainConfig;
  connector: string;
  txId: string;
  expectedSrcConnector: string;
  expectedDstConnector: string;
  blockTag?: BlockTagInput;
  debug?: boolean;
  provider?: JsonRpcProvider;
}

interface LogRange {
  fromBlock: string;
  toBlock: string;
}

const DEFAULT_DYNAMIC_LOG_LOOKBACK_BLOCKS = 50_000;

function parsePositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function resolveDynamicLookbackBlocks(): number {
  return (
    parsePositiveIntegerEnv("STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS") ??
    parsePositiveIntegerEnv("COLIBRI_LOG_LOOKBACK_BLOCKS") ??
    DEFAULT_DYNAMIC_LOG_LOOKBACK_BLOCKS
  );
}

function toHexBlock(value: number): string {
  return `0x${value.toString(16)}`;
}

async function resolveBlockNumberForTag(
  provider: JsonRpcProvider,
  rpcTag: string
): Promise<number | undefined> {
  try {
    const block = await provider.send("eth_getBlockByNumber", [rpcTag, false]);
    if (
      block &&
      typeof block === "object" &&
      "number" in block &&
      typeof block.number === "string" &&
      /^0x[0-9a-fA-F]+$/.test(block.number)
    ) {
      const parsed = Number(BigInt(block.number));
      if (Number.isSafeInteger(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  } catch {
    // Fall through to latest fallback below.
  }

  if (rpcTag === "latest") {
    return undefined;
  }

  return resolveBlockNumberForTag(provider, "latest");
}

async function resolveLogRange(
  blockTag: BlockTagInput,
  provider: JsonRpcProvider
): Promise<LogRange> {
  const normalized = normalizeBlockTag(blockTag, "latest");
  if (typeof normalized === "number") {
    const hex = toRpcBlockTag(normalized);
    return { fromBlock: hex, toBlock: hex };
  }

  const rpcTag = toRpcBlockTag(normalized);
  if (rpcTag.startsWith("0x")) {
    return { fromBlock: rpcTag, toBlock: rpcTag };
  }

  if (rpcTag === "earliest") {
    return { fromBlock: "0x0", toBlock: "0x0" };
  }

  const toBlock = await resolveBlockNumberForTag(provider, rpcTag);
  if (toBlock === undefined) {
    return {
      fromBlock: "0x0",
      toBlock: rpcTag
    };
  }

  const lookback = resolveDynamicLookbackBlocks();
  const fromBlock =
    toBlock + 1 > lookback ? toBlock - lookback + 1 : 0;

  return {
    fromBlock: toHexBlock(fromBlock),
    toBlock: toHexBlock(toBlock)
  };
}

function normalizeTopicTxId(txId: string): string {
  return normalizeBytes32(txId, "txId");
}

function getColibriClient(chain: ChainConfig, debug: boolean): Colibri {
  return new Colibri({
    chainId: chain.chainId,
    rpcs: chain.rpcUrls,
    prover: chain.proverUrls,
    beacon_apis: chain.beaconUrls,
    checkpointz: chain.checkpointzUrls,
    debug
  });
}

function buildFilter(
  connector: string,
  eventTopic: string,
  txId: string,
  range: LogRange
): {
  address: string;
  topics: [string, string];
  fromBlock: string;
  toBlock: string;
} {
  return {
    address: connector,
    topics: [eventTopic, txId],
    fromBlock: range.fromBlock,
    toBlock: range.toBlock
  };
}

export function isSyncBackwardsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("last sync state is higher") &&
    error.message.includes("cannot sync backwards")
  );
}

export function isChiadoSyncBackwardsFallbackAllowed(chainId: number): boolean {
  if (chainId !== 10200) return false;
  const raw = process.env["STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK"];
  if (!raw) return true; // unset or empty → default ON for Chiado
  return raw === "1" || raw.toLowerCase() === "true";
}

export function decideVerificationMode(
  input: VerificationPolicyInput
): VerificationMode {
  const proofable =
    input.getLogsSupport === MethodType.PROOFABLE &&
    input.ethCallSupport === MethodType.PROOFABLE;

  if (proofable) {
    return "colibri";
  }

  if (input.isLocal) {
    return "rpc-fallback";
  }

  throw new Error(
    `Colibri does not report both methods as proofable (eth_getLogs=${input.getLogsSupport}, eth_call=${input.ethCallSupport}) for a non-local chain.`
  );
}

export function validateStageLog(
  stage: Stage,
  log: Pick<Log, "address" | "data" | "topics">,
  connector: string,
  txId: string,
  expectedSrcConnector: string,
  expectedDstConnector: string
): void {
  const stageDef = STAGE_DEFINITIONS[stage];
  const normalizedConnector = normalizeAddress(connector, "connector");
  const normalizedTxId = normalizeTopicTxId(txId);
  const normalizedSrc = normalizeAddress(
    expectedSrcConnector,
    "expectedSrcConnector"
  );
  const normalizedDst = normalizeAddress(
    expectedDstConnector,
    "expectedDstConnector"
  );

  const logAddress = normalizeAddress(log.address, "log.address");
  if (logAddress.toLowerCase() !== normalizedConnector.toLowerCase()) {
    throw new Error(
      `log.address mismatch: expected ${normalizedConnector}, got ${logAddress}`
    );
  }

  const decoded = connectorInterface.decodeEventLog(
    stageDef.eventName,
    log.data,
    Array.from(log.topics)
  );

  const eventTxId = normalizeBytes32(decoded.txId, `${stageDef.eventName}.txId`);
  if (eventTxId !== normalizedTxId) {
    throw new Error(
      `${stageDef.eventName}.txId mismatch: expected ${normalizedTxId}, got ${eventTxId}`
    );
  }

  const src = normalizeAddress(
    decoded.srcChainConnector,
    `${stageDef.eventName}.srcChainConnector`
  );
  if (src.toLowerCase() !== normalizedSrc.toLowerCase()) {
    throw new Error(
      `${stageDef.eventName}.srcChainConnector mismatch: expected ${normalizedSrc}, got ${src}`
    );
  }

  const dst = normalizeAddress(
    decoded.dstChainConnector,
    `${stageDef.eventName}.dstChainConnector`
  );
  if (dst.toLowerCase() !== normalizedDst.toLowerCase()) {
    throw new Error(
      `${stageDef.eventName}.dstChainConnector mismatch: expected ${normalizedDst}, got ${dst}`
    );
  }
}

function validateGetTxResult(
  stage: Stage,
  txId: string,
  expectedSrcConnector: string,
  expectedDstConnector: string,
  tx: {
    txId: string;
    srcChainConnector: string;
    dstChainConnector: string;
    status: string | number | bigint;
  }
): number {
  const stageDef = STAGE_DEFINITIONS[stage];
  const normalizedTxId = normalizeBytes32(txId, "txId");
  const observedTxId = normalizeBytes32(tx.txId, "getTx.txId");
  if (observedTxId !== normalizedTxId) {
    throw new Error(
      `getTx.txId mismatch: expected ${normalizedTxId}, got ${observedTxId}`
    );
  }

  const expectedSrc = normalizeAddress(expectedSrcConnector, "expectedSrcConnector");
  const observedSrc = normalizeAddress(tx.srcChainConnector, "getTx.srcChainConnector");
  if (observedSrc.toLowerCase() !== expectedSrc.toLowerCase()) {
    throw new Error(
      `getTx.srcChainConnector mismatch: expected ${expectedSrc}, got ${observedSrc}`
    );
  }

  const expectedDst = normalizeAddress(expectedDstConnector, "expectedDstConnector");
  const observedDst = normalizeAddress(tx.dstChainConnector, "getTx.dstChainConnector");
  if (observedDst.toLowerCase() !== expectedDst.toLowerCase()) {
    throw new Error(
      `getTx.dstChainConnector mismatch: expected ${expectedDst}, got ${observedDst}`
    );
  }

  const status = toNumberStatus(tx.status);
  if (status !== stageDef.expectedStatus) {
    throw new Error(
      `getTx.status mismatch for stage ${stage}: expected ${stageDef.expectedStatus}, got ${status}`
    );
  }

  return status;
}

export async function verifyStage(
  request: VerifyStageRequest
): Promise<StageVerificationResult> {
  const stageDef = STAGE_DEFINITIONS[request.stage];
  const connector = normalizeAddress(request.connector, "connector");
  const txId = normalizeBytes32(request.txId, "txId");
  const expectedSrcConnector = normalizeAddress(
    request.expectedSrcConnector,
    "expectedSrcConnector"
  );
  const expectedDstConnector = normalizeAddress(
    request.expectedDstConnector,
    "expectedDstConnector"
  );
  const effectiveBlockTag = normalizeBlockTag(request.blockTag, "latest");
  const provider =
    request.provider ??
    new JsonRpcProvider(request.chain.rpcUrls[0], request.chain.chainId);

  const event = connectorInterface.getEvent(stageDef.eventName);
  if (!event) {
    throw new Error(`Missing ABI event fragment for ${stageDef.eventName}`);
  }
  const eventTopic = event.topicHash;
  const logRange = await resolveLogRange(effectiveBlockTag, provider);
  const filter = buildFilter(connector, eventTopic, txId, logRange);

  const getTxCallData = connectorInterface.encodeFunctionData("getTx", [txId]);
  const callBlockTag = logRange.toBlock;
  const ethCallParams = [{ to: connector, data: getTxCallData }, callBlockTag];

  const colibri = getColibriClient(request.chain, Boolean(request.debug));
  let getLogsSupport = MethodType.NOT_SUPPORTED;
  let ethCallSupport = MethodType.NOT_SUPPORTED;
  let mode: VerificationMode;

  try {
    getLogsSupport = await colibri.getMethodSupport("eth_getLogs", [filter]);
    ethCallSupport = await colibri.getMethodSupport("eth_call", ethCallParams);
    mode = decideVerificationMode({
      isLocal: request.chain.isLocal,
      getLogsSupport,
      ethCallSupport
    });
  } catch (error) {
    if (request.chain.isLocal) {
      mode = "rpc-fallback";
    } else if (
      isSyncBackwardsError(error) &&
      isChiadoSyncBackwardsFallbackAllowed(request.chain.chainId)
    ) {
      mode = "rpc-fallback";
    } else {
      throw error;
    }
  }

  if (mode === "colibri") {
    try {
      const logs = await colibri.rpc(
        "eth_getLogs",
        [filter],
        MethodType.PROOFABLE
      );

      if (!Array.isArray(logs) || logs.length === 0) {
        throw new Error(`No ${stageDef.eventName} event found for txId ${txId}`);
      }
      if (logs.length !== 1) {
        throw new Error(
          `Expected exactly 1 ${stageDef.eventName} event for txId ${txId}, got ${logs.length}`
        );
      }

      const firstLog = logs[0];
      if (!firstLog) {
        throw new Error(`No ${stageDef.eventName} event found for txId ${txId}`);
      }

      validateStageLog(
        request.stage,
        firstLog as Log,
        connector,
        txId,
        expectedSrcConnector,
        expectedDstConnector
      );

      const rawTx = await colibri.rpc(
        "eth_call",
        ethCallParams,
        MethodType.PROOFABLE
      );

      if (typeof rawTx !== "string" || !rawTx.startsWith("0x")) {
        throw new Error(`Unexpected getTx response from eth_call: ${JSON.stringify(rawTx)}`);
      }

      const [tx] = connectorInterface.decodeFunctionResult("getTx", rawTx);
      const status = validateGetTxResult(
        request.stage,
        txId,
        expectedSrcConnector,
        expectedDstConnector,
        tx
      );

      return {
        stage: request.stage,
        mode,
        degraded: false,
        eventName: stageDef.eventName,
        txId,
        connector,
        status
      };
    } catch (error) {
      if (
        isSyncBackwardsError(error) &&
        isChiadoSyncBackwardsFallbackAllowed(request.chain.chainId)
      ) {
        mode = "rpc-fallback";
        // fall through to RPC fallback path below
      } else {
        throw error;
      }
    }
  }

  const logs = await provider.getLogs({
    address: connector,
    topics: [eventTopic, txId],
    fromBlock: logRange.fromBlock,
    toBlock: logRange.toBlock
  });

  if (logs.length === 0) {
    throw new Error(`No ${stageDef.eventName} event found for txId ${txId}`);
  }
  if (logs.length !== 1) {
    throw new Error(
      `Expected exactly 1 ${stageDef.eventName} event for txId ${txId}, got ${logs.length}`
    );
  }

  const firstLog = logs[0];
  if (!firstLog) {
    throw new Error(`No ${stageDef.eventName} event found for txId ${txId}`);
  }

  validateStageLog(
    request.stage,
    firstLog,
    connector,
    txId,
    expectedSrcConnector,
    expectedDstConnector
  );

  const rawTx = await provider.send("eth_call", [
    {
      to: connector,
      data: getTxCallData
    },
    callBlockTag
  ]);

  const [tx] = connectorInterface.decodeFunctionResult("getTx", rawTx);
  const status = validateGetTxResult(
    request.stage,
    txId,
    expectedSrcConnector,
    expectedDstConnector,
    tx
  );

  return {
    stage: request.stage,
    mode,
    degraded: true,
    eventName: stageDef.eventName,
    txId,
    connector,
    status
  };
}
