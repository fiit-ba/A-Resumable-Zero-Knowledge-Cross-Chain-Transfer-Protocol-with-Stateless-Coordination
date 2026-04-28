/**
 * txId-only chain discovery.
 *
 * Scans the set of supported network profiles for logs indexed by a given
 * txId without requiring connector addresses up front.  The result contains
 * all source/destination profile pairs that can be reconstructed from on-chain
 * evidence, plus extracted execution block numbers and transfer metadata.
 *
 * Uses chunked reverse-range scanning so recovery works even when the event
 * is older than the standard 50 000-block lookback window used by the planner.
 */

import { Contract, JsonRpcProvider } from "ethers";
import { CONNECTOR_ABI, connectorInterface } from "../contracts/abi.js";
import { NETWORK_PROFILES } from "../config/profiles.js";
import type { NetworkProfileName, StageExecutionBlocks } from "../core/types.js";
import { normalizeAddress, normalizeBytes32 } from "../core/utils.js";

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

const SOURCE_EVENT_NAMES = [
  "DepositLocked",
  "AckReady",
  "RefundClaimed",
  "RefundExecuted",
] as const;
const DEST_EVENT_NAMES = ["FundsReleased", "DestTxClosed"] as const;
const ALL_EVENT_NAMES = [...SOURCE_EVENT_NAMES, ...DEST_EVENT_NAMES] as const;

export type DiscoveryEventName = (typeof ALL_EVENT_NAMES)[number];

const SOURCE_EVENT_SET = new Set<string>(SOURCE_EVENT_NAMES);
const DEST_EVENT_SET = new Set<string>(DEST_EVENT_NAMES);

// ---------------------------------------------------------------------------
// Profiles scanned during recovery
// ---------------------------------------------------------------------------

/** Ordered list of profiles attempted during txId discovery. */
export const DISCOVERY_SCAN_PROFILES: NetworkProfileName[] = [
  "local-anvil",
  "local-hardhat",
  "sepolia",
  "holesky",
  "hoodi",
  "gnosis",
  "chiado",
];

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_SIZE = 50_000;
const DEFAULT_MAX_LOOKBACK = 500_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoveredEvent {
  eventName: DiscoveryEventName;
  blockNumber: number;
  connectorAddress: string;
  /** Decoded from DepositLocked — available when the event data is decodable. */
  srcChainConnector?: string;
  dstChainConnector?: string;
  amount?: bigint;
  tokenFrom?: string;
  tokenTo?: string;
  receiver?: string;
}

export interface ChainScanResult {
  profileName: NetworkProfileName;
  chainId: number;
  events: DiscoveredEvent[];
}

export interface TransferDiscoveryMatch {
  sourceProfile: NetworkProfileName;
  sourceConnector: string;
  destinationProfile: NetworkProfileName;
  destinationConnector: string;
  /** Exact blocks where each stage event was observed; feeds executionBlocks on the job. */
  executionBlocks: StageExecutionBlocks;
  /** On-chain status read from each connector at discovery time. */
  sourceStatus: number;
  destinationStatus: number;
  /** Transfer metadata decoded from DepositLocked (available when event data present). */
  transferData?: {
    amount?: bigint;
    tokenFrom?: string;
    tokenTo?: string;
    receiver?: string;
  };
  historyHints: {
    depositLocked: boolean;
    fundsReleased: boolean;
    ackReady: boolean;
    refundInitiated: boolean;
    burnExecuted: boolean;
  };
}

export interface DiscoveryOptions {
  /** Limit the scan to a subset of profiles, or provide hint order for faster recovery. */
  profileHints?: NetworkProfileName[];
  /** Block range per scan chunk (default: 50 000). */
  chunkSize?: number;
  /** Maximum blocks to scan backwards from latest (default: 500 000). */
  maxLookback?: number;
  /** Override provider constructor (used in tests). */
  createProvider?: (rpcUrl: string, chainId: number) => JsonRpcProvider;
}

export interface DiscoveryResult {
  matches: TransferDiscoveryMatch[];
  /** All profiles that were attempted during this scan. */
  scannedProfiles: NetworkProfileName[];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function lazyTopics(): Record<DiscoveryEventName, string> {
  const out: Partial<Record<DiscoveryEventName, string>> = {};
  for (const name of ALL_EVENT_NAMES) {
    const fragment = connectorInterface.getEvent(name);
    if (!fragment) throw new Error(`Missing ABI event fragment: ${name}`);
    out[name] = fragment.topicHash;
  }
  return out as Record<DiscoveryEventName, string>;
}

let _topicCache: Record<DiscoveryEventName, string> | undefined;
function getEventTopics(): Record<DiscoveryEventName, string> {
  if (!_topicCache) _topicCache = lazyTopics();
  return _topicCache;
}

/**
 * Scans a single chain backwards in chunks, stopping once any event matching
 * the given txId is found.  Returns all matching events (there may be several
 * if both source- and destination-side events happened on the same chain).
 */
async function scanChainForTxId(
  profileName: NetworkProfileName,
  txId: string,
  chunkSize: number,
  maxLookback: number,
  createProvider: (rpcUrl: string, chainId: number) => JsonRpcProvider,
): Promise<ChainScanResult> {
  const profile = NETWORK_PROFILES[profileName];
  const provider = createProvider(profile.rpcUrls[0], profile.chainId);
  const events: DiscoveredEvent[] = [];
  const topics = getEventTopics();

  let latestBlock: number;
  try {
    latestBlock = await provider.getBlockNumber();
  } catch {
    return { profileName, chainId: profile.chainId, events: [] };
  }

  const stopBlock = Math.max(0, latestBlock - maxLookback);
  let toBlock = latestBlock;

  while (toBlock >= stopBlock) {
    const fromBlock = Math.max(stopBlock, toBlock - chunkSize + 1);

    // Query all event types in parallel for this chunk.
    const chunkResults = await Promise.allSettled(
      ALL_EVENT_NAMES.map(async (eventName) => {
        const logs = await provider.getLogs({
          topics: [topics[eventName], txId],
          fromBlock,
          toBlock,
        });
        return { eventName, logs };
      }),
    );

    for (const result of chunkResults) {
      if (result.status !== "fulfilled") continue;
      const { eventName, logs } = result.value;

      for (const log of logs) {
        let connectorAddress: string;
        try {
          connectorAddress = normalizeAddress(log.address, "log.address");
        } catch {
          continue;
        }

        const entry: DiscoveredEvent = {
          eventName,
          blockNumber: log.blockNumber,
          connectorAddress,
        };

        if (eventName === "DepositLocked") {
          try {
            const decoded = connectorInterface.decodeEventLog(
              "DepositLocked",
              log.data,
              log.topics,
            );
            entry.srcChainConnector = normalizeAddress(
              String(decoded.srcChainConnector),
              "srcChainConnector",
            );
            entry.dstChainConnector = normalizeAddress(
              String(decoded.dstChainConnector),
              "dstChainConnector",
            );
            entry.amount = BigInt(String(decoded.amount));
            entry.tokenFrom = normalizeAddress(String(decoded.currencyFrom), "currencyFrom");
            entry.tokenTo = normalizeAddress(String(decoded.currencyTo), "currencyTo");
            entry.receiver = normalizeAddress(String(decoded.to), "receiver");
          } catch {
            // Decode failure is non-critical; continue with partial entry.
          }
        }

        events.push(entry);
      }
    }

    if (events.length > 0) break; // Found events; no need to scan further back.
    toBlock = fromBlock - 1;
  }

  return { profileName, chainId: profile.chainId, events };
}

/** Returns the on-chain status for a given connector+txId, or 0 on failure. */
async function probeConnectorStatus(
  profileName: NetworkProfileName,
  connectorAddress: string,
  txId: string,
  createProvider: (rpcUrl: string, chainId: number) => JsonRpcProvider,
): Promise<number> {
  try {
    const profile = NETWORK_PROFILES[profileName];
    const provider = createProvider(profile.rpcUrls[0], profile.chainId);
    const contract = new Contract(connectorAddress, CONNECTOR_ABI, provider);
    return Number(await contract.txStatus(txId));
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discovers cross-chain transfer evidence for a given txId by scanning all
 * supported profiles without requiring connector addresses.
 *
 * Returns:
 * - `matches.length === 0` when the txId is not found on any chain.
 * - `matches.length === 1` when exactly one source/destination pair is
 *   unambiguously identified.
 * - `matches.length > 1` when multiple source candidates are found (callers
 *   should present candidates to the user for manual selection).
 */
export async function discoverTransferByTxId(
  txId: string,
  opts?: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const normalizedTxId = normalizeBytes32(txId, "txId");
  const profilesToScan = opts?.profileHints ?? DISCOVERY_SCAN_PROFILES;
  const chunkSize = opts?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxLookback = opts?.maxLookback ?? DEFAULT_MAX_LOOKBACK;
  const createProvider =
    opts?.createProvider ?? ((url, chainId) => new JsonRpcProvider(url, chainId));

  // Phase 1 — scan all profiles in parallel.
  const scanSettled = await Promise.allSettled(
    profilesToScan.map((p) =>
      scanChainForTxId(p, normalizedTxId, chunkSize, maxLookback, createProvider),
    ),
  );

  const chainResults: ChainScanResult[] = [];
  for (const r of scanSettled) {
    if (r.status === "fulfilled") chainResults.push(r.value);
  }

  const scannedProfiles = chainResults.map((r) => r.profileName);

  // Phase 2 — classify into source and destination chains.
  const sourceChains = chainResults.filter((r) =>
    r.events.some((e) => SOURCE_EVENT_SET.has(e.eventName)),
  );
  const destChains = chainResults.filter((r) =>
    r.events.some((e) => DEST_EVENT_SET.has(e.eventName)),
  );

  // Phase 3 — build one TransferDiscoveryMatch per source chain.
  const matches: TransferDiscoveryMatch[] = [];

  for (const srcChain of sourceChains) {
    const depositEvent = srcChain.events.find((e) => e.eventName === "DepositLocked");
    if (!depositEvent) continue; // No deposit event → cannot reconstruct intent.

    const sourceConnector = depositEvent.connectorAddress;
    const dstChainConnectorAddr = depositEvent.dstChainConnector;

    // Find the destination chain by matching the connector address from the event.
    const destChain = destChains.find((d) =>
      d.events.some(
        (e) =>
          DEST_EVENT_SET.has(e.eventName) &&
          (!dstChainConnectorAddr ||
            e.connectorAddress.toLowerCase() === dstChainConnectorAddr.toLowerCase()),
      ),
    );

    let destinationProfile: NetworkProfileName | undefined;
    let destinationConnector: string | undefined;

    if (destChain) {
      const destEvent = destChain.events.find((e) => DEST_EVENT_SET.has(e.eventName));
      destinationProfile = destChain.profileName;
      destinationConnector = destEvent?.connectorAddress ?? dstChainConnectorAddr;
    } else if (dstChainConnectorAddr) {
      // Phase 3b — no destination events yet; probe the dstChainConnector address
      // across all profiles that weren't identified as a source chain.
      const unseenProfiles = profilesToScan.filter(
        (p) => !sourceChains.some((s) => s.profileName === p),
      );
      for (const profileName of unseenProfiles) {
        const status = await probeConnectorStatus(
          profileName,
          dstChainConnectorAddr,
          normalizedTxId,
          createProvider,
        );
        if (status > 0) {
          destinationProfile = profileName;
          destinationConnector = dstChainConnectorAddr;
          break;
        }
      }
    }

    if (!destinationProfile || !destinationConnector) {
      // Cannot determine destination without a profile hint; skip.
      continue;
    }

    // Phase 3c — build execution blocks from discovered event block numbers.
    const executionBlocks: StageExecutionBlocks = {};
    for (const evt of srcChain.events) {
      if (evt.eventName === "DepositLocked") executionBlocks.sourceDeposit = evt.blockNumber;
      if (evt.eventName === "AckReady") executionBlocks.sourceAckReady = evt.blockNumber;
      if (evt.eventName === "RefundClaimed")
        executionBlocks.sourceRefundInitiated = evt.blockNumber;
    }
    if (destChain) {
      for (const evt of destChain.events) {
        if (evt.eventName === "FundsReleased")
          executionBlocks.destinationFundsReleased = evt.blockNumber;
        if (evt.eventName === "DestTxClosed")
          executionBlocks.destinationBurnExecuted = evt.blockNumber;
      }
    }

    // Phase 3d — probe on-chain statuses.
    const [sourceStatus, destinationStatus] = await Promise.all([
      probeConnectorStatus(srcChain.profileName, sourceConnector, normalizedTxId, createProvider),
      probeConnectorStatus(
        destinationProfile,
        destinationConnector,
        normalizedTxId,
        createProvider,
      ),
    ]);

    const historyHints = {
      depositLocked: srcChain.events.some((e) => e.eventName === "DepositLocked"),
      fundsReleased: (destChain?.events ?? []).some((e) => e.eventName === "FundsReleased"),
      ackReady: srcChain.events.some((e) => e.eventName === "AckReady"),
      refundInitiated: srcChain.events.some((e) => e.eventName === "RefundClaimed"),
      burnExecuted: (destChain?.events ?? []).some((e) => e.eventName === "DestTxClosed"),
    };

    matches.push({
      sourceProfile: srcChain.profileName,
      sourceConnector,
      destinationProfile,
      destinationConnector,
      executionBlocks,
      sourceStatus,
      destinationStatus,
      transferData:
        depositEvent.amount !== undefined
          ? {
              amount: depositEvent.amount,
              tokenFrom: depositEvent.tokenFrom,
              tokenTo: depositEvent.tokenTo,
              receiver: depositEvent.receiver,
            }
          : undefined,
      historyHints,
    });
  }

  return { matches, scannedProfiles };
}
