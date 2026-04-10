import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJob, getCheckpoint, getJob, setDb, updateJob, upsertCheckpoint } from "../../src/agent/db.js";
import { confirmJob, prepareJobStage, refreshJob, recordReceipt, updateJobSettings } from "../../src/agent/services/job-service.js";
import type { RelayProofStage, TransferIntent } from "../../src/agent/contracts.js";

vi.mock("../../src/agent/integrations/relay.js", () => {
  return {
    buildDirectPayload: vi.fn().mockImplementation((_intent: TransferIntent, txId: string, stage: RelayProofStage) => ({
      stage,
      actionKind: "direct",
      proofPayload: null,
      contractMethod: stage === "execute-burn" ? "executeBurn" : "initiateRefund",
      contractArgs: [txId],
      targetChainId: 31337,
      targetConnector: "0x2222222222222222222222222222222222222222",
    })),
    discoverTransferByTxId: vi.fn(),
    getResumeDecision: vi.fn(),
    resolveRepoRoot: vi.fn().mockResolvedValue("/fake/repo"),
    runPrepareStage: vi.fn().mockImplementation(
      async (_intent: TransferIntent, txId: string, stage: RelayProofStage) => ({
        payload: {
          stage,
          actionKind: "proof",
          proofPayload: "0xabc123",
          contractMethod: "submitProof",
          contractArgs: [0, "0xabc123", txId],
          targetChainId: 31337,
          targetConnector: "0x2222222222222222222222222222222222222222",
        },
        verification: {
          stage: "source-deposit",
          mode: "colibri",
          degraded: false,
          eventName: "DepositLocked",
          txId,
          connector: "0x1111111111111111111111111111111111111111",
          status: 1,
        },
      }),
    ),
    shouldUsePrunedAckVerification: vi.fn().mockReturnValue(false),
  };
});

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

const TX_ID = "0x" + "ab".repeat(32);

function freshDb(): void {
  setDb(new Database(":memory:"));
}

describe("manual and auto relay job flow", () => {
  beforeEach(() => {
    freshDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refresh updates planner action and statuses without preparing", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "mint",
      reason: "destination has funds, source needs mint proof",
      sourceStatus: 1,
      destinationStatus: 4,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    const job = createJob(INTENT, TX_ID);
    const updated = await refreshJob(job.id);

    expect(updated.sourceStatus).toBe(1);
    expect(updated.destinationStatus).toBe(4);
    expect(updated.plannerAction).toBe("mint");
    expect(updated.plannerReason).toContain("destination has funds");
    expect(runPrepareStage).not.toHaveBeenCalled();
  });

  it("prepares planner-matching manual stage", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "lock",
      reason: "source has deposit, destination needs lock proof",
      sourceStatus: 1,
      destinationStatus: 0,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    const job = createJob(INTENT, TX_ID);
    updateJobSettings(job.id, { relayMode: "manual" });

    await prepareJobStage(job.id, { stage: "lock" });

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.status).toBe("ready_for_signature");
      expect(updated?.currentStage).toBe("lock");
    });
    expect(getCheckpoint(job.id, "lock")).toBeDefined();
  });

  it("allows manual prepare on mismatch when force=true", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "lock",
      reason: "source has deposit, destination needs lock proof",
      sourceStatus: 1,
      destinationStatus: 0,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    const job = createJob(INTENT, TX_ID);
    updateJobSettings(job.id, { relayMode: "manual" });

    await prepareJobStage(job.id, { stage: "refund-claim", force: true });

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.currentStage).toBe("refund-claim");
      expect(updated?.plannerAction).toBe("lock");
      expect(updated?.plannerReason).toContain("force=true");
    });
  });

  it("reuses unsubmitted checkpoint unless regenerate=true", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "lock",
      reason: "source has deposit, destination needs lock proof",
      sourceStatus: 1,
      destinationStatus: 0,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    const job = createJob(INTENT, TX_ID);
    updateJobSettings(job.id, { relayMode: "manual" });

    await prepareJobStage(job.id, { stage: "lock" });
    await vi.waitFor(() => {
      expect(runPrepareStage).toHaveBeenCalledTimes(1);
    });

    await prepareJobStage(job.id, { stage: "lock" });
    await vi.waitFor(() => {
      expect(getJob(job.id)?.status).toBe("ready_for_signature");
    });
    expect(runPrepareStage).toHaveBeenCalledTimes(1);

    await prepareJobStage(job.id, { stage: "lock", regenerate: true });
    await vi.waitFor(() => {
      expect(runPrepareStage).toHaveBeenCalledTimes(2);
    });
  });

  it("pauses after manual receipt when postSubmitBehavior is pause", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "mint",
      reason: "destination has funds, source needs mint proof",
      sourceStatus: 1,
      destinationStatus: 4,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    const job = createJob(INTENT, TX_ID);
    updateJobSettings(job.id, { relayMode: "manual", postSubmitBehavior: "pause" });
    updateJob(job.id, { status: "ready_for_signature", currentStage: "lock" });
    upsertCheckpoint({ jobId: job.id, stage: "lock", payloadJson: "{}" });

    recordReceipt(job.id, "lock", "0xhash");

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.status).toBe("awaiting_confirmation");
      expect(updated?.currentStage).toBe("mint");
      expect(updated?.plannerAction).toBe("mint");
    });
    expect(runPrepareStage).not.toHaveBeenCalled();
  });

  it("auto-prepares next stage after manual receipt when configured", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "mint",
      reason: "destination has funds, source needs mint proof",
      sourceStatus: 1,
      destinationStatus: 4,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });

    const job = createJob(INTENT, TX_ID);
    updateJobSettings(job.id, { relayMode: "manual", postSubmitBehavior: "auto_prepare" });
    updateJob(job.id, { status: "ready_for_signature", currentStage: "lock" });
    upsertCheckpoint({ jobId: job.id, stage: "lock", payloadJson: "{}" });

    recordReceipt(job.id, "lock", "0xhash");

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.status).toBe("ready_for_signature");
      expect(updated?.currentStage).toBe("mint");
    });
    expect(runPrepareStage).toHaveBeenCalled();
  });

  it("completes on manual pause when planner reports noop after receipt", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "noop",
      reason: "transaction already terminal",
      sourceStatus: 0,
      destinationStatus: 0,
      historyFlags: { depositLocked: true, fundsReleased: true, ackReady: true },
    });

    const job = createJob(INTENT, TX_ID);
    updateJobSettings(job.id, { relayMode: "manual", postSubmitBehavior: "pause" });
    updateJob(job.id, { status: "ready_for_signature", currentStage: "ack" });
    upsertCheckpoint({ jobId: job.id, stage: "ack", payloadJson: "{}" });

    recordReceipt(job.id, "ack", "0xfinalhash");

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.currentStage).toBe("completed");
      expect(updated?.plannerAction).toBe("noop");
    });
    expect(runPrepareStage).not.toHaveBeenCalled();
  });

  it("preserves auto-mode confirm and receipt advance behavior", async () => {
    vi.mocked(getResumeDecision)
      .mockResolvedValueOnce({
        action: "lock",
        reason: "source has deposit, destination needs lock proof",
        sourceStatus: 1,
        destinationStatus: 0,
        historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
      })
      .mockResolvedValueOnce({
        action: "mint",
        reason: "destination has funds, source needs mint proof",
        sourceStatus: 1,
        destinationStatus: 4,
        historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
      });

    const job = createJob(INTENT, TX_ID);
    await confirmJob(job.id);

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.status).toBe("ready_for_signature");
      expect(updated?.currentStage).toBe("lock");
    });

    recordReceipt(job.id, "lock", "0xautohash");

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.status).toBe("ready_for_signature");
      expect(updated?.currentStage).toBe("mint");
    });
  });
});
