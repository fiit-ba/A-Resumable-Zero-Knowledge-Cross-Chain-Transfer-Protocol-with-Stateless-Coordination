import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJob, getJobRecoveryMetadata, setDb } from "../../src/agent/db.js";
import { recoverJob } from "../../src/agent/services/job-service.js";
import { discoverTransferByTxId } from "../../src/agent/integrations/relay.js";
import type { TransferIntent } from "../../src/agent/contracts.js";

vi.mock("../../src/agent/integrations/relay.js", () => {
  return {
    buildDirectPayload: vi.fn(),
    discoverTransferByTxId: vi.fn(),
    getResumeDecision: vi.fn(),
    resolveRepoRoot: vi.fn(),
    runPrepareStage: vi.fn(),
    shouldUsePrunedAckVerification: vi.fn(),
  };
});

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

describe("agent recovery", () => {
  beforeEach(() => {
    setDb(new Database(":memory:"));
    vi.clearAllMocks();
  });

  it("resumes an existing job without rescanning chains", async () => {
    const job = createJob(INTENT, "0x" + "ab".repeat(32));

    const result = await recoverJob(job.txId);

    expect(result).toEqual({ type: "resumed", job });
    expect(discoverTransferByTxId).not.toHaveBeenCalled();
  });

  it("creates a recovered job with persisted discovery metadata", async () => {
    vi.mocked(discoverTransferByTxId).mockResolvedValue({
      matches: [
        {
          sourceProfile: "local-anvil",
          sourceConnector: INTENT.sourceConnector,
          destinationProfile: "local-hardhat",
          destinationConnector: INTENT.destinationConnector,
          executionBlocks: {
            sourceDeposit: 12,
            destinationFundsReleased: 18,
          },
          sourceStatus: 1,
          destinationStatus: 4,
          transferData: {
            amount: 5n,
            tokenFrom: INTENT.tokenFrom,
            tokenTo: INTENT.tokenTo,
            receiver: INTENT.receiver,
          },
          historyHints: {
            depositLocked: true,
            fundsReleased: true,
            ackReady: false,
            refundInitiated: false,
            burnExecuted: false,
          },
        },
      ],
      scannedProfiles: ["local-anvil", "local-hardhat"],
    });

    const result = await recoverJob("0x" + "cd".repeat(32));

    expect(result.type).toBe("created");
    if (result.type !== "created") {
      throw new Error("Expected recovered job creation.");
    }

    expect(result.job.intent.amount).toBe("5");

    const metadata = getJobRecoveryMetadata(result.job.id);
    expect(metadata).toMatchObject({
      sourceProfile: "local-anvil",
      destinationProfile: "local-hardhat",
      executionBlocks: {
        sourceDeposit: 12,
        destinationFundsReleased: 18,
      },
    });
  });
});
