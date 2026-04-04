import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../../src/agent/server.js";
import { createJob, getJob, setDb, upsertCheckpoint } from "../../src/agent/db.js";
import type { TransferIntent } from "../../src/agent/contracts.js";

vi.mock("../../src/agent/integrations/relay.js", () => {
  return {
    buildDirectPayload: vi.fn().mockImplementation((_intent: TransferIntent, txId: string, stage: string) => ({
      stage,
      actionKind: "direct",
      proofPayload: null,
      contractMethod: "initiateRefund",
      contractArgs: [txId],
      targetChainId: 31337,
      targetConnector: "0x2222222222222222222222222222222222222222",
    })),
    discoverTransferByTxId: vi.fn(),
    getResumeDecision: vi.fn(),
    resolveRepoRoot: vi.fn().mockResolvedValue("/fake/repo"),
    runPrepareStage: vi.fn().mockImplementation(async (_intent: TransferIntent, txId: string, stage: string) => ({
      payload: {
        stage,
        actionKind: "proof",
        proofPayload: "0xproof",
        contractMethod: "submitProof",
        contractArgs: [0, "0xproof", txId],
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
    })),
    shouldUsePrunedAckVerification: vi.fn().mockReturnValue(false),
  };
});

import { getResumeDecision } from "../../src/agent/integrations/relay.js";

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

function makeRes() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
    sendStatus(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

function getRouteHandler(app: Express, method: "get" | "post" | "patch", path: string) {
  const stack = (
    (app as unknown as { _router?: { stack?: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (...args: unknown[]) => void }> } }> } })
      ._router?.stack ?? []
  );
  const layer = stack?.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer?.route?.stack?.[0]?.handle) {
    throw new Error(`Route handler not found for ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack[0].handle as (req: Record<string, unknown>, res: ReturnType<typeof makeRes>) => void;
}

describe("agent server manual endpoints", () => {
  beforeEach(() => {
    setDb(new Database(":memory:"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates settings via PATCH /jobs/:id/settings", async () => {
    const app = createApp();
    const job = createJob(INTENT, "0x" + "ab".repeat(32));
    const handler = getRouteHandler(app, "patch", "/jobs/:id/settings");
    const res = makeRes();

    handler(
      {
        params: { id: job.id },
        body: { relayMode: "manual", postSubmitBehavior: "pause" },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect((res.payload as { relayMode: string }).relayMode).toBe("manual");
    expect((res.payload as { postSubmitBehavior: string }).postSubmitBehavior).toBe("pause");
  });

  it("refreshes planner status via POST /jobs/:id/refresh", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "mint",
      reason: "destination has funds, source needs mint proof",
      sourceStatus: 1,
      destinationStatus: 4,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });
    const app = createApp();
    const job = createJob(INTENT, "0x" + "cd".repeat(32));
    const handler = getRouteHandler(app, "post", "/jobs/:id/refresh");
    const res = makeRes();

    handler({ params: { id: job.id }, body: {} }, res);

    await vi.waitFor(() => {
      expect(res.statusCode).toBe(200);
      expect(res.payload).toBeDefined();
    });
    expect((res.payload as { plannerAction: string }).plannerAction).toBe("mint");
    expect((res.payload as { sourceStatus: number }).sourceStatus).toBe(1);
    expect((res.payload as { destinationStatus: number }).destinationStatus).toBe(4);
  });

  it("prepares manual stage via POST /jobs/:id/prepare and returns structured stage details", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "lock",
      reason: "source has deposit, destination needs lock proof",
      sourceStatus: 1,
      destinationStatus: 0,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });
    const app = createApp();
    const job = createJob(INTENT, "0x" + "ef".repeat(32));
    const prepareHandler = getRouteHandler(app, "post", "/jobs/:id/prepare");
    const detailsHandler = getRouteHandler(app, "get", "/jobs/:id/stages/:stage");

    const prepareRes = makeRes();
    prepareHandler(
      {
        params: { id: job.id },
        body: { stage: "refund-claim", force: true },
      },
      prepareRes,
    );

    await vi.waitFor(() => {
      const updated = getJob(job.id);
      expect(updated?.currentStage).toBe("refund-claim");
      expect(updated?.status).toBe("ready_for_signature");
      expect(prepareRes.statusCode).toBe(202);
    });

    const detailsRes = makeRes();
    detailsHandler(
      {
        params: { id: job.id, stage: "refund-claim" },
      },
      detailsRes,
    );
    expect(detailsRes.statusCode).toBe(200);
    expect((detailsRes.payload as { stage: string }).stage).toBe("refund-claim");
    expect((detailsRes.payload as { checkpointState: string }).checkpointState).toBe("prepared");
    expect((detailsRes.payload as { plannerMismatch: boolean }).plannerMismatch).toBe(true);
  });

  it("keeps legacy confirm and next-stage routes working", async () => {
    vi.mocked(getResumeDecision).mockResolvedValue({
      action: "lock",
      reason: "source has deposit, destination needs lock proof",
      sourceStatus: 1,
      destinationStatus: 0,
      historyFlags: { depositLocked: false, fundsReleased: false, ackReady: false },
    });
    const app = createApp();
    const job = createJob(INTENT, "0x" + "aa".repeat(32));
    const confirmHandler = getRouteHandler(app, "post", "/jobs/:id/confirm");
    const nextStageHandler = getRouteHandler(app, "get", "/jobs/:id/next-stage");

    const confirmRes = makeRes();
    confirmHandler({ params: { id: job.id }, body: {} }, confirmRes);
    expect(confirmRes.statusCode).toBe(202);

    await vi.waitFor(() => {
      expect(getJob(job.id)?.status).toBe("ready_for_signature");
    });

    const nextStageRes = makeRes();
    nextStageHandler({ params: { id: job.id } }, nextStageRes);
    expect(nextStageRes.statusCode).toBe(200);
    expect((nextStageRes.payload as { stage: string }).stage).toBe("lock");
  });

  it("keeps legacy /stages/:stage/proof payload route available", async () => {
    const app = createApp();
    const job = createJob(INTENT, "0x" + "bb".repeat(32));
    upsertCheckpoint({
      jobId: job.id,
      stage: "lock",
      payloadJson: JSON.stringify({
        stage: "lock",
        actionKind: "proof",
        proofPayload: "0x1234",
        contractMethod: "submitLockProof",
        contractArgs: [],
        targetChainId: 31338,
        targetConnector: INTENT.destinationConnector,
      }),
    });
    const proofHandler = getRouteHandler(app, "get", "/jobs/:id/stages/:stage/proof");
    const proofRes = makeRes();

    proofHandler({ params: { id: job.id, stage: "lock" } }, proofRes);

    expect(proofRes.statusCode).toBe(200);
    expect((proofRes.payload as { stage: string }).stage).toBe("lock");
    expect((proofRes.payload as { contractMethod: string }).contractMethod).toBe("submitLockProof");
  });
});
