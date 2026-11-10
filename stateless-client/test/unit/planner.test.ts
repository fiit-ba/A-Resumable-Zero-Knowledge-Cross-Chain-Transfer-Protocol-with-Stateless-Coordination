import { afterEach, describe, expect, it, vi } from "vitest";
import { computeResumeDecision, planRelayResume } from "../../src/relay/planner.js";
import type { ChainConfig, HistoryFlags } from "../../src/core/types.js";

vi.mock("../../src/relay/endpoints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/relay/endpoints.js")>();
  return { ...actual, connectorReaders: vi.fn() };
});

import { connectorReaders } from "../../src/relay/endpoints.js";

const NO_HISTORY: HistoryFlags = {
  depositLocked: false,
  fundsReleased: false,
  ackReady: false,
};

describe("computeResumeDecision", () => {
  it("1/0 -> lock", () => {
    const d = computeResumeDecision(1, 0, NO_HISTORY);
    expect(d.action).toBe("lock");
    expect(d.sourceStatus).toBe(1);
    expect(d.destinationStatus).toBe(0);
  });

  it("1/3 -> mint", () => {
    const d = computeResumeDecision(1, 3, NO_HISTORY);
    expect(d.action).toBe("mint");
  });

  it("0/3 + AckReady history -> ack", () => {
    const d = computeResumeDecision(0, 3, {
      ...NO_HISTORY,
      ackReady: true,
    });
    expect(d.action).toBe("ack");
    expect(d.reason).toMatch(/pruned/i);
    expect(d.historyFlags.ackReady).toBe(true);
  });

  it("0/3 without AckReady history -> inconsistent error", () => {
    const d = computeResumeDecision(0, 3, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/inconsistent/i);
  });

  it("0/0 + DepositLocked history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      depositLocked: true,
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + FundsReleased history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      fundsReleased: true,
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + AckReady history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      ackReady: true,
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + no history -> tx not found error", () => {
    const d = computeResumeDecision(0, 0, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/not found/i);
  });

  it("1/3 + ackDeadlineExpired -> refund-initiate", () => {
    const d = computeResumeDecision(1, 3, { ...NO_HISTORY, ackDeadlineExpired: true });
    expect(d.action).toBe("refund-initiate");
    expect(d.reason).toMatch(/expired/i);
  });

  it("1/0 + ackDeadlineExpired -> refund-initiate, since the destination would reject the lock", () => {
    const d = computeResumeDecision(1, 0, { ...NO_HISTORY, ackDeadlineExpired: true });
    expect(d.action).toBe("refund-initiate");
    expect(d.reason).toMatch(/expired before the destination accepted/i);
  });

  it("1/0 within the ACK window -> lock", () => {
    expect(computeResumeDecision(1, 0, { ...NO_HISTORY, ackDeadlineExpired: false }).action).toBe(
      "lock",
    );
  });

  it("2/3 -> refund-claim", () => {
    const d = computeResumeDecision(2, 3, NO_HISTORY);
    expect(d.action).toBe("refund-claim");
    expect(d.reason).toMatch(/refund/i);
  });

  it("2/4 -> execute-burn", () => {
    const d = computeResumeDecision(2, 4, NO_HISTORY);
    expect(d.action).toBe("execute-burn");
    expect(d.reason).toMatch(/burn/i);
  });

  it("2/0 + DestTxClosed history -> burn-proof", () => {
    const d = computeResumeDecision(2, 0, { ...NO_HISTORY, burnExecuted: true });
    expect(d.action).toBe("burn-proof");
    expect(d.reason).toMatch(/burn/i);
  });

  it("2/0 without DestTxClosed history -> non-accept-proof", () => {
    const d = computeResumeDecision(2, 0, NO_HISTORY);
    expect(d.action).toBe("non-accept-proof");
    expect(d.reason).toMatch(/non-acceptance/i);
  });

  it("unknown combination 1/1 -> inconsistent error", () => {
    const d = computeResumeDecision(1, 1, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/inconsistent/i);
  });

  it("unknown combination 2/2 -> inconsistent error", () => {
    const d = computeResumeDecision(2, 2, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/inconsistent/i);
  });

  it("decision carries sourceStatus and destinationStatus", () => {
    const d = computeResumeDecision(1, 0, NO_HISTORY);
    expect(d.sourceStatus).toBe(1);
    expect(d.destinationStatus).toBe(0);
  });

  it("decision carries historyFlags", () => {
    const flags: HistoryFlags = {
      depositLocked: true,
      fundsReleased: false,
      ackReady: false,
    };
    const d = computeResumeDecision(0, 0, flags);
    expect(d.historyFlags).toEqual(flags);
  });
});

describe("planRelayResume event search", () => {
  const LOOKBACK_ENV = "STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS";
  const TX_ID = "0x" + "ab".repeat(32);
  const CONNECTOR = "0x1111111111111111111111111111111111111111";
  const CHAIN: ChainConfig = {
    side: "source",
    profileName: "custom",
    isLocal: false,
    chainId: 59141,
    rpcUrls: ["https://rpc.sepolia.linea.build"],
    proverUrls: [],
    beaconUrls: [],
    checkpointzUrls: [],
  };
  const CONFIG = {
    source: CHAIN,
    destination: CHAIN,
    connectors: { source: CONNECTOR, destination: CONNECTOR },
    txId: TX_ID,
  };

  /** A connector reader at head block 100000 that reports `status` and finds one event. */
  function makeReader(status: number) {
    return {
      address: CONNECTOR,
      provider: {
        getBlockNumber: vi.fn().mockResolvedValue(100_000),
        getLogs: vi.fn().mockResolvedValue([{}]),
      },
      contract: { txStatus: vi.fn().mockResolvedValue(BigInt(status)) },
    };
  }

  /** Plans a transfer whose source record is pruned (0) and whose destination holds funds (3). */
  async function planPrunedAck() {
    const source = makeReader(0);
    const readers = { source, destination: makeReader(3) };
    vi.mocked(connectorReaders).mockReturnValue(
      readers as unknown as ReturnType<typeof connectorReaders>,
    );
    const decision = await planRelayResume(CONFIG);
    return { decision, getLogs: source.provider.getLogs };
  }

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env[LOOKBACK_ENV];
  });

  it("searches the last 50000 blocks by default", async () => {
    const { decision, getLogs } = await planPrunedAck();

    expect(decision.action).toBe("ack");
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 50_001, toBlock: 100_000 }),
    );
  });

  it("narrows the search to the configured lookback for RPCs with a range limit", async () => {
    process.env[LOOKBACK_ENV] = "10000";

    const { decision, getLogs } = await planPrunedAck();

    expect(decision.action).toBe("ack");
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 90_001, toBlock: 100_000 }),
    );
  });
});
