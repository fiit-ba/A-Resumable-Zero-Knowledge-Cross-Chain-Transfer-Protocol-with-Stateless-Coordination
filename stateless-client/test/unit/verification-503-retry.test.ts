/**
 * Regression tests: Chiado Colibri generic 503 retry behaviour inside verifyStage().
 *
 * The Colibri backend is mocked entirely — no real network calls are made.
 * Fake timers replace sleep() calls so tests finish instantly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface, getAddress, type JsonRpcProvider } from "ethers";
import { CONNECTOR_ABI } from "../../src/contracts/abi.js";
import type { ColibriBackend, ColibriClient } from "../../src/colibri/adapter.js";
import { ColibriMethodType } from "../../src/colibri/adapter.js";
import type { ChainConfig } from "../../src/core/types.js";
import { verifyStage, type VerifyStageRequest } from "../../src/relay/verification.js";

// ---------------------------------------------------------------------------
// Module mock: replace getColibriBackend with a controllable spy while keeping
// all other adapter exports (ColibriMethodType, clearCachedBackend, …) real.
// ---------------------------------------------------------------------------
vi.mock("../../src/colibri/adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/colibri/adapter.js")>();
  return { ...actual, getColibriBackend: vi.fn() };
});

import { getColibriBackend } from "../../src/colibri/adapter.js";

// ---------------------------------------------------------------------------
// ABI helpers
// ---------------------------------------------------------------------------
const connectorInterface = new Interface(CONNECTOR_ABI);

const CONNECTOR_ADDR = getAddress("0x1111111111111111111111111111111111111111");
const SRC_CONNECTOR = getAddress("0x2222222222222222222222222222222222222222");
const DST_CONNECTOR = getAddress("0x3333333333333333333333333333333333333333");
const FROM_ADDR = getAddress("0x4444444444444444444444444444444444444444");
const ZERO_ADDR = getAddress("0x0000000000000000000000000000000000000000");
const TX_ID = "0x" + "ab".repeat(32);
const SOURCE_CHAIN_ID = 10200n;
const DESTINATION_CHAIN_ID = 31337n;

/** Encodes a minimal DepositLocked log whose fields match the given connectors. */
function makeDepositLockedLog(
  connector: string,
  txId: string,
  srcConnector: string,
  dstConnector: string,
): { address: string; topics: string[]; data: string; blockNumber: number } {
  const fragment = connectorInterface.getEvent("DepositLocked")!;
  const { data, topics } = connectorInterface.encodeEventLog(fragment, [
    txId, // indexed bytes32
    FROM_ADDR, // indexed address (from)
    FROM_ADDR, // to
    0n, // amount
    ZERO_ADDR, // currencyFrom
    ZERO_ADDR, // currencyTo
    srcConnector, // srcChainConnector
    dstConnector, // dstChainConnector
    0n, // timestamp (uint64)
    0n, // ackDeadline (uint64)
    0n, // nonce
    SOURCE_CHAIN_ID, // sourceChainId
    DESTINATION_CHAIN_ID, // destinationChainId
  ]);
  return { address: connector, topics, data, blockNumber: 12345 };
}

/** Encodes a minimal getTx ABI result with status=1 (source-deposit expected). */
function makeGetTxResult(txId: string, srcConnector: string, dstConnector: string): string {
  return connectorInterface.encodeFunctionResult("getTx", [
    [
      txId, // txId
      0n, // amount
      ZERO_ADDR, // currencyFrom
      ZERO_ADDR, // currencyTo
      FROM_ADDR, // from
      FROM_ADDR, // to
      srcConnector, // srcChainConnector
      dstConnector, // dstChainConnector
      0n, // timestamp
      0n, // finalizedAt
      0n, // mintedAt
      0n, // ackDeadline
      1, // status — expectedStatus for source-deposit
      0n, // nonce
      SOURCE_CHAIN_ID, // sourceChainId
      DESTINATION_CHAIN_ID, // destinationChainId
    ],
  ]);
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------
function makeMockColibriClient(): {
  client: ColibriClient;
  rpc: ReturnType<typeof vi.fn>;
  getMethodSupport: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn();
  const getMethodSupport = vi.fn().mockResolvedValue(ColibriMethodType.PROOFABLE);
  return { client: { rpc, getMethodSupport }, rpc, getMethodSupport };
}

function makeMockBackend(client: ColibriClient): ColibriBackend {
  return {
    createClient: vi.fn().mockReturnValue(client),
    registerStorage: vi.fn().mockResolvedValue(undefined),
  };
}

const CHIADO_CHAIN: ChainConfig = {
  side: "source",
  profileName: "chiado",
  isLocal: false,
  chainId: 10200,
  rpcUrls: ["https://rpc.chiado.example.com"],
  proverUrls: [],
  beaconUrls: [],
  checkpointzUrls: [],
};

function makeRequest(overrides: Partial<VerifyStageRequest> = {}): VerifyStageRequest {
  return {
    stage: "source-deposit",
    chain: CHIADO_CHAIN,
    connector: CONNECTOR_ADDR,
    txId: TX_ID,
    expectedSrcConnector: SRC_CONNECTOR,
    expectedDstConnector: DST_CONNECTOR,
    // Numeric blockTag resolves synchronously in resolveLogRange — no provider calls needed.
    blockTag: 12345,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "colibri-503-"));
  process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"] = tmpDir;
  // Small retry budget keeps test loops short even without fake-timer fast-forward.
  process.env["STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES"] = "3";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  delete process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"];
  delete process.env["STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES"];
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Regression 1: 503 is retried and the stage completes in colibri mode
// ---------------------------------------------------------------------------
describe("verifyStage() — Chiado 503 transport retry, eventually succeeds", () => {
  it("completes in colibri mode with degraded=false after two 503s then success", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));

    const log = makeDepositLockedLog(CONNECTOR_ADDR, TX_ID, SRC_CONNECTOR, DST_CONNECTOR);
    const rawTx = makeGetTxResult(TX_ID, SRC_CONNECTOR, DST_CONNECTOR);

    let getLogsCallCount = 0;
    rpc.mockImplementation(async (method: string) => {
      if (method === "eth_getLogs") {
        getLogsCallCount += 1;
        if (getLogsCallCount <= 2) throw new Error("HTTP error! Status: 503");
        return [log];
      }
      return rawTx; // eth_call
    });

    const resultPromise = verifyStage(makeRequest());
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
    expect(result.stage).toBe("source-deposit");
    expect(getLogsCallCount).toBe(3); // 2 failures + 1 success
  });

  it("retries on 503 with empty Details suffix and completes successfully", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));

    const log = makeDepositLockedLog(CONNECTOR_ADDR, TX_ID, SRC_CONNECTOR, DST_CONNECTOR);
    const rawTx = makeGetTxResult(TX_ID, SRC_CONNECTOR, DST_CONNECTOR);

    let getLogsCallCount = 0;
    rpc.mockImplementation(async (method: string) => {
      if (method === "eth_getLogs") {
        getLogsCallCount += 1;
        if (getLogsCallCount === 1) throw new Error("HTTP error! Status: 503, Details: ");
        return [log];
      }
      return rawTx;
    });

    const resultPromise = verifyStage(makeRequest());
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
    expect(getLogsCallCount).toBe(2); // 1 failure + 1 success
  });
});

// ---------------------------------------------------------------------------
// Regression 2: 503 retry budget exhausted — throws with operation label
// ---------------------------------------------------------------------------
describe("verifyStage() — Chiado 503 transport retry, budget exhausted", () => {
  it("throws after exhausting retries with operation label and retry context in error message", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));

    rpc.mockRejectedValue(new Error("HTTP error! Status: 503"));

    // Attach rejection handler immediately to avoid unhandled-rejection noise.
    const pendingResult = verifyStage(makeRequest()).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const caught = await pendingResult;

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/proofable eth_getLogs/);
    expect((caught as Error).message).toMatch(/503/);
    expect((caught as Error).message).toMatch(/3 retries/);
  });

  it("exhausted-retries count matches configured STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));

    let callCount = 0;
    rpc.mockImplementation(async () => {
      callCount += 1;
      throw new Error("HTTP error! Status: 503");
    });

    const pendingResult = verifyStage(makeRequest()).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    await pendingResult;

    // With RETRIES=3: 1 initial attempt + 3 retries = 4 total rpc("eth_getLogs") calls.
    expect(callCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Regression 3: generic 503 does NOT degrade to rpc-fallback
// ---------------------------------------------------------------------------
describe("verifyStage() — Chiado 503 does not enter rpc-fallback", () => {
  it("throws rather than silently degrading to rpc-fallback when 503 budget is exhausted", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));

    rpc.mockRejectedValue(new Error("HTTP error! Status: 503"));

    const pendingResult = verifyStage(makeRequest()).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const caught = await pendingResult;

    // Must be a thrown Error, not a resolved result with degraded=true.
    expect(caught).toBeInstanceOf(Error);
  });

  it("existing fallback-only Chiado cases (sync-backwards) still degrade to rpc-fallback — guard", async () => {
    const { client, getMethodSupport } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));

    // Method-support probe throws sync-backwards — should degrade to rpc-fallback.
    getMethodSupport.mockRejectedValue(
      new Error("last sync state is higher than the required period, but we cannot sync backwards"),
    );

    const log = makeDepositLockedLog(CONNECTOR_ADDR, TX_ID, SRC_CONNECTOR, DST_CONNECTOR);
    const rawTx = makeGetTxResult(TX_ID, SRC_CONNECTOR, DST_CONNECTOR);

    const mockProvider = {
      getBlockNumber: vi.fn().mockResolvedValue(100_000),
      getLogs: vi.fn().mockResolvedValue([log]),
      send: vi.fn().mockImplementation(async (method: string) => {
        if (method === "eth_call") return rawTx;
        return null;
      }),
    };

    const resultPromise = verifyStage(
      makeRequest({ provider: mockProvider as unknown as JsonRpcProvider }),
    );
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("rpc-fallback");
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe("chiado_sync_backwards");
  });
});
