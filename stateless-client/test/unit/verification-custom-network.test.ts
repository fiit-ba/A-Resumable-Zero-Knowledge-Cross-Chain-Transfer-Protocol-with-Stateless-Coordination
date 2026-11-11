/**
 * A custom public network with --allow-rpc-fallback: Colibri does not support it, so each
 * stage is verified through plain RPC and marked degraded with the reason "unsupported_network".
 * Without the flag the same network stops with Colibri's error.
 *
 * The Colibri backend is mocked so that any use of it shows up; the RPC provider is a fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface, getAddress, type JsonRpcProvider } from "ethers";
import { CONNECTOR_ABI } from "../../src/contracts/abi.js";
import type { ColibriBackend } from "../../src/colibri/adapter.js";
import type { ChainConfig, Stage } from "../../src/core/types.js";
import { verifyStage, type VerifyStageRequest } from "../../src/relay/verification.js";

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
const FOREIGN_CONNECTOR = getAddress("0x5555555555555555555555555555555555555555");
const ZERO_ADDR = getAddress("0x0000000000000000000000000000000000000000");
const ZERO_HASH = "0x" + "00".repeat(32);
const TX_ID = "0x" + "ab".repeat(32);
const SOURCE_CHAIN_ID = 167013n;
const DESTINATION_CHAIN_ID = 59141n;

const TAIKO_HOODI: ChainConfig = {
  side: "source",
  profileName: "custom",
  isLocal: false,
  chainId: 167013,
  rpcUrls: ["https://rpc.hoodi.taiko.xyz"],
  proverUrls: [],
  beaconUrls: [],
  checkpointzUrls: [],
  rpcFallback: true,
};

function makeDepositLockedLog(srcChainConnector: string = SRC_CONNECTOR): {
  address: string;
  topics: string[];
  data: string;
} {
  const fragment = connectorInterface.getEvent("DepositLocked")!;
  const { data, topics } = connectorInterface.encodeEventLog(fragment, [
    TX_ID, // indexed txId
    FROM_ADDR, // indexed from
    FROM_ADDR, // to
    0n, // amount
    ZERO_ADDR, // currencyFrom
    ZERO_ADDR, // currencyTo
    srcChainConnector, // srcChainConnector
    DST_CONNECTOR, // dstChainConnector
    0n, // timestamp
    0n, // ackDeadline
    0n, // nonce
    SOURCE_CHAIN_ID, // sourceChainId
    DESTINATION_CHAIN_ID, // destinationChainId
  ]);
  return { address: CONNECTOR_ADDR, topics, data };
}

function makeAckReadyLog(): { address: string; topics: string[]; data: string } {
  const fragment = connectorInterface.getEvent("AckReady")!;
  const { data, topics } = connectorInterface.encodeEventLog(fragment, [
    TX_ID, // indexed txId
    0n, // amount
    ZERO_ADDR, // currencyFrom
    ZERO_ADDR, // currencyTo
    FROM_ADDR, // indexed from
    FROM_ADDR, // to
    SRC_CONNECTOR, // srcChainConnector
    DST_CONNECTOR, // dstChainConnector
    0n, // timestamp
    0, // proofType
    ZERO_HASH, // proofHash
    ZERO_HASH, // commitment
  ]);
  return { address: CONNECTOR_ADDR, topics, data };
}

/** A getTx result; status 1 is the status the source-deposit stage expects. */
function makeGetTxResult(status: number = 1): string {
  return connectorInterface.encodeFunctionResult("getTx", [
    [
      TX_ID, // txId
      0n, // amount
      ZERO_ADDR, // currencyFrom
      ZERO_ADDR, // currencyTo
      FROM_ADDR, // from
      FROM_ADDR, // to
      SRC_CONNECTOR, // srcChainConnector
      DST_CONNECTOR, // dstChainConnector
      0n, // timestamp
      0n, // finalizedAt
      0n, // mintedAt
      0n, // ackDeadline
      status, // status
      0n, // nonce
      SOURCE_CHAIN_ID, // sourceChainId
      DESTINATION_CHAIN_ID, // destinationChainId
    ],
  ]);
}

function makeProvider(
  log: { address: string; topics: string[]; data: string },
  getTxStatus: number = 1,
) {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(100_000),
    getLogs: vi.fn().mockResolvedValue([{ ...log, blockNumber: 12345 }]),
    send: vi.fn().mockImplementation(async (method: string) => {
      if (method === "eth_call") return makeGetTxResult(getTxStatus);
      return null;
    }),
  };
}

function makeRequest(
  stage: Stage,
  provider: ReturnType<typeof makeProvider>,
  chain: ChainConfig = TAIKO_HOODI,
): VerifyStageRequest {
  return {
    stage,
    chain,
    connector: CONNECTOR_ADDR,
    txId: TX_ID,
    expectedSrcConnector: SRC_CONNECTOR,
    expectedDstConnector: DST_CONNECTOR,
    // A numeric block tag resolves without provider calls.
    blockTag: 12345,
    provider: provider as unknown as JsonRpcProvider,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "colibri-custom-network-"));
  process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"] = tmpDir;
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"];
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("verifyStage() on a custom network with the RPC fallback", () => {
  it("verifies a getTx stage through RPC without touching Colibri", async () => {
    const provider = makeProvider(makeDepositLockedLog());

    const result = await verifyStage(makeRequest("source-deposit", provider));

    expect(result.mode).toBe("rpc-fallback");
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe("unsupported_network");
    expect(result.status).toBe(1);
    expect(provider.send).toHaveBeenCalledWith("eth_call", expect.any(Array));
    expect(getColibriBackend).not.toHaveBeenCalled();
  });

  it("verifies an event-only stage through RPC without touching Colibri", async () => {
    const provider = makeProvider(makeAckReadyLog());

    const result = await verifyStage(makeRequest("source-ack-ready", provider));

    expect(result.mode).toBe("rpc-fallback");
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe("unsupported_network");
    expect(provider.send).not.toHaveBeenCalled();
    expect(getColibriBackend).not.toHaveBeenCalled();
  });

  it("reads the log and getTx at the same block", async () => {
    const provider = makeProvider(makeDepositLockedLog());

    await verifyStage(makeRequest("source-deposit", provider));

    // 12345 = 0x3039
    expect(provider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ address: CONNECTOR_ADDR, fromBlock: "0x3039", toBlock: "0x3039" }),
    );
    expect(provider.send).toHaveBeenCalledWith("eth_call", [
      { to: CONNECTOR_ADDR, data: connectorInterface.encodeFunctionData("getTx", [TX_ID]) },
      "0x3039",
    ]);
  });

  it("still refuses a getTx status the stage does not expect", async () => {
    const provider = makeProvider(makeDepositLockedLog(), 2);

    await expect(verifyStage(makeRequest("source-deposit", provider))).rejects.toThrow(
      /getTx\.status mismatch for stage source-deposit: expected 1, got 2/,
    );
  });

  it("still refuses an event that names a foreign connector", async () => {
    const provider = makeProvider(makeDepositLockedLog(FOREIGN_CONNECTOR));

    await expect(verifyStage(makeRequest("source-deposit", provider))).rejects.toThrow(
      /DepositLocked\.srcChainConnector mismatch/,
    );
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("still refuses a log emitted by another contract", async () => {
    const log = { ...makeDepositLockedLog(), address: FOREIGN_CONNECTOR };
    const provider = makeProvider(log);

    await expect(verifyStage(makeRequest("source-deposit", provider))).rejects.toThrow(
      /log\.address mismatch/,
    );
  });
});

describe("verifyStage() on a custom network without the RPC fallback", () => {
  it("stops with Colibri's error and reads nothing through RPC", async () => {
    const colibriError = new Error("chain 167013 is not supported");
    const backend: ColibriBackend = {
      createClient: vi.fn().mockReturnValue({
        rpc: vi.fn(),
        getMethodSupport: vi.fn().mockRejectedValue(colibriError),
      }),
      registerStorage: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getColibriBackend).mockResolvedValue(backend);
    const provider = makeProvider(makeDepositLockedLog());
    const chain: ChainConfig = { ...TAIKO_HOODI, rpcFallback: false };

    await expect(verifyStage(makeRequest("source-deposit", provider, chain))).rejects.toThrow(
      colibriError,
    );
    expect(provider.getLogs).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });
});
