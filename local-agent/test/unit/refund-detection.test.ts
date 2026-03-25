import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setDb, createJob, getJob } from "../../src/db.js";
import type { TransferIntent } from "../../src/types.js";

// The proof worker imports planRelayResume and buildStageReadyPayload from stateless-client.
// We mock the entire stateless-client module so tests run without a real chain.
vi.mock("stateless-client", async () => {
  const actual = await vi.importActual<typeof import("stateless-client")>("stateless-client");
  return {
    ...actual,
    planRelayResume: vi.fn(),
    buildStageReadyPayload: vi.fn(),
    discoverRepoRoot: vi.fn().mockReturnValue("/fake/repo"),
    resolveChainConfig: actual.resolveChainConfig
  };
});

// Must be imported after vi.mock declarations
import { startJob } from "../../src/proof-worker.js";
import { planRelayResume, buildStageReadyPayload } from "stateless-client";

const INTENT: TransferIntent = {
  sourceProfile: "local-anvil",
  destinationProfile: "local-hardhat",
  sourceConnector: "0x1111111111111111111111111111111111111111",
  destinationConnector: "0x2222222222222222222222222222222222222222",
  tokenFrom: "0xaaaa",
  tokenTo: "0xbbbb",
  amount: "1000000000000000000",
  receiver: "0xcccc"
};

function freshDb(): void {
  const db = new Database(":memory:");
  setDb(db);
}

describe("refund state detection", () => {
  beforeEach(() => {
    freshDb();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("marks job as unsupported when sourceStatus is 3 (refund)", async () => {
    vi.mocked(planRelayResume).mockResolvedValue({
      action: "error",
      reason: "unsupported refund path",
      sourceStatus: 3,
      destinationStatus: 0,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false }
    });

    const job = createJob(INTENT, "0x" + "ab".repeat(32));
    await startJob(job.id);

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("unsupported");
    expect(updated.lastError).toMatch(/refund/i);
    expect(buildStageReadyPayload).not.toHaveBeenCalled();
  });

  it("marks job as unsupported when destinationStatus is 5 (refund)", async () => {
    vi.mocked(planRelayResume).mockResolvedValue({
      action: "error",
      reason: "unsupported refund path",
      sourceStatus: 1,
      destinationStatus: 5,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false }
    });

    const job = createJob(INTENT, "0x" + "cd".repeat(32));
    await startJob(job.id);

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("unsupported");
    expect(buildStageReadyPayload).not.toHaveBeenCalled();
  });

  it("marks job as error for non-refund error decisions", async () => {
    vi.mocked(planRelayResume).mockResolvedValue({
      action: "error",
      reason: "inconsistent cross-chain state",
      sourceStatus: 0,
      destinationStatus: 4,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false }
    });

    const job = createJob(INTENT, "0x" + "ef".repeat(32));
    await startJob(job.id);

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("error");
  });
});
