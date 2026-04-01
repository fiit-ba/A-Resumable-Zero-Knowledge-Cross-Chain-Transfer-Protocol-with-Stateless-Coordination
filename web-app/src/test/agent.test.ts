import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { agentApi } from "../api/agentApi";
import type { EnrichedStagePayload, RelayJob, TransferIntent } from "../api/types";

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
const JOB_ID = "test-uuid-1234";

const MOCK_JOB: RelayJob = {
  id: JOB_ID,
  txId: TX_ID,
  currentStage: "lock",
  status: "ready_for_signature",
  sourceStatus: 1,
  destinationStatus: 0,
  intent: INTENT,
  createdAt: 1000,
  updatedAt: 2000,
};

const MOCK_NEXT_STAGE: EnrichedStagePayload = {
  stage: "lock",
  actionKind: "proof",
  proofPayload: "0xdeadbeef",
  contractMethod: "submitLockProof",
  contractArgs: [0, "0xdeadbeef", TX_ID],
  targetChainId: 31338,
  targetConnector: "0x2222222222222222222222222222222222222222",
  verificationMode: "colibri",
  verificationDegraded: false,
  verifiedStage: "source-deposit",
};

function makeStore() {
  return configureStore({
    reducer: {
      [agentApi.reducerPath]: agentApi.reducer,
    },
    middleware: (getDefault) => getDefault().concat(agentApi.middleware),
  });
}

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function assertFetchPathContains(path: string, expectedMethod: string): void {
  expect(fetch).toHaveBeenCalled();
  const [request, init] = vi.mocked(fetch).mock.calls.at(-1) ?? [];
  const url =
    typeof request === "string"
      ? request
      : request instanceof Request
        ? request.url
        : String(request);
  const method =
    init?.method ??
    (request instanceof Request ? request.method : undefined) ??
    "";
  expect(url).toContain(path);
  expect(method.toUpperCase()).toBe(expectedMethod);
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agentApi endpoints", () => {
  it("createJob posts to /jobs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(MOCK_JOB));

    const store = makeStore();
    const request = store.dispatch(agentApi.endpoints.createJob.initiate({ txId: TX_ID, intent: INTENT }));
    const data = await request.unwrap();

    assertFetchPathContains("/jobs", "POST");
    expect(data.id).toBe(JOB_ID);
    expect(data.txId).toBe(TX_ID);
  });

  it("getJob reads /jobs/:id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(MOCK_JOB));

    const store = makeStore();
    const request = store.dispatch(agentApi.endpoints.getJob.initiate(JOB_ID));
    const data = await request.unwrap();

    assertFetchPathContains(`/jobs/${JOB_ID}`, "GET");
    expect(data.status).toBe("ready_for_signature");
  });

  it("getNextStage reads /jobs/:id/next-stage", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(MOCK_NEXT_STAGE));

    const store = makeStore();
    const request = store.dispatch(agentApi.endpoints.getNextStage.initiate(JOB_ID));
    const data = await request.unwrap();

    assertFetchPathContains(`/jobs/${JOB_ID}/next-stage`, "GET");
    expect(data.stage).toBe("lock");
    expect(data.contractMethod).toBe("submitLockProof");
  });

  it("submitReceipt posts to /jobs/:id/receipts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...MOCK_JOB, status: "preparing_stage", currentStage: "mint" }),
    );

    const store = makeStore();
    const request = store.dispatch(
      agentApi.endpoints.submitReceipt.initiate({
        jobId: JOB_ID,
        stage: "lock",
        txHash: "0xtxhash",
      }),
    );
    const data = await request.unwrap();

    assertFetchPathContains(`/jobs/${JOB_ID}/receipts`, "POST");
    expect(data.currentStage).toBe("mint");
  });
});
