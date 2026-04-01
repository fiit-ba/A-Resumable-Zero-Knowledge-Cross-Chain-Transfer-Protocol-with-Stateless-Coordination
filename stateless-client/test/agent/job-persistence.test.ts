import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import {
  setDb,
  createJob,
  getJob,
  getJobByTxId,
  listJobs,
  updateJob,
  upsertCheckpoint,
  getCheckpoint,
} from "../../src/agent/db.js";
import type { TransferIntent } from "../../src/agent/contracts.js";

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

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  setDb(db);
  return db;
}

describe("job persistence", () => {
  beforeEach(() => {
    freshDb();
  });

  it("creates a job and retrieves it", () => {
    const job = createJob(INTENT, TX_ID);
    expect(job.id).toBeTypeOf("string");
    expect(job.txId).toBe(TX_ID);
    expect(job.status).toBe("awaiting_confirmation");
    expect(job.currentStage).toBe("pending");
    expect(job.intent).toEqual(INTENT);

    const fetched = getJob(job.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(job.id);
  });

  it("returns undefined for unknown job id", () => {
    expect(getJob("nonexistent")).toBeUndefined();
  });

  it("finds a job by txId", () => {
    const job = createJob(INTENT, TX_ID);
    const found = getJobByTxId(TX_ID);
    expect(found).toBeDefined();
    expect(found!.id).toBe(job.id);
  });

  it("lists all jobs", () => {
    createJob(INTENT, TX_ID);
    createJob({ ...INTENT, receiver: "0xdddd" }, "0x" + "cd".repeat(32));
    const all = listJobs();
    expect(all).toHaveLength(2);
  });

  it("updates job status and stage", () => {
    const job = createJob(INTENT, TX_ID);
    updateJob(job.id, { status: "preparing_stage", currentStage: "lock" });
    const updated = getJob(job.id)!;
    expect(updated.status).toBe("preparing_stage");
    expect(updated.currentStage).toBe("lock");
  });

  it("stores and retrieves a stage checkpoint", () => {
    const job = createJob(INTENT, TX_ID);
    const payload = {
      stage: "lock" as const,
      proofPayload: "0xabc",
      contractMethod: "submitLockProof",
      contractArgs: [],
      targetChainId: 31337,
      targetConnector: "0x1111",
    };
    upsertCheckpoint({ jobId: job.id, stage: "lock", payloadJson: JSON.stringify(payload) });

    const cp = getCheckpoint(job.id, "lock");
    expect(cp).toBeDefined();
    expect(cp!.stage).toBe("lock");
    expect(JSON.parse(cp!.payloadJson)).toEqual(payload);
    expect(cp!.completedAt).toBeUndefined();
  });

  it("marks a checkpoint as completed", () => {
    const job = createJob(INTENT, TX_ID);
    upsertCheckpoint({ jobId: job.id, stage: "lock", payloadJson: "{}" });
    upsertCheckpoint({
      jobId: job.id,
      stage: "lock",
      payloadJson: "{}",
      completedAt: 9999,
      submissionTxHash: "0xhash",
    });

    const cp = getCheckpoint(job.id, "lock");
    expect(cp!.completedAt).toBe(9999);
    expect(cp!.submissionTxHash).toBe("0xhash");
  });
});
