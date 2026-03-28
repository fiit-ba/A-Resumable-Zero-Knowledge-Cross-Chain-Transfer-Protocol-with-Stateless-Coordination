import {
  type ColibriBackend,
  type ColibriClient,
  ColibriMethodType,
  getColibriBackend
} from "../colibri/adapter.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
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
  VerificationDegradeReason,
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
const DEFAULT_COLIBRI_TRANSIENT_RETRIES = 6;
const DEFAULT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC = 12;
const DEFAULT_COLIBRI_CACHE_DIR = ".colibri-cache";

let registeredColibriStorageDir: string | undefined;
let registeredColibriBackend: ColibriBackend | undefined;

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

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  const normalized = raw.toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  return defaultValue;
}

function resolveDynamicLookbackBlocks(): number {
  return (
    parsePositiveIntegerEnv("STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS") ??
    parsePositiveIntegerEnv("COLIBRI_LOG_LOOKBACK_BLOCKS") ??
    DEFAULT_DYNAMIC_LOG_LOOKBACK_BLOCKS
  );
}

function resolveColibriTransientRetryCount(): number {
  return (
    parsePositiveIntegerEnv("STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES") ??
    parsePositiveIntegerEnv("COLIBRI_VERIFY_RETRIES") ??
    DEFAULT_COLIBRI_TRANSIENT_RETRIES
  );
}

function resolveColibriTransientRetryDelayMs(): number {
  const seconds =
    parsePositiveIntegerEnv("STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC") ??
    parsePositiveIntegerEnv("COLIBRI_VERIFY_RETRY_DELAY_SEC") ??
    DEFAULT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC;
  return seconds * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function toHexBlock(value: number): string {
  return `0x${value.toString(16)}`;
}

function parseBlockNumberValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(value);
  }
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    const asBigInt = BigInt(value);
    if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(asBigInt);
  }
  return undefined;
}

function extractLogBlockNumber(log: unknown): number | undefined {
  if (!log || typeof log !== "object") {
    return undefined;
  }

  const blockNumber = (log as { blockNumber?: unknown }).blockNumber;
  return parseBlockNumberValue(blockNumber);
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

function resolveColibriCacheDir(): string {
  const override = process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"];
  if (override && override.trim().length > 0) {
    return resolve(override.trim());
  }
  return resolve(process.cwd(), DEFAULT_COLIBRI_CACHE_DIR);
}

function createColibriFileStorage(baseDir: string): {
  get(key: string): Uint8Array | null;
  set(key: string, value: Uint8Array): void;
  del(key: string): void;
} {
  mkdirSync(baseDir, { recursive: true });

  return {
    get(key: string): Uint8Array | null {
      try {
        return readFileSync(resolve(baseDir, key));
      } catch {
        return null;
      }
    },
    set(key: string, value: Uint8Array): void {
      mkdirSync(baseDir, { recursive: true });
      writeFileSync(resolve(baseDir, key), value);
    },
    del(key: string): void {
      try {
        rmSync(resolve(baseDir, key), { force: true });
      } catch {
        // ignore delete failures in custom storage
      }
    }
  };
}

async function ensureColibriStorageRegistered(backend: ColibriBackend): Promise<void> {
  const cacheDir = resolveColibriCacheDir();
  if (registeredColibriStorageDir === cacheDir && registeredColibriBackend === backend) {
    return;
  }

  await backend.registerStorage(createColibriFileStorage(cacheDir));
  registeredColibriStorageDir = cacheDir;
  registeredColibriBackend = backend;
}

function getColibriClient(chain: ChainConfig, debug: boolean, backend: ColibriBackend): ColibriClient {
  return backend.createClient({
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

function isSyncBackwardsStateResetAllowed(): boolean {
  return parseBooleanEnv("STATELESS_CLIENT_RESET_STATE_ON_SYNC_BACKWARDS", true);
}

function listChainStateFilesInDirectory(chainId: number, directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const files = new Set<string>();
  const stateFile = resolve(directory, `states_${chainId}`);
  if (existsSync(stateFile)) {
    files.add(stateFile);
  }

  const syncPrefix = `sync_${chainId}_`;
  try {
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith(syncPrefix)) {
        files.add(resolve(directory, entry));
      }
    }
  } catch {
    // ignore unreadable directories and continue
  }

  return Array.from(files);
}

export function resetLocalColibriStateFiles(chainId: number): string[] {
  const cwd = process.cwd();
  const candidateDirectories = new Set<string>([
    resolveColibriCacheDir(),
    cwd,
    resolve(cwd, "colibri-cache"),
    resolve(cwd, ".colibri-cache"),
    resolve(cwd, ".."),
    resolve(cwd, "..", "colibri-cache"),
    resolve(cwd, "..", ".colibri-cache"),
    resolve(cwd, "..", "local-agent"),
    resolve(cwd, "..", "local-agent", "colibri-cache"),
    resolve(cwd, "..", "local-agent", ".colibri-cache"),
    resolve(cwd, "..", "stateless-client"),
    resolve(cwd, "..", "stateless-client", "colibri-cache"),
    resolve(cwd, "..", "stateless-client", ".colibri-cache")
  ]);

  const candidates = new Set<string>();
  for (const directory of candidateDirectories) {
    for (const file of listChainStateFilesInDirectory(chainId, directory)) {
      candidates.add(file);
    }
  }

  const removed: string[] = [];
  for (const file of Array.from(candidates)) {
    if (!existsSync(file)) continue;
    try {
      rmSync(file, { force: true });
      removed.push(file);
    } catch {
      // ignore and continue trying other locations
    }
  }
  return removed;
}

export function isSyncBackwardsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("last sync state is higher") &&
    error.message.includes("cannot sync backwards")
  );
}

export function isFinalizedCheckpointBootstrapError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("sync committee branch") &&
    message.includes("not found") &&
    (message.includes("not a finalized checkpoint") ||
      message.includes(
        "light client bootstrap is only supported for finalized checkpoint block roots"
      ))
  );
}

export function isParentBeaconSuccessorBlockMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("parentbeaconblockroot") &&
    message.includes("block after") &&
    (message.includes("can not be found in the execution layer") ||
      message.includes("cannot be found in the execution layer"))
  );
}

export function isBlockNotSignedYetError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("has not been signed yet and cannot be verified") ||
    message.includes("requested block has not been signed yet")
  );
}

export function isTransientSszBootstrapError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("offset for container") ||
    message.includes("offset for list") ||
    message.includes("invalid ssz structure in bootstrap data")
  );
}

export function isExceedMaximumBlockRangeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("maximum block range") &&
    message.includes("eth_getlogs")
  );
}

/**
 * Returns true when a beacon API node responds with HTTP 404 "endpoint not found"
 * for the light_client/bootstrap route.  Some beacon nodes do not implement the
 * Ethereum Light Client REST API and return a framework-level 404 (e.g. Javalin's
 * "endpointnotfound") rather than an application-level error.
 */
export function isBootstrapEndpointNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;
  return (
    (message.includes("Status: 404") || message.includes("status 404")) &&
    (message.includes("light_client/bootstrap") ||
      message.includes("endpointnotfound"))
  );
}

/**
 * Maps a Colibri error to a machine-readable degrade reason.
 * Returns undefined when the error does not match any known Chiado pattern.
 */
export function degradeReasonFromError(error: unknown): VerificationDegradeReason | undefined {
  if (isSyncBackwardsError(error)) return "chiado_sync_backwards";
  if (isTransientSszBootstrapError(error)) return "chiado_ssz_parse";
  if (isParentBeaconSuccessorBlockMissingError(error)) return "chiado_parent_beacon_missing";
  if (isFinalizedCheckpointBootstrapError(error)) return "chiado_finalization";
  if (isBlockNotSignedYetError(error)) return "chiado_block_not_signed";
  if (isBootstrapEndpointNotFoundError(error)) return "chiado_bootstrap_unsupported";
  return undefined;
}

export function isChiadoSyncBackwardsFallbackAllowed(chainId: number): boolean {
  if (chainId !== 10200) return false;
  const raw = process.env["STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK"];
  if (!raw) return true; // unset or empty → default ON for Chiado
  return raw === "1" || raw.toLowerCase() === "true";
}

function shouldFallbackToRpcForKnownChiadoColibriIssue(
  error: unknown,
  chainId: number
): boolean {
  if (!isChiadoSyncBackwardsFallbackAllowed(chainId)) return false;
  return (
    isSyncBackwardsError(error) ||
    isFinalizedCheckpointBootstrapError(error) ||
    isParentBeaconSuccessorBlockMissingError(error) ||
    isBlockNotSignedYetError(error) ||
    isTransientSszBootstrapError(error) ||
    isExceedMaximumBlockRangeError(error) ||
    isBootstrapEndpointNotFoundError(error)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function decideVerificationMode(
  input: VerificationPolicyInput
): VerificationMode {
  if (input.isLocal) {
    return "rpc-fallback";
  }

  const proofable =
    input.getLogsSupport === ColibriMethodType.PROOFABLE &&
    input.ethCallSupport === ColibriMethodType.PROOFABLE;

  if (proofable) {
    return "colibri";
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

export async function verifyAckEventOnly(
  request: VerifyStageRequest
): Promise<StageVerificationResult> {
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

  const event = connectorInterface.getEvent("AckReady");
  if (!event) {
    throw new Error("Missing ABI event fragment for AckReady");
  }
  const eventTopic = event.topicHash;
  const logRange = await resolveLogRange(effectiveBlockTag, provider);

  const logs = await provider.getLogs({
    address: connector,
    topics: [eventTopic, txId],
    fromBlock: logRange.fromBlock,
    toBlock: logRange.toBlock
  });

  if (logs.length === 0) {
    throw new Error(
      `No AckReady event found for txId ${txId} (source origin pruned path)`
    );
  }
  if (logs.length !== 1) {
    throw new Error(
      `Expected exactly 1 AckReady event for txId ${txId}, got ${logs.length}`
    );
  }

  const firstLog = logs[0];
  if (!firstLog) {
    throw new Error(
      `No AckReady event found for txId ${txId} (source origin pruned path)`
    );
  }

  validateStageLog(
    "source-ack-ready",
    firstLog,
    connector,
    txId,
    expectedSrcConnector,
    expectedDstConnector
  );

  return {
    stage: "source-ack-ready",
    mode: "rpc-fallback",
    degraded: true,
    eventName: "AckReady",
    txId,
    connector,
    status: 0,
    eventBlockNumber: extractLogBlockNumber(firstLog)
  };
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
  const rpcFilter = buildFilter(connector, eventTopic, txId, logRange);
  let colibriFilter = rpcFilter;

  const getTxCallData = connectorInterface.encodeFunctionData("getTx", [txId]);
  const callBlockTag = logRange.toBlock;
  let colibriCallBlockTag = callBlockTag;
  let colibriEthCallParams: [{ to: string; data: string }, string] = [
    { to: connector, data: getTxCallData },
    colibriCallBlockTag
  ];

  // Chiado pre-run state reset — unconditionally wipe cached sync state before
  // every verification run.  Colibri bootstraps from the first checkpointz/beacon
  // entry; if the previously cached sync period is ahead of what that endpoint
  // reports the library throws sync-backwards on the very first call.  Starting
  // from a clean slate on each run makes the outcome independent of any stale
  // on-disk state left by a previous (possibly failed) session.
  // verifyAckEventOnly does not use Colibri and is not affected.
  if (request.chain.chainId === 10200) {
    const preRunCacheDir = resolveColibriCacheDir();
    const preRunRemoved = resetLocalColibriStateFiles(request.chain.chainId);
    console.info(
      `[colibri] chain=10200 pre-run state reset: ` +
      `${preRunRemoved.length} file(s) removed from ${preRunCacheDir}`
    );
  }

  const backend = await getColibriBackend();
  await ensureColibriStorageRegistered(backend);
  let activeProverUrls = [...request.chain.proverUrls];
  let colibri = getColibriClient(
    {
      ...request.chain,
      proverUrls: activeProverUrls
    },
    Boolean(request.debug),
    backend
  );
  let stateResetAttemptedForSyncBackwards = false;
  let transientParentRootRetryAttempts = 0;
  let transientFinalizationRetryAttempts = 0;
  let transientSszRetryAttempts = 0;
  let chiadoSyncBackwardsWaitRetryAttempts = 0;
  let chiadoSyncBackwardsRangeRelaxed = false;
  let chiadoSyncBackwardsProverFallbackApplied = false;
  const maxTransientParentRootRetries = resolveColibriTransientRetryCount();
  const transientParentRootRetryDelayMs = resolveColibriTransientRetryDelayMs();
  let getLogsSupport = ColibriMethodType.NOT_SUPPORTED;
  let ethCallSupport = ColibriMethodType.NOT_SUPPORTED;
  let mode: VerificationMode;
  let degradeReason: VerificationDegradeReason | undefined;

  async function runColibriWithRecoveryRetry<T>(
    op: () => Promise<T>
  ): Promise<T> {
    async function clampColibriFilterToLatestWindow(): Promise<void> {
      const latestBlock = await provider.getBlockNumber();
      const lookback = resolveDynamicLookbackBlocks();
      const fromBlock =
        latestBlock + 1 > lookback ? latestBlock - lookback + 1 : 0;
      const toBlockHex = toHexBlock(latestBlock);

      colibriFilter = {
        ...colibriFilter,
        fromBlock: toHexBlock(fromBlock),
        toBlock: toBlockHex
      };
      colibriCallBlockTag = toBlockHex;
      colibriEthCallParams = [
        { to: connector, data: getTxCallData },
        colibriCallBlockTag
      ];
    }

    while (true) {
      try {
        return await op();
      } catch (error) {
        if (request.chain.chainId === 10200 && isSyncBackwardsError(error)) {
          if (!chiadoSyncBackwardsRangeRelaxed) {
            await clampColibriFilterToLatestWindow();
            chiadoSyncBackwardsRangeRelaxed = true;
            console.warn(
              `[colibri] chain=10200 sync-backwards detected; retrying with refreshed latest log window`
            );
            continue;
          }

          if (
            !chiadoSyncBackwardsProverFallbackApplied &&
            activeProverUrls.length > 0
          ) {
            activeProverUrls = [];
            colibri = getColibriClient(
              {
                ...request.chain,
                proverUrls: activeProverUrls
              },
              Boolean(request.debug),
              backend
            );
            chiadoSyncBackwardsProverFallbackApplied = true;
            console.warn(
              `[colibri] chain=10200 sync-backwards persists; retrying without remote prover URLs`
            );
            continue;
          }
        }

        if (
          !stateResetAttemptedForSyncBackwards &&
          isSyncBackwardsError(error) &&
          isSyncBackwardsStateResetAllowed()
        ) {
          stateResetAttemptedForSyncBackwards = true;
          const removed = resetLocalColibriStateFiles(request.chain.chainId);
          const cacheDir = resolveColibriCacheDir();
          // Recreate the Colibri instance so no stale in-memory sync state
          // survives the file reset.  Without this, the library's internal
          // period counter persists across the retry even though the persisted
          // checkpoint files were deleted.
          colibri = getColibriClient(
            { ...request.chain, proverUrls: activeProverUrls },
            Boolean(request.debug),
            backend
          );
          console.warn(
            `[colibri] sync-backwards: state reset done` +
            ` (${removed.length} file(s) removed from ${cacheDir});` +
            ` rebuilt Colibri instance with fresh in-memory state` +
            ` | rpcs=[${request.chain.rpcUrls.join(",")}]` +
            ` provers=[${activeProverUrls.join(",")}]` +
            ` beacons=[${request.chain.beaconUrls.join(",")}]` +
            ` checkpointz=[${request.chain.checkpointzUrls.join(",")}]`
          );
          continue;
        }

        if (
          isParentBeaconSuccessorBlockMissingError(error) &&
          transientParentRootRetryAttempts < maxTransientParentRootRetries
        ) {
          transientParentRootRetryAttempts += 1;
          console.warn(
            `[colibri] parent-beacon successor block unavailable; retry ${transientParentRootRetryAttempts}/${maxTransientParentRootRetries}`
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        if (
          (isFinalizedCheckpointBootstrapError(error) ||
            isBlockNotSignedYetError(error)) &&
          transientFinalizationRetryAttempts < maxTransientParentRootRetries
        ) {
          transientFinalizationRetryAttempts += 1;
          console.warn(
            `[colibri] finalized/signature readiness transient issue; retry ${transientFinalizationRetryAttempts}/${maxTransientParentRootRetries}`
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        if (
          isTransientSszBootstrapError(error) &&
          transientSszRetryAttempts < maxTransientParentRootRetries
        ) {
          transientSszRetryAttempts += 1;
          console.warn(
            `[colibri] transient SSZ/bootstrap parse issue; retry ${transientSszRetryAttempts}/${maxTransientParentRootRetries}`
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        if (
          request.chain.chainId === 10200 &&
          isExceedMaximumBlockRangeError(error)
        ) {
          await clampColibriFilterToLatestWindow();
          console.warn(
            `[colibri] chain=10200 eth_getLogs range exceeded provider limit; clamped to latest window and retrying`
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        // Wait retries only help when the beacon API is temporarily behind — not
        // when the required sync period is structurally older than the latest
        // bootstrap checkpoint.  Once a full state-cache reset has been attempted
        // and sync-backwards still occurs, waiting will never resolve the issue,
        // so skip the wait loop and let the caller fall back to rpc-fallback.
        // (If state reset was disabled via env, stateResetAttemptedForSyncBackwards
        // stays false, so wait retries are preserved as a last resort.)
        if (
          request.chain.chainId === 10200 &&
          isSyncBackwardsError(error) &&
          !stateResetAttemptedForSyncBackwards &&
          chiadoSyncBackwardsWaitRetryAttempts < maxTransientParentRootRetries
        ) {
          chiadoSyncBackwardsWaitRetryAttempts += 1;
          console.warn(
            `[colibri] chain=10200 sync-backwards persists; wait retry ${chiadoSyncBackwardsWaitRetryAttempts}/${maxTransientParentRootRetries}`
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        throw error;
      }
    }
  }

  try {
    getLogsSupport = await runColibriWithRecoveryRetry(() =>
      colibri.getMethodSupport("eth_getLogs", [colibriFilter])
    );
    ethCallSupport = await runColibriWithRecoveryRetry(() =>
      colibri.getMethodSupport("eth_call", colibriEthCallParams)
    );
    mode = decideVerificationMode({
      isLocal: request.chain.isLocal,
      getLogsSupport,
      ethCallSupport
    });
  } catch (error) {
    if (request.chain.isLocal) {
      mode = "rpc-fallback";
      degradeReason = "local_chain";
    } else if (
      shouldFallbackToRpcForKnownChiadoColibriIssue(error, request.chain.chainId)
    ) {
      degradeReason = degradeReasonFromError(error);
      console.warn(
        `[colibri] verification mode degraded to rpc-fallback after recovery attempts` +
        ` (reason=${degradeReason ?? "unknown"}): ${errorMessage(error)}`
      );
      mode = "rpc-fallback";
    } else {
      throw error;
    }
  }

  if (mode === "colibri") {
    try {
      const logs = await runColibriWithRecoveryRetry(() =>
        colibri.rpc(
          "eth_getLogs",
          [colibriFilter],
          ColibriMethodType.PROOFABLE
        )
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

      const rawTx = await runColibriWithRecoveryRetry(() =>
        colibri.rpc(
          "eth_call",
          colibriEthCallParams,
          ColibriMethodType.PROOFABLE
        )
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
        status,
        eventBlockNumber: extractLogBlockNumber(firstLog)
      };
    } catch (error) {
      if (shouldFallbackToRpcForKnownChiadoColibriIssue(error, request.chain.chainId)) {
        degradeReason = degradeReasonFromError(error);
        console.warn(
          `[colibri] proofable RPC degraded to rpc-fallback after recovery attempts` +
          ` (reason=${degradeReason ?? "unknown"}): ${errorMessage(error)}`
        );
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
    fromBlock: rpcFilter.fromBlock,
    toBlock: rpcFilter.toBlock
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
    degradeReason,
    eventName: stageDef.eventName,
    txId,
    connector,
    status,
    eventBlockNumber: extractLogBlockNumber(firstLog)
  };
}
