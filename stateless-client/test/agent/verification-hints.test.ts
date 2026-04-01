import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJob, getJob, setDb, upsertCheckpoint } from "../../src/agent/db.js";
import { confirmJob } from "../../src/agent/services/job-service.js";
import type { TransferIntent } from "../../src/agent/contracts.js";

vi.mock("../../src/agent/integrations/relay.js", () => {
  return {
    buildDirectPayload: vi.fn(),
    discoverTransferByTxId: vi.fn(),
    getResumeDecision: vi.fn(),
    resolveRepoRoot: vi.fn().mockResolvedValue("/fake/repo"),
    runPrepareStage: vi.fn(),
    shouldUsePrunedAckVerification: vi.fn((sourceStatus: number, destinationStatus: number) => {
      return sourceStatus === 0 && destinationStatus === 4;
    }),
  };
});

import {
  getResumeDecision,
  runPrepareStage,
} from "../../src/agent/integrations/relay.js";

const INTENT: TransferIntent = {
  sourceProfile: "sepolia",
  destinationProfile: "chiado",
  sourceConnector: "0x1111111111111111111111111111111111111111",
  destinationConnector: "0x2222222222222222222222222222222222222222",
  tokenFrom: "0xaaaa",
  tokenTo: "0xbbbb",
  amount: "1000000000000000000",
  receiver: "0x3333333333333333333333333333333333333333",
};

function freshDb(): void {
  const db = new Database(":memory:");
  setDb(db);
}

describe("job-service verification hints", () => {
  beforeEach(() => {
    freshDb();
    vi.clearAllMocks();

    vi.mocked(runPrepareStage).mockResolvedValue({
      payload: {
        stage: "ack",
        actionKind: "proof",
        proofPayload: "0x01",
        contractMethod: "submitAckProof",
        contractArgs: ["0x" + "ab".repeat(32)],
        targetChainId: 10200,
        targetConnector: INTENT.destinationConnector,
      },
      verification: {
        stage: "source-ack-ready",
        mode: "colibri",
        degraded: false,
        eventName: "AckReady",
        txId: "0x" + "ab".repeat(32),
        connector: INTENT.sourceConnector,
        status: 2,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets pruned-source-origin ack hint for sourceStatus=0 and destinationStatus=4", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "ack",
      reason: "source origin pruned but AckReady event found; destination needs ack proof",
      sourceStatus: 0,
      destinationStatus: 4,
      historyFlags: {
        depositLocked: false,
        fundsReleased: false,
        ackReady: true,
      },
    });

    const job = createJob(INTENT, "0x" + "ab".repeat(32));
    await confirmJob(job.id);

    await vi.waitFor(() => {
      expect(runPrepareStage).toHaveBeenCalled();
    });

    const [, , stage, , verificationHints] = vi.mocked(runPrepareStage).mock.calls[0];
    expect(stage).toBe("ack");
    expect(verificationHints?.ackVariant).toBe("pruned-source-origin");
  });

  it("derives prior proof-stage verification history from persisted checkpoints", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "mint",
      reason: "destination has funds, source needs mint proof",
      sourceStatus: 1,
      destinationStatus: 4,
      historyFlags: {
        depositLocked: false,
        fundsReleased: false,
        ackReady: false,
      },
    });

    vi.mocked(runPrepareStage).mockResolvedValue({
      payload: {
        stage: "mint",
        actionKind: "proof",
        proofPayload: "0x02",
        contractMethod: "submitMintProof",
        contractArgs: ["0x" + "ab".repeat(32)],
        targetChainId: 11155111,
        targetConnector: INTENT.sourceConnector,
      },
      verification: {
        stage: "destination-funds-released",
        mode: "colibri",
        degraded: false,
        eventName: "FundsReleased",
        txId: "0x" + "ab".repeat(32),
        connector: INTENT.destinationConnector,
        status: 4,
      },
    });

    const job = createJob(INTENT, "0x" + "ab".repeat(32));
    upsertCheckpoint({
      jobId: job.id,
      stage: "lock",
      payloadJson: "{}",
      verificationJson: JSON.stringify({
        mode: "rpc-fallback",
        degraded: true,
        verifiedStage: "source-deposit",
      }),
      completedAt: Date.now(),
    });

    await confirmJob(job.id);

    await vi.waitFor(() => {
      expect(runPrepareStage).toHaveBeenCalled();
    });

    const [, , stage, , verificationHints] = vi.mocked(runPrepareStage).mock.calls[0];
    expect(stage).toBe("mint");
    expect(verificationHints?.priorProofStageVerifications).toEqual([
      {
        stage: "source-deposit",
        mode: "rpc-fallback",
        degraded: true,
      },
    ]);

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.status).toBe("ready_for_signature");
    });
  });
});
