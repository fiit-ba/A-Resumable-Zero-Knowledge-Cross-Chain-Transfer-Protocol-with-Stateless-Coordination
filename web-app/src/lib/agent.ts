const BASE_URL = (import.meta as { env?: { VITE_AGENT_URL?: string } }).env?.VITE_AGENT_URL ?? "http://localhost:3333";

// ---------------------------------------------------------------------------
// Shared types (mirrors stateless-client types without the Node.js import)
// ---------------------------------------------------------------------------

export interface TransferIntent {
  sourceProfile: string;
  destinationProfile: string;
  sourceConnector: string;
  destinationConnector: string;
  tokenFrom: string;
  tokenTo: string;
  /** Amount as a decimal-string bigint (e.g. "1000000000000000000"). */
  amount: string;
  receiver: string;
}

export type JobStatus =
  | "pending"
  | "running"
  | "proof-ready"
  | "done"
  | "error"
  | "unsupported";

export interface RelayJob {
  id: string;
  txId: string;
  currentStage: "lock" | "mint" | "ack" | "pending" | "done";
  status: JobStatus;
  sourceStatus: number;
  destinationStatus: number;
  lastError?: string;
  latestSubmissionTxHash?: string;
  intent: TransferIntent;
  createdAt: number;
  updatedAt: number;
}

export interface StageReadyPayload {
  stage: "lock" | "mint" | "ack";
  proofPayload: string;
  contractMethod: string;
  contractArgs: unknown[];
  targetChainId: number;
  targetConnector: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function createJob(
  txId: string,
  intent: TransferIntent
): Promise<RelayJob> {
  const res = await fetch(`${BASE_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txId, intent })
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new Error(`Failed to create job: ${msg}`);
  }
  return res.json() as Promise<RelayJob>;
}

export async function getJob(id: string): Promise<RelayJob> {
  const res = await fetch(`${BASE_URL}/jobs/${id}`);
  if (!res.ok) throw new Error(`Job not found (${res.status}): ${id}`);
  return res.json() as Promise<RelayJob>;
}

export async function getStageProof(
  jobId: string,
  stage: string
): Promise<StageReadyPayload | null> {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}/stages/${stage}/proof`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get proof: ${res.status}`);
  return res.json() as Promise<StageReadyPayload>;
}

export async function submitReceipt(
  jobId: string,
  stage: string,
  txHash: string
): Promise<RelayJob> {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage, txHash })
  });
  if (!res.ok) throw new Error(`Failed to submit receipt: ${res.status}`);
  return res.json() as Promise<RelayJob>;
}
