import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setDb, createJob, getJob } from "../../src/agent/db.js";
import type { TransferIntent } from "../../src/agent/contracts.js";

vi.mock("../../src/agent/integrations/relay.js", () => {
  return {
    buildDirectPayload: vi.fn().mockReturnValue({
      stage: "refund-initiate",
      actionKind: "direct",
      proofPayload: null,
      contractMethod: "initiateRefund",
      contractArgs: ["0x" + "ab".repeat(32)],
      targetChainId: 31337,
      targetConnector: "0x1111111111111111111111111111111111111111",
    }),
    getResumeDecision: vi.fn(),
    resolveRepoRoot: vi.fn().mockResolvedValue("/fake/repo"),
    runPrepareStage: vi.fn(),
    shouldUsePrunedAckVerification: vi.fn(),
  };
});

import { confirmJob } from "../../src/agent/services/job-service.js";
import { getResumeDecision, runPrepareStage } from "../../src/agent/integrations/relay.js";

const INTENT: TransferIntent = {
  sourceProfile: "local-anvil",
  destinationProfile: "local-hardhat",
  sourceConnector: "0x1111111111111111111111111111111111111111",
  destinationConnector: "0x2222222222222222222222222222222222222222",
  tokenFrom: "0xaaaa",
  tokenTo: "0xbbbb",
  amount: "1000000000000000000",
  receiver: "0xcccc",
};

function freshDb(): void {
  const db = new Database(":memory:");
  setDb(db);
}

describe("refund state routing", () => {
  beforeEach(() => {
    freshDb();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes to refund-initiate stage when ACK deadline has expired", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "refund-initiate",
      reason: "ACK window expired; source must initiate refund",
      sourceStatus: 1,
      destinationStatus: 4,
      historyFlags: {
        depositLocked: false,
        fundsReleased: false,
        ackReady: false,
        ackDeadlineExpired: true,
      },
    });

    const job = createJob(INTENT, "0x" + "ab".repeat(32));
    await confirmJob(job.id);

    const updated = getJob(job.id)!;
    expect(updated.currentStage).toBe("refund-initiate");
    expect(updated.status).not.toBe("unsupported");
    expect(runPrepareStage).not.toHaveBeenCalled();
  });

  it("routes to refund-claim stage when source has REFUND_INITIATED", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "refund-claim",
      reason: "refund initiated on source; destination needs refund-claim proof",
      sourceStatus: 3,
      destinationStatus: 4,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    // prepareStageSubmission is async — just make it hang so we can observe the
    // intermediate "preparing_stage" state after confirmJob() returns.
    vi.mocked(runPrepareStage).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );

    const job = createJob(INTENT, "0x" + "cd".repeat(32));
    await confirmJob(job.id);

    const updated = getJob(job.id)!;
    expect(updated.currentStage).toBe("refund-claim");
    expect(updated.status).toBe("preparing_stage");
    expect(updated.status).not.toBe("unsupported");
  });

  it("marks job as failed for error decisions (no longer unsupported)", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "error",
      reason: "inconsistent cross-chain state",
      sourceStatus: 0,
      destinationStatus: 4,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    const job = createJob(INTENT, "0x" + "ef".repeat(32));
    await confirmJob(job.id);

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("failed");
    expect(updated.lastError).toMatch(/inconsistent/i);
  });
});
