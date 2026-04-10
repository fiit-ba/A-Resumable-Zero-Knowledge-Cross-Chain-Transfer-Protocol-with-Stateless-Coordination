import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface, getAddress, type JsonRpcProvider } from "ethers";
import { CONNECTOR_ABI } from "../../src/contracts/abi.js";
import type { ColibriBackend, ColibriClient } from "../../src/colibri/adapter.js";
import { ColibriMethodType } from "../../src/colibri/adapter.js";
import type { ChainConfig, StageSubmissionConfig } from "../../src/core/types.js";
import { deriveVerificationPolicyForStage, shouldUsePrunedAckVerification } from "../../src/relay/relay.js";
import { verifyAckEventOnly, verifyStage } from "../../src/relay/verification.js";

vi.mock("../../src/colibri/adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/colibri/adapter.js")>();
  return { ...actual, getColibriBackend: vi.fn() };
});

import { getColibriBackend } from "../../src/colibri/adapter.js";

const abi = new Interface(CONNECTOR_ABI);
const TX_ID = "0x" + "ab".repeat(32);
const SRC_CONNECTOR = getAddress("0x1111111111111111111111111111111111111111");
const DST_CONNECTOR = getAddress("0x2222222222222222222222222222222222222222");
const SOURCE_USER = getAddress("0x3333333333333333333333333333333333333333");
const RECEIVER = getAddress("0x4444444444444444444444444444444444444444");
const ZERO_ADDR = getAddress("0x0000000000000000000000000000000000000000");
const SOURCE_CHAIN_ID = 11155111n;
const DESTINATION_CHAIN_ID = 10200n;

const SOURCE_NON_LOCAL: ChainConfig = {
  side: "source",
  profileName: "sepolia",
  isLocal: false,
  chainId: 11155111,
  rpcUrls: ["https://source.example"],
  proverUrls: [],
  beaconUrls: [],
  checkpointzUrls: [],
};

const DEST_NON_LOCAL: ChainConfig = {
  side: "destination",
  profileName: "chiado",
  isLocal: false,
  chainId: 10200,
  rpcUrls: ["https://destination.example"],
  proverUrls: [],
  beaconUrls: [],
  checkpointzUrls: [],
};

const DEST_LOCAL: ChainConfig = {
  ...DEST_NON_LOCAL,
  profileName: "local-hardhat",
  isLocal: true,
  chainId: 31337,
};

function makeAckReadyLog(): { address: string; topics: string[]; data: string; blockNumber: number } {
  const event = abi.getEvent("AckReady")!;
  const { topics, data } = abi.encodeEventLog(event, [
    TX_ID,
    1000n,
    ZERO_ADDR,
    ZERO_ADDR,
    SOURCE_USER,
    RECEIVER,
    SRC_CONNECTOR,
    DST_CONNECTOR,
    10,
    0,
    "0x" + "aa".repeat(32),
    "0x" + "bb".repeat(32),
    "0x1234",
  ]);

  return { address: SRC_CONNECTOR, topics, data, blockNumber: 101 };
}

function makeFundsReleasedLog(): { address: string; topics: string[]; data: string; blockNumber: number } {
  const event = abi.getEvent("FundsReleased")!;
  const { topics, data } = abi.encodeEventLog(event, [
    TX_ID,
    1000n,
    ZERO_ADDR,
    ZERO_ADDR,
    SOURCE_USER,
    RECEIVER,
    SRC_CONNECTOR,
    DST_CONNECTOR,
    10,
    0,
    "0x" + "aa".repeat(32),
    "0x" + "bb".repeat(32),
    "0x1234",
  ]);

  return { address: DST_CONNECTOR, topics, data, blockNumber: 88 };
}

function makeGetTxResult(status: number): string {
  return abi.encodeFunctionResult("getTx", [
    [
      TX_ID,
      0n,
      ZERO_ADDR,
      ZERO_ADDR,
      SOURCE_USER,
      RECEIVER,
      SRC_CONNECTOR,
      DST_CONNECTOR,
      0n,
      0n,
      0n,
      0n,
      status,
      0n,
      SOURCE_CHAIN_ID,
      DESTINATION_CHAIN_ID,
    ],
  ]);
}

function makeMockColibriClient(): {
  client: ColibriClient;
  rpc: ReturnType<typeof vi.fn>;
  getMethodSupport: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn();
  const getMethodSupport = vi.fn().mockResolvedValue(ColibriMethodType.PROOFABLE);
  return { client: { rpc, getMethodSupport }, rpc, getMethodSupport };
}

function makeBackend(client: ColibriClient): ColibriBackend {
  return {
    createClient: vi.fn().mockReturnValue(client),
    registerStorage: vi.fn().mockResolvedValue(undefined),
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "colibri-reentry-"));
  process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"] = tmpDir;
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env["STATELESS_CLIENT_COLIBRI_CACHE_DIR"];
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("deriveVerificationPolicyForStage", () => {
  function baseConfig(destination: ChainConfig): StageSubmissionConfig {
    return {
      source: SOURCE_NON_LOCAL,
      destination,
      connectors: {
        source: SRC_CONNECTOR,
        destination: DST_CONNECTOR,
      },
      txId: TX_ID,
      proofBackend: "local",
      executionBlocks: {},
      repoRoot: "/tmp/repo",
      proofPaths: {
        lockWorkspace: "lock",
        mintWorkspace: "mint",
        ackWorkspace: "ack",
        refundClaimWorkspace: "refund-claim",
        burnWorkspace: "burn",
        lockDockerScript: "lock.sh",
        mintDockerScript: "mint.sh",
        ackDockerScript: "ack.sh",
        refundClaimDockerScript: "refund-claim.sh",
        burnDockerScript: "burn.sh",
      },
      risc0ProverMode: "local",
      verificationHints: {
        priorProofStageVerifications: [
          {
            stage: "source-deposit",
            mode: "rpc-fallback",
            degraded: true,
          },
        ],
      },
    };
  }

  it("forces retry-from-scratch on later non-local proof stages after prior degraded non-local stage", () => {
    const policy = deriveVerificationPolicyForStage(baseConfig(DEST_NON_LOCAL), "destination-funds-released");
    expect(policy.retryColibriFromScratch).toBe(true);
  });

  it("does not force retry-from-scratch for local stages", () => {
    const policy = deriveVerificationPolicyForStage(baseConfig(DEST_LOCAL), "destination-funds-released");
    expect(policy.retryColibriFromScratch).toBe(false);
  });

  it("uses the same pruned-ack predicate for status 0/4", () => {
    expect(shouldUsePrunedAckVerification(0, 4)).toBe(true);
    expect(shouldUsePrunedAckVerification(2, 4)).toBe(false);
  });
});

describe("verifyStage retry-first policy (non-sticky mode)", () => {
  it("still returns colibri mode when a later non-local stage succeeds after prior degradation", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeBackend(client));

    rpc.mockImplementation(async (method: string) => {
      if (method === "eth_getLogs") {
        return [makeFundsReleasedLog()];
      }
      return makeGetTxResult(4);
    });

    const result = await verifyStage({
      stage: "destination-funds-released",
      chain: DEST_NON_LOCAL,
      connector: DST_CONNECTOR,
      txId: TX_ID,
      expectedSrcConnector: SRC_CONNECTOR,
      expectedDstConnector: DST_CONNECTOR,
      blockTag: 88,
      verificationPolicy: { retryColibriFromScratch: true },
    });

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
  });
});

describe("verifyAckEventOnly pruned ack", () => {
  it("uses Colibri proofable eth_getLogs first and succeeds without degradation", async () => {
    const { client, rpc } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeBackend(client));

    rpc.mockResolvedValue([makeAckReadyLog()]);

    const mockProvider = {
      getLogs: vi.fn(),
    };

    const result = await verifyAckEventOnly({
      stage: "source-ack-ready",
      chain: SOURCE_NON_LOCAL,
      connector: SRC_CONNECTOR,
      txId: TX_ID,
      expectedSrcConnector: SRC_CONNECTOR,
      expectedDstConnector: DST_CONNECTOR,
      blockTag: 101,
      provider: mockProvider as unknown as JsonRpcProvider,
    });

    expect(result.mode).toBe("colibri");
    expect(result.degraded).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenNthCalledWith(1, "eth_getLogs", expect.any(Array), ColibriMethodType.PROOFABLE);
    expect(mockProvider.getLogs).not.toHaveBeenCalled();
  });

  it("falls back to RPC logs after Colibri failure and marks stage as degraded", async () => {
    const { client, getMethodSupport } = makeMockColibriClient();
    vi.mocked(getColibriBackend).mockResolvedValue(makeBackend(client));

    getMethodSupport.mockRejectedValue(
      new Error("last sync state is higher than the required period: cannot sync backwards"),
    );

    const mockProvider = {
      getLogs: vi.fn().mockResolvedValue([makeAckReadyLog()]),
    };

    const result = await verifyAckEventOnly({
      stage: "source-ack-ready",
      chain: DEST_NON_LOCAL,
      connector: SRC_CONNECTOR,
      txId: TX_ID,
      expectedSrcConnector: SRC_CONNECTOR,
      expectedDstConnector: DST_CONNECTOR,
      blockTag: 101,
      provider: mockProvider as unknown as JsonRpcProvider,
    });

    expect(result.mode).toBe("rpc-fallback");
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe("chiado_sync_backwards");
    expect(getMethodSupport.mock.calls.length).toBeGreaterThan(1);
    expect(mockProvider.getLogs).toHaveBeenCalledTimes(1);
  });
});
