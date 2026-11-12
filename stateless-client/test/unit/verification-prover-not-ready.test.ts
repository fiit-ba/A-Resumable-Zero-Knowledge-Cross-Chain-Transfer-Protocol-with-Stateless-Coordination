/**
 * Regression tests: a block that is only a slot or two old cannot be proven yet.
 *
 * Colibri 3.0.3 reports this on Sepolia with one of three texts (a 405, a bare 503 or a
 * missing debug_getRawBlock); the same request passes about one slot later, so the
 * stage must wait and try again instead of failing or reading plain RPC.
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
import {
  isProverNotReadyError,
  verifyStage,
  type VerifyStageRequest,
} from "../../src/relay/verification.js";

vi.mock("../../src/colibri/adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/colibri/adapter.js")>();
  return { ...actual, getColibriBackend: vi.fn() };
});

import { getColibriBackend } from "../../src/colibri/adapter.js";

const connectorInterface = new Interface(CONNECTOR_ABI);

const CONNECTOR_ADDR = getAddress("0x1111111111111111111111111111111111111111");
const SRC_CONNECTOR = getAddress("0x2222222222222222222222222222222222222222");
const DST_CONNECTOR = getAddress("0x3333333333333333333333333333333333333333");
const FROM_ADDR = getAddress("0x4444444444444444444444444444444444444444");
const ZERO_ADDR = getAddress("0x0000000000000000000000000000000000000000");
const TX_ID = "0x" + "ab".repeat(32);
const SOURCE_CHAIN_ID = 11155111n;
const DESTINATION_CHAIN_ID = 31337n;

// The three texts seen on Sepolia for a block the prover could not prove yet.
const ERROR_405 = 'HTTP error! Status: 405, Details: {"error":"Method not allowed"}';
const ERROR_503 = "HTTP error! Status: 503, Details: ";
const ERROR_RAW_BLOCK =
  'Error when calling eth-rpc for debug_getRawBlock (params: ["0xb8c6d8"]) :' +
  " the method debug_getRawBlock does not exist/is not available";

function makeDepositLockedLog(): {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
} {
  const fragment = connectorInterface.getEvent("DepositLocked")!;
  const { data, topics } = connectorInterface.encodeEventLog(fragment, [
    TX_ID,
    FROM_ADDR,
    FROM_ADDR,
    0n,
    ZERO_ADDR,
    ZERO_ADDR,
    SRC_CONNECTOR,
    DST_CONNECTOR,
    0n,
    0n,
    0n,
    SOURCE_CHAIN_ID,
    DESTINATION_CHAIN_ID,
  ]);
  return { address: CONNECTOR_ADDR, topics, data, blockNumber: 12345 };
}

function makeAckReadyLog(): {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
} {
  const fragment = connectorInterface.getEvent("AckReady")!;
  const { data, topics } = connectorInterface.encodeEventLog(fragment, [
    TX_ID,
    1000n,
    ZERO_ADDR,
    ZERO_ADDR,
    FROM_ADDR,
    FROM_ADDR,
    SRC_CONNECTOR,
    DST_CONNECTOR,
    10,
    0,
    "0x" + "aa".repeat(32),
    "0x" + "bb".repeat(32),
  ]);
  return { address: CONNECTOR_ADDR, topics, data, blockNumber: 12345 };
}

/** Encodes a getTx result with status=1, the status the source-deposit stage expects. */
function makeGetTxResult(): string {
  return connectorInterface.encodeFunctionResult("getTx", [
    [
      TX_ID,
      0n,
      ZERO_ADDR,
      ZERO_ADDR,
      FROM_ADDR,
      FROM_ADDR,
      SRC_CONNECTOR,
      DST_CONNECTOR,
      0n,
      0n,
      0n,
      0n,
      1,
      0n,
      SOURCE_CHAIN_ID,
      DESTINATION_CHAIN_ID,
    ],
  ]);
}

function makeMockColibriClient(): { client: ColibriClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn();
  const getMethodSupport = vi.fn().mockResolvedValue(ColibriMethodType.PROOFABLE);
  return { client: { rpc, getMethodSupport }, rpc };
}

function makeMockBackend(client: ColibriClient): ColibriBackend {
  return {
    createClient: vi.fn().mockReturnValue(client),
    registerStorage: vi.fn().mockResolvedValue(undefined),
  };
}

const SEPOLIA_CHAIN: ChainConfig = {
  side: "source",
  profileName: "sepolia",
  isLocal: false,
  chainId: 11155111,
  rpcUrls: ["https://rpc.sepolia.example.com"],
  proverUrls: [],
  beaconUrls: [],
  checkpointzUrls: [],
};

function makeRequest(overrides: Partial<VerifyStageRequest> = {}): VerifyStageRequest {
  return {
    stage: "source-deposit",
    chain: SEPOLIA_CHAIN,
    connector: CONNECTOR_ADDR,
    txId: TX_ID,
    expectedSrcConnector: SRC_CONNECTOR,
    expectedDstConnector: DST_CONNECTOR,
    // Numeric blockTag resolves synchronously in resolveLogRange — no provider calls needed.
    blockTag: 12345,
    ...overrides,
  };
}

/** Makes eth_getLogs fail with the given errors in turn, then answer with the log. */
function failGetLogsWith(
  rpc: ReturnType<typeof vi.fn>,
  errors: string[],
  log: object,
): { calls: () => number } {
  let getLogsCalls = 0;
  rpc.mockImplementation(async (method: string) => {
    if (method === "eth_getLogs") {
      getLogsCalls += 1;
      if (getLogsCalls <= errors.length) throw new Error(errors[getLogsCalls - 1]);
      return [log];
    }
    return makeGetTxResult(); // eth_call
  });
  return { calls: () => getLogsCalls };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "colibri-not-ready-"));
  process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"] = tmpDir;
  process.env["STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES"] = "3";
  process.env["STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC"] = "12";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  delete process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"];
  delete process.env["STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES"];
  delete process.env["STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC"];
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("isProverNotReadyError", () => {
  it("matches the three texts seen for a block that is too fresh", () => {
    expect(isProverNotReadyError(new Error(ERROR_405))).toBe(true);
    expect(isProverNotReadyError(new Error(ERROR_503))).toBe(true);
    expect(isProverNotReadyError(new Error(ERROR_RAW_BLOCK))).toBe(true);
  });

  it("matches any 5xx of the HTTP layer, with or without details", () => {
    expect(isProverNotReadyError(new Error("HTTP error! Status: 500, Details: boom"))).toBe(true);
    expect(isProverNotReadyError(new Error("HTTP error! Status: 502"))).toBe(true);
    expect(isProverNotReadyError(new Error("HTTP error! Status: 503, Details: overloaded"))).toBe(
      true,
    );
  });

  it("matches when the library puts its own words in front of the HTTP error", () => {
    expect(
      isProverNotReadyError(new Error(`Proof-creating for eth_getLogs failed: ${ERROR_405}`)),
    ).toBe(true);
  });

  it("does not match other errors", () => {
    expect(isProverNotReadyError(new Error("HTTP error! Status: 404, Details: not found"))).toBe(
      false,
    );
    expect(isProverNotReadyError(new Error("HTTP error! Status: 429, Details: slow down"))).toBe(
      false,
    );
    expect(isProverNotReadyError(new Error("execution reverted"))).toBe(false);
    expect(isProverNotReadyError("HTTP error! Status: 405")).toBe(false);
  });
});

describe("verifyStage() — the prover cannot prove a fresh block yet, then can", () => {
  it("completes in colibri mode after two 405s", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));
    const getLogs = failGetLogsWith(rpc, [ERROR_405, ERROR_405], makeDepositLockedLog());

    const resultPromise = verifyStage(makeRequest());
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
    expect(getLogs.calls()).toBe(3); // 2 failures + 1 success
  });

  it("completes in colibri mode after a 405, a 503 and a missing debug_getRawBlock", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));
    const getLogs = failGetLogsWith(
      rpc,
      [ERROR_405, ERROR_503, ERROR_RAW_BLOCK],
      makeDepositLockedLog(),
    );

    const resultPromise = verifyStage(makeRequest());
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
    expect(getLogs.calls()).toBe(4); // 3 failures + 1 success
  });

  it("completes in colibri mode after a 500 that carries details", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));
    const getLogs = failGetLogsWith(
      rpc,
      ["HTTP error! Status: 500, Details: boom"],
      makeDepositLockedLog(),
    );

    const resultPromise = verifyStage(makeRequest());
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
    expect(getLogs.calls()).toBe(2); // 1 failure + 1 success
  });

  it("waits between the tries", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));
    const getLogs = failGetLogsWith(rpc, [ERROR_405], makeDepositLockedLog());

    const resultPromise = verifyStage(makeRequest());
    // Without advancing the clock the second try must not have happened.
    await vi.advanceTimersByTimeAsync(1000);
    expect(getLogs.calls()).toBe(1);

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("colibri");
    expect(getLogs.calls()).toBe(2);
  });
});

describe("verifyStage() — the prover never becomes ready", () => {
  it("throws the last error after the configured number of retries", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));

    let calls = 0;
    rpc.mockImplementation(async () => {
      calls += 1;
      throw new Error(ERROR_405);
    });
    const mockProvider = { getLogs: vi.fn(), send: vi.fn() };

    // Attach rejection handler immediately to avoid unhandled-rejection noise.
    const pendingResult = verifyStage(
      makeRequest({ provider: mockProvider as unknown as JsonRpcProvider }),
    ).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const caught = await pendingResult;

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(ERROR_405);
    // With RETRIES=3: 1 initial attempt + 3 retries.
    expect(calls).toBe(4);
    // Must not read plain RPC instead of the proof.
    expect(mockProvider.getLogs).not.toHaveBeenCalled();
    expect(mockProvider.send).not.toHaveBeenCalled();
  });
});

describe("verifyStage() — event-only stage and a block that is too fresh", () => {
  it("waits, tries again and completes in colibri mode instead of reading plain RPC", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeMockBackend(client));
    const getLogs = failGetLogsWith(rpc, [ERROR_405, ERROR_RAW_BLOCK], makeAckReadyLog());
    const mockProvider = { getLogs: vi.fn() };

    const resultPromise = verifyStage(
      makeRequest({
        stage: "source-ack-ready",
        provider: mockProvider as unknown as JsonRpcProvider,
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(getLogs.calls()).toBe(1);

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
    expect(getLogs.calls()).toBe(3); // 2 failures + 1 success
    expect(mockProvider.getLogs).not.toHaveBeenCalled();
  });
});
