import {
  type ColibriBackend,
  type ColibriClient,
  ColibriMethodType,
  getColibriBackend,
} from "../colibri/adapter.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JsonRpcProvider, type Log } from "ethers";
import { connectorInterface, eventTopic } from "../contracts/abi.js";
import { STAGE_DEFINITIONS } from "./stages.js";
import type {
  BlockTagInput,
  ChainConfig,
  Stage,
  StageDefinition,
  StageVerificationPolicy,
  StageVerificationResult,
  VerificationDegradeReason,
  VerificationMode,
} from "../core/types.js";
import {
  assertSameAddress,
  errorMessage,
  normalizeAddress,
  normalizeBlockTag,
  normalizeBytes32,
  readBooleanEnv,
  readPositiveIntEnv,
  toNumberStatus,
  toRpcBlockTag,
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
  verificationPolicy?: StageVerificationPolicy;
}

interface LogRange {
  fromBlock: string;
  toBlock: string;
}

const DEFAULT_DYNAMIC_LOG_LOOKBACK_BLOCKS = 50_000;
const DEFAULT_COLIBRI_TRANSIENT_RETRIES = 6;
const DEFAULT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC = 12;
const DEFAULT_COLIBRI_CACHE_DIR = ".colibri-cache";

/** Gnosis Chiado. Its Colibri/beacon infrastructure needs extra recovery handling. */
const CHIADO_CHAIN_ID = 10200;

let registeredColibriStorageDir: string | undefined;
let registeredColibriBackend: ColibriBackend | undefined;

const STAGE_EVENT_CONNECTOR_FIELDS: Record<
  Stage,
  { srcChainConnector: boolean; dstChainConnector: boolean }
> = {
  "source-deposit": { srcChainConnector: true, dstChainConnector: true },
  "destination-funds-released": { srcChainConnector: true, dstChainConnector: true },
  "source-ack-ready": { srcChainConnector: true, dstChainConnector: true },
  "source-refund-initiated": { srcChainConnector: true, dstChainConnector: false },
  "destination-burn-executed": { srcChainConnector: true, dstChainConnector: true },
};

const EVENT_ONLY_STAGES = new Set<Stage>(["source-ack-ready", "destination-burn-executed"]);

function resolveDynamicLookbackBlocks(): number {
  return (
    readPositiveIntEnv("STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS", "COLIBRI_LOG_LOOKBACK_BLOCKS") ??
    DEFAULT_DYNAMIC_LOG_LOOKBACK_BLOCKS
  );
}

function resolveColibriTransientRetryCount(): number {
  return (
    readPositiveIntEnv("STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES", "COLIBRI_VERIFY_RETRIES") ??
    DEFAULT_COLIBRI_TRANSIENT_RETRIES
  );
}

function resolveColibriTransientRetryDelayMs(): number {
  const seconds =
    readPositiveIntEnv(
      "STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC",
      "COLIBRI_VERIFY_RETRY_DELAY_SEC",
    ) ?? DEFAULT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC;
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
  rpcTag: string,
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
  provider: JsonRpcProvider,
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
      toBlock: rpcTag,
    };
  }

  const lookback = resolveDynamicLookbackBlocks();
  const fromBlock = toBlock + 1 > lookback ? toBlock - lookback + 1 : 0;

  return {
    fromBlock: toHexBlock(fromBlock),
    toBlock: toHexBlock(toBlock),
  };
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
    },
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

function getColibriClient(
  chain: ChainConfig,
  debug: boolean,
  backend: ColibriBackend,
): ColibriClient {
  return backend.createClient({
    chainId: chain.chainId,
    rpcs: chain.rpcUrls,
    prover: chain.proverUrls,
    beacon_apis: chain.beaconUrls,
    checkpointz: chain.checkpointzUrls,
    debug,
  });
}

function buildFilter(
  connector: string,
  eventTopic: string,
  txId: string,
  range: LogRange,
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
    toBlock: range.toBlock,
  };
}

function isSyncBackwardsStateResetAllowed(): boolean {
  return readBooleanEnv("STATELESS_CLIENT_RESET_STATE_ON_SYNC_BACKWARDS", true);
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
    resolve(cwd, "..", "stateless-client"),
    resolve(cwd, "..", "stateless-client", "colibri-cache"),
    resolve(cwd, "..", "stateless-client", ".colibri-cache"),
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
        "light client bootstrap is only supported for finalized checkpoint block roots",
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
  return message.includes("maximum block range") && message.includes("eth_getlogs");
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
    (message.includes("light_client/bootstrap") || message.includes("endpointnotfound"))
  );
}

/**
 * Returns true when the Colibri transport responds with a generic HTTP 503
 * (Service Unavailable) with no significant body — the observed failure form
 * during Chiado Colibri transient unavailability.
 *
 * Matches exactly "HTTP error! Status: 503" or the same with an empty
 * "Details:" suffix (e.g. "HTTP error! Status: 503, Details: ").
 * Errors that carry a non-empty details payload are NOT matched — they may
 * contain actionable information that should surface to the caller.
 */
export function isChiadoColibriTransportUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (!message.startsWith("HTTP error! Status: 503")) return false;
  return (
    message === "HTTP error! Status: 503" || /^HTTP error! Status: 503, Details:\s*$/.test(message)
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
  if (chainId !== CHIADO_CHAIN_ID) return false;
  const raw = process.env["STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK"];
  if (!raw) return true; // unset or empty → default ON for Chiado
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Colibri failures known to be transient or infrastructure-related rather than invalid proofs. */
const KNOWN_TRANSIENT_COLIBRI_ERRORS: ReadonlyArray<(error: unknown) => boolean> = [
  isSyncBackwardsError,
  isFinalizedCheckpointBootstrapError,
  isParentBeaconSuccessorBlockMissingError,
  isBlockNotSignedYetError,
  isTransientSszBootstrapError,
  isExceedMaximumBlockRangeError,
];

function isKnownTransientColibriError(error: unknown): boolean {
  return KNOWN_TRANSIENT_COLIBRI_ERRORS.some((matches) => matches(error));
}

function shouldFallbackToRpcForKnownChiadoColibriIssue(error: unknown, chainId: number): boolean {
  if (!isChiadoSyncBackwardsFallbackAllowed(chainId)) return false;
  return isKnownTransientColibriError(error) || isBootstrapEndpointNotFoundError(error);
}

function shouldRetryPrunedAckColibriError(error: unknown): boolean {
  return isKnownTransientColibriError(error) || isChiadoColibriTransportUnavailableError(error);
}

export function decideVerificationMode(input: VerificationPolicyInput): VerificationMode {
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
    `Colibri does not report both methods as proofable (eth_getLogs=${input.getLogsSupport}, eth_call=${input.ethCallSupport}) for a non-local chain.`,
  );
}

export function validateStageLog(
  stage: Stage,
  log: Pick<Log, "address" | "data" | "topics">,
  connector: string,
  txId: string,
  expectedSrcConnector: string,
  expectedDstConnector: string,
): void {
  const { eventName } = STAGE_DEFINITIONS[stage];
  const normalizedTxId = normalizeBytes32(txId, "txId");

  assertSameAddress("log.address", connector, log.address);

  const decoded = connectorInterface.decodeEventLog(eventName, log.data, Array.from(log.topics));

  const eventTxId = normalizeBytes32(decoded.txId, `${eventName}.txId`);
  if (eventTxId !== normalizedTxId) {
    throw new Error(`${eventName}.txId mismatch: expected ${normalizedTxId}, got ${eventTxId}`);
  }

  const connectorFields = STAGE_EVENT_CONNECTOR_FIELDS[stage];
  if (connectorFields.srcChainConnector) {
    assertSameAddress(
      `${eventName}.srcChainConnector`,
      expectedSrcConnector,
      decoded.srcChainConnector,
    );
  }
  if (connectorFields.dstChainConnector) {
    assertSameAddress(
      `${eventName}.dstChainConnector`,
      expectedDstConnector,
      decoded.dstChainConnector,
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
  },
): number {
  const stageDef = STAGE_DEFINITIONS[stage];
  const normalizedTxId = normalizeBytes32(txId, "txId");
  const observedTxId = normalizeBytes32(tx.txId, "getTx.txId");
  if (observedTxId !== normalizedTxId) {
    throw new Error(`getTx.txId mismatch: expected ${normalizedTxId}, got ${observedTxId}`);
  }

  assertSameAddress("getTx.srcChainConnector", expectedSrcConnector, tx.srcChainConnector);
  assertSameAddress("getTx.dstChainConnector", expectedDstConnector, tx.dstChainConnector);

  const status = toNumberStatus(tx.status);
  if (status !== stageDef.expectedStatus) {
    throw new Error(
      `getTx.status mismatch for stage ${stage}: expected ${stageDef.expectedStatus}, got ${status}`,
    );
  }

  return status;
}

/** Normalised inputs and RPC filters shared by both verification paths. */
interface VerificationContext {
  eventName: StageDefinition["eventName"];
  connector: string;
  txId: string;
  expectedSrcConnector: string;
  expectedDstConnector: string;
  provider: JsonRpcProvider;
  eventTopic: string;
  rpcFilter: ReturnType<typeof buildFilter>;
}

async function prepareVerification(request: VerifyStageRequest): Promise<VerificationContext> {
  const { eventName } = STAGE_DEFINITIONS[request.stage];
  const connector = normalizeAddress(request.connector, "connector");
  const txId = normalizeBytes32(request.txId, "txId");
  const provider =
    request.provider ?? new JsonRpcProvider(request.chain.rpcUrls[0], request.chain.chainId);
  const topic = eventTopic(eventName);
  const logRange = await resolveLogRange(normalizeBlockTag(request.blockTag, "latest"), provider);

  return {
    eventName,
    connector,
    txId,
    expectedSrcConnector: normalizeAddress(request.expectedSrcConnector, "expectedSrcConnector"),
    expectedDstConnector: normalizeAddress(request.expectedDstConnector, "expectedDstConnector"),
    provider,
    eventTopic: topic,
    rpcFilter: buildFilter(connector, topic, txId, logRange),
  };
}

/** Asserts that exactly one matching event log was returned and yields it. */
function requireSingleLog(logs: unknown, ctx: VerificationContext, pathLabel = ""): Log {
  const suffix = pathLabel ? ` (${pathLabel})` : "";
  if (!Array.isArray(logs) || logs.length === 0 || !logs[0]) {
    throw new Error(`No ${ctx.eventName} event found for txId ${ctx.txId}${suffix}`);
  }
  if (logs.length !== 1) {
    throw new Error(
      `Expected exactly 1 ${ctx.eventName} event for txId ${ctx.txId}, got ${logs.length}`,
    );
  }
  return logs[0] as Log;
}

function validateLog(request: VerifyStageRequest, ctx: VerificationContext, log: Log): void {
  validateStageLog(
    request.stage,
    log,
    ctx.connector,
    ctx.txId,
    ctx.expectedSrcConnector,
    ctx.expectedDstConnector,
  );
}

function fetchRpcLogs(ctx: VerificationContext): Promise<Log[]> {
  return ctx.provider.getLogs({
    address: ctx.connector,
    topics: [ctx.eventTopic, ctx.txId],
    fromBlock: ctx.rpcFilter.fromBlock,
    toBlock: ctx.rpcFilter.toBlock,
  });
}

function stageResult(
  request: VerifyStageRequest,
  ctx: VerificationContext,
  fields: Pick<StageVerificationResult, "mode" | "degraded" | "degradeReason" | "status">,
  log: Log,
): StageVerificationResult {
  return {
    stage: request.stage,
    ...fields,
    eventName: ctx.eventName,
    txId: ctx.txId,
    connector: ctx.connector,
    eventBlockNumber: extractLogBlockNumber(log),
  };
}

function resetColibriStateForRetryPolicy(request: VerifyStageRequest): void {
  const removed = resetLocalColibriStateFiles(request.chain.chainId);
  console.info(
    `[colibri] retry-from-scratch policy active for ${request.stage}:` +
      ` removed ${removed.length} cached state file(s) for chain=${request.chain.chainId}`,
  );
}

/**
 * Verifies a stage from its event log alone, without a `getTx` state read. Used
 * for stages whose on-chain record has already been deleted by `_cleanupTx`.
 */
export async function verifyStageEventOnly(
  request: VerifyStageRequest,
): Promise<StageVerificationResult> {
  const ctx = await prepareVerification(request);
  const { expectedStatus } = STAGE_DEFINITIONS[request.stage];
  let degradeReason: VerificationDegradeReason | undefined;

  if (!request.chain.isLocal) {
    if (request.verificationPolicy?.retryColibriFromScratch) {
      resetColibriStateForRetryPolicy(request);
    }

    const maxColibriRetries = resolveColibriTransientRetryCount();
    let lastColibriError: unknown;

    for (let attempt = 0; attempt <= maxColibriRetries; attempt += 1) {
      try {
        const backend = await getColibriBackend();
        await ensureColibriStorageRegistered(backend);
        const colibri = getColibriClient(request.chain, Boolean(request.debug), backend);

        const getLogsSupport = await colibri.getMethodSupport("eth_getLogs", [ctx.rpcFilter]);
        if (getLogsSupport !== ColibriMethodType.PROOFABLE) {
          throw new Error(
            `Colibri eth_getLogs is not proofable for ${request.stage} event-only verification (support=${getLogsSupport})`,
          );
        }

        const logs = await colibri.rpc("eth_getLogs", [ctx.rpcFilter], ColibriMethodType.PROOFABLE);
        const log = requireSingleLog(logs, ctx, "event-only path");
        validateLog(request, ctx, log);

        return stageResult(
          request,
          ctx,
          { mode: "colibri", degraded: false, status: expectedStatus },
          log,
        );
      } catch (error) {
        lastColibriError = error;
        const shouldRetry =
          attempt < maxColibriRetries && shouldRetryPrunedAckColibriError(lastColibriError);
        if (!shouldRetry) {
          break;
        }

        if (isSyncBackwardsError(lastColibriError) && isSyncBackwardsStateResetAllowed()) {
          const removed = resetLocalColibriStateFiles(request.chain.chainId);
          console.warn(
            `[colibri] ${request.stage} event-only sync-backwards: state reset removed ${removed.length} file(s);` +
              ` retry ${attempt + 1}/${maxColibriRetries}`,
          );
        } else {
          console.warn(
            `[colibri] ${request.stage} event-only transient Colibri issue; retry ${attempt + 1}/${maxColibriRetries}: ` +
              `${errorMessage(lastColibriError)}`,
          );
        }
      }
    }

    degradeReason = degradeReasonFromError(lastColibriError);
    console.warn(
      `[colibri] ${request.stage} event-only verification degraded to rpc-fallback` +
        ` (reason=${degradeReason ?? "unknown"}): ${errorMessage(lastColibriError)}`,
    );
  } else {
    degradeReason = "local_chain";
  }

  const log = requireSingleLog(await fetchRpcLogs(ctx), ctx, "event-only path");
  validateLog(request, ctx, log);

  return stageResult(
    request,
    ctx,
    { mode: "rpc-fallback", degraded: true, degradeReason, status: expectedStatus },
    log,
  );
}

export async function verifyAckEventOnly(
  request: VerifyStageRequest,
): Promise<StageVerificationResult> {
  return verifyStageEventOnly(request);
}

export async function verifyStage(request: VerifyStageRequest): Promise<StageVerificationResult> {
  if (EVENT_ONLY_STAGES.has(request.stage)) {
    return verifyStageEventOnly(request);
  }

  const ctx = await prepareVerification(request);
  const { connector, txId, expectedSrcConnector, expectedDstConnector, provider, rpcFilter } = ctx;
  let colibriFilter = rpcFilter;

  const getTxCallData = connectorInterface.encodeFunctionData("getTx", [txId]);
  const callBlockTag = rpcFilter.toBlock;
  let colibriCallBlockTag = callBlockTag;
  let colibriEthCallParams: [{ to: string; data: string }, string] = [
    { to: connector, data: getTxCallData },
    colibriCallBlockTag,
  ];

  if (request.verificationPolicy?.retryColibriFromScratch && !request.chain.isLocal) {
    resetColibriStateForRetryPolicy(request);
  }

  // Chiado pre-run state reset — unconditionally wipe cached sync state before
  // every verification run.  Colibri bootstraps from the first checkpointz/beacon
  // entry; if the previously cached sync period is ahead of what that endpoint
  // reports the library throws sync-backwards on the very first call.  Starting
  // from a clean slate on each run makes the outcome independent of any stale
  // on-disk state left by a previous (possibly failed) session.
  // verifyAckEventOnly has its own Colibri-first path and separate policy handling.
  if (request.chain.chainId === CHIADO_CHAIN_ID) {
    const preRunCacheDir = resolveColibriCacheDir();
    const preRunRemoved = resetLocalColibriStateFiles(request.chain.chainId);
    console.info(
      `[colibri] chain=10200 pre-run state reset: ` +
        `${preRunRemoved.length} file(s) removed from ${preRunCacheDir}`,
    );
  }

  const backend = await getColibriBackend();
  await ensureColibriStorageRegistered(backend);
  let activeProverUrls = [...request.chain.proverUrls];
  let colibri = getColibriClient(
    {
      ...request.chain,
      proverUrls: activeProverUrls,
    },
    Boolean(request.debug),
    backend,
  );
  let stateResetAttemptedForSyncBackwards = false;
  let transientParentRootRetryAttempts = 0;
  let transientFinalizationRetryAttempts = 0;
  let transientSszRetryAttempts = 0;
  let chiadoSyncBackwardsWaitRetryAttempts = 0;
  let transientColibriTransportRetryAttempts = 0;
  let chiadoSyncBackwardsRangeRelaxed = false;
  let chiadoSyncBackwardsProverFallbackApplied = false;
  const maxTransientParentRootRetries = resolveColibriTransientRetryCount();
  const transientParentRootRetryDelayMs = resolveColibriTransientRetryDelayMs();
  let getLogsSupport = ColibriMethodType.NOT_SUPPORTED;
  let ethCallSupport = ColibriMethodType.NOT_SUPPORTED;
  let mode: VerificationMode;
  let degradeReason: VerificationDegradeReason | undefined;

  async function runColibriWithRecoveryRetry<T>(
    operationLabel: string,
    op: () => Promise<T>,
  ): Promise<T> {
    async function clampColibriFilterToLatestWindow(): Promise<void> {
      const latestBlock = await provider.getBlockNumber();
      const lookback = resolveDynamicLookbackBlocks();
      const fromBlock = latestBlock + 1 > lookback ? latestBlock - lookback + 1 : 0;
      const toBlockHex = toHexBlock(latestBlock);

      colibriFilter = {
        ...colibriFilter,
        fromBlock: toHexBlock(fromBlock),
        toBlock: toBlockHex,
      };
      colibriCallBlockTag = toBlockHex;
      colibriEthCallParams = [{ to: connector, data: getTxCallData }, colibriCallBlockTag];
    }

    while (true) {
      try {
        return await op();
      } catch (error) {
        if (request.chain.chainId === CHIADO_CHAIN_ID && isSyncBackwardsError(error)) {
          if (!chiadoSyncBackwardsRangeRelaxed) {
            await clampColibriFilterToLatestWindow();
            chiadoSyncBackwardsRangeRelaxed = true;
            console.warn(
              `[colibri] chain=10200 sync-backwards detected; retrying with refreshed latest log window`,
            );
            continue;
          }

          if (!chiadoSyncBackwardsProverFallbackApplied && activeProverUrls.length > 0) {
            activeProverUrls = [];
            colibri = getColibriClient(
              {
                ...request.chain,
                proverUrls: activeProverUrls,
              },
              Boolean(request.debug),
              backend,
            );
            chiadoSyncBackwardsProverFallbackApplied = true;
            console.warn(
              `[colibri] chain=10200 sync-backwards persists; retrying without remote prover URLs`,
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
            backend,
          );
          console.warn(
            `[colibri] sync-backwards: state reset done` +
              ` (${removed.length} file(s) removed from ${cacheDir});` +
              ` rebuilt Colibri instance with fresh in-memory state` +
              ` | rpcs=[${request.chain.rpcUrls.join(",")}]` +
              ` provers=[${activeProverUrls.join(",")}]` +
              ` beacons=[${request.chain.beaconUrls.join(",")}]` +
              ` checkpointz=[${request.chain.checkpointzUrls.join(",")}]`,
          );
          continue;
        }

        if (
          isParentBeaconSuccessorBlockMissingError(error) &&
          transientParentRootRetryAttempts < maxTransientParentRootRetries
        ) {
          transientParentRootRetryAttempts += 1;
          console.warn(
            `[colibri] parent-beacon successor block unavailable; retry ${transientParentRootRetryAttempts}/${maxTransientParentRootRetries}`,
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        if (
          (isFinalizedCheckpointBootstrapError(error) || isBlockNotSignedYetError(error)) &&
          transientFinalizationRetryAttempts < maxTransientParentRootRetries
        ) {
          transientFinalizationRetryAttempts += 1;
          console.warn(
            `[colibri] finalized/signature readiness transient issue; retry ${transientFinalizationRetryAttempts}/${maxTransientParentRootRetries}`,
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
            `[colibri] transient SSZ/bootstrap parse issue; retry ${transientSszRetryAttempts}/${maxTransientParentRootRetries}`,
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        if (request.chain.chainId === CHIADO_CHAIN_ID && isExceedMaximumBlockRangeError(error)) {
          await clampColibriFilterToLatestWindow();
          console.warn(
            `[colibri] chain=10200 eth_getLogs range exceeded provider limit; clamped to latest window and retrying`,
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
          request.chain.chainId === CHIADO_CHAIN_ID &&
          isSyncBackwardsError(error) &&
          !stateResetAttemptedForSyncBackwards &&
          chiadoSyncBackwardsWaitRetryAttempts < maxTransientParentRootRetries
        ) {
          chiadoSyncBackwardsWaitRetryAttempts += 1;
          console.warn(
            `[colibri] chain=10200 sync-backwards persists; wait retry ${chiadoSyncBackwardsWaitRetryAttempts}/${maxTransientParentRootRetries}`,
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        if (
          request.chain.chainId === CHIADO_CHAIN_ID &&
          isChiadoColibriTransportUnavailableError(error) &&
          transientColibriTransportRetryAttempts < maxTransientParentRootRetries
        ) {
          transientColibriTransportRetryAttempts += 1;
          console.warn(
            `[colibri] chain=10200 transport unavailable 503 (${operationLabel}); retry ${transientColibriTransportRetryAttempts}/${maxTransientParentRootRetries}`,
          );
          await sleep(transientParentRootRetryDelayMs);
          continue;
        }

        if (
          request.chain.chainId === CHIADO_CHAIN_ID &&
          isChiadoColibriTransportUnavailableError(error)
        ) {
          throw new Error(
            `[colibri] ${operationLabel}: Colibri transport unavailable (503) after ${transientColibriTransportRetryAttempts} retries — ${errorMessage(error)}`,
          );
        }

        throw error;
      }
    }
  }

  try {
    getLogsSupport = await runColibriWithRecoveryRetry("method-support eth_getLogs", () =>
      colibri.getMethodSupport("eth_getLogs", [colibriFilter]),
    );
    ethCallSupport = await runColibriWithRecoveryRetry("method-support eth_call", () =>
      colibri.getMethodSupport("eth_call", colibriEthCallParams),
    );
    mode = decideVerificationMode({
      isLocal: request.chain.isLocal,
      getLogsSupport,
      ethCallSupport,
    });
  } catch (error) {
    if (request.chain.isLocal) {
      mode = "rpc-fallback";
      degradeReason = "local_chain";
    } else if (shouldFallbackToRpcForKnownChiadoColibriIssue(error, request.chain.chainId)) {
      degradeReason = degradeReasonFromError(error);
      console.warn(
        `[colibri] verification mode degraded to rpc-fallback after recovery attempts` +
          ` (reason=${degradeReason ?? "unknown"}): ${errorMessage(error)}`,
      );
      mode = "rpc-fallback";
    } else {
      throw error;
    }
  }

  if (mode === "colibri") {
    try {
      const logs = await runColibriWithRecoveryRetry("proofable eth_getLogs", () =>
        colibri.rpc("eth_getLogs", [colibriFilter], ColibriMethodType.PROOFABLE),
      );
      const log = requireSingleLog(logs, ctx);
      validateLog(request, ctx, log);

      const rawTx = await runColibriWithRecoveryRetry("proofable eth_call", () =>
        colibri.rpc("eth_call", colibriEthCallParams, ColibriMethodType.PROOFABLE),
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
        tx,
      );

      return stageResult(request, ctx, { mode, degraded: false, status }, log);
    } catch (error) {
      if (shouldFallbackToRpcForKnownChiadoColibriIssue(error, request.chain.chainId)) {
        degradeReason = degradeReasonFromError(error);
        console.warn(
          `[colibri] proofable RPC degraded to rpc-fallback after recovery attempts` +
            ` (reason=${degradeReason ?? "unknown"}): ${errorMessage(error)}`,
        );
        mode = "rpc-fallback";
        // fall through to RPC fallback path below
      } else {
        throw error;
      }
    }
  }

  const log = requireSingleLog(await fetchRpcLogs(ctx), ctx);
  validateLog(request, ctx, log);

  const rawTx = await provider.send("eth_call", [
    {
      to: connector,
      data: getTxCallData,
    },
    callBlockTag,
  ]);

  const [tx] = connectorInterface.decodeFunctionResult("getTx", rawTx);
  const status = validateGetTxResult(
    request.stage,
    txId,
    expectedSrcConnector,
    expectedDstConnector,
    tx,
  );

  return stageResult(request, ctx, { mode, degraded: true, degradeReason, status }, log);
}
