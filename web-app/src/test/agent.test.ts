import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJob, getJob, getStageProof, submitReceipt } from '../lib/agent';
import type { RelayJob, StageReadyPayload, TransferIntent } from '../lib/agent';

const INTENT: TransferIntent = {
  sourceProfile: 'local-anvil',
  destinationProfile: 'local-hardhat',
  sourceConnector: '0x1111111111111111111111111111111111111111',
  destinationConnector: '0x2222222222222222222222222222222222222222',
  tokenFrom: '0xaaaa',
  tokenTo: '0xbbbb',
  amount: '1000000000000000000',
  receiver: '0xcccc',
};

const TX_ID = '0x' + 'ab'.repeat(32);
const JOB_ID = 'test-uuid-1234';

const MOCK_JOB: RelayJob = {
  id: JOB_ID,
  txId: TX_ID,
  currentStage: 'lock',
  status: 'proof-ready',
  sourceStatus: 1,
  destinationStatus: 0,
  intent: INTENT,
  createdAt: 1000,
  updatedAt: 2000,
};

const MOCK_PROOF: StageReadyPayload = {
  stage: 'lock',
  proofPayload: '0xdeadbeef',
  contractMethod: 'submitLockProof',
  contractArgs: [0, '0xdeadbeef', TX_ID],
  targetChainId: 31338,
  targetConnector: '0x2222222222222222222222222222222222222222',
};

beforeEach(() => {
  vi.spyOn(global, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createJob', () => {
  it('POSTs to /jobs and returns the created job', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_JOB),
    } as Response);

    const job = await createJob(TX_ID, INTENT);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/jobs'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(job.id).toBe(JOB_ID);
    expect(job.txId).toBe(TX_ID);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as Response);

    await expect(createJob(TX_ID, INTENT)).rejects.toThrow('Failed to create job');
  });
});

describe('getJob', () => {
  it('GETs /jobs/:id and returns the job', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_JOB),
    } as Response);

    const job = await getJob(JOB_ID);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/jobs/${JOB_ID}`));
    expect(job.status).toBe('proof-ready');
  });

  it('throws when job is not found', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    await expect(getJob('nonexistent')).rejects.toThrow('Job not found');
  });
});

describe('getStageProof', () => {
  it('returns the proof payload when available', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_PROOF),
    } as Response);

    const proof = await getStageProof(JOB_ID, 'lock');
    expect(proof).not.toBeNull();
    expect(proof!.stage).toBe('lock');
    expect(proof!.contractMethod).toBe('submitLockProof');
  });

  it('returns null on 404', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const proof = await getStageProof(JOB_ID, 'lock');
    expect(proof).toBeNull();
  });
});

describe('submitReceipt', () => {
  it('POSTs to /jobs/:id/receipts', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...MOCK_JOB, status: 'running', currentStage: 'mint' }),
    } as Response);

    const updated = await submitReceipt(JOB_ID, 'lock', '0xtxhash');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/jobs/${JOB_ID}/receipts`),
      expect.objectContaining({ method: 'POST' })
    );
    expect(updated.currentStage).toBe('mint');
  });
});
