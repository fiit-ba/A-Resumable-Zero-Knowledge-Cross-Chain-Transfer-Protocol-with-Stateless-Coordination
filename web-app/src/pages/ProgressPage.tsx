import { useState } from 'react';
import { AbiCoder, BrowserProvider, Contract } from 'ethers';
import type { Eip1193Provider } from 'ethers';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '../app/store';
import {
  useGetJobQuery,
  useConfirmJobMutation,
  useGetNextStageQuery,
  useSubmitReceiptMutation,
} from '../shared/api/agentApi';
import { CONNECTOR_ABI, ERC20_ABI } from '../lib/abi';
import { assertContractCodePresent, ensureWalletOnChain } from '../lib/wallet';
import type { EnrichedStagePayload } from 'agent-shared';

const STAGE_LABELS: Record<string, string> = {
  lock: '1/3 – Lock (destination)',
  mint: '2/3 – Mint (source)',
  ack:  '3/3 – Ack (destination)',
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_confirmation: 'Awaiting confirmation',
  preparing_stage:       'Preparing proof…',
  ready_for_signature:   'Ready for signature',
  waiting_for_receipt:   'Waiting for receipt…',
  completed:             'Completed',
  failed:                'Failed',
  unsupported:           'Unsupported (refund path)',
};

const RISC0_ROUTE_BY_STAGE: Record<EnrichedStagePayload['stage'], number> = {
  lock: 2,
  mint: 0,
  ack: 3
};

const EXPECTED_TX_STATUS_BY_STAGE: Record<EnrichedStagePayload['stage'], number> = {
  lock: 0, // NONE
  mint: 1, // DEPOSIT_LOCKED
  ack: 4 // MINTED_IN_HOLDING
};

const TX_STATUS_LABELS: Record<number, string> = {
  0: 'NONE',
  1: 'DEPOSIT_LOCKED',
  2: 'MINT_PROOF_ACCEPTED',
  3: 'REFUND_INITIATED',
  4: 'MINTED_IN_HOLDING',
  5: 'REFUND_CLAIM_ACCEPTED'
};

const abiCoder = AbiCoder.defaultAbiCoder();

export function ProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const active = useSelector((s: RootState) => s.jobs.active);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Job polling ────────────────────────────────────────────────────────────
  const {
    data: job,
    error: jobError,
    isLoading: jobLoading,
  } = useGetJobQuery(jobId ?? '', {
    pollingInterval: 3_000,
    skip: !jobId,
  });

  // ── Confirmation ───────────────────────────────────────────────────────────
  const [confirmJob, { isLoading: confirming }] = useConfirmJobMutation();

  // ── Next stage (only when ready_for_signature) ─────────────────────────────
  const { data: nextStage } = useGetNextStageQuery(jobId ?? '', {
    skip: !jobId || job?.status !== 'ready_for_signature',
  });

  // ── Receipt ────────────────────────────────────────────────────────────────
  const [submitReceipt] = useSubmitReceiptMutation();

  // ── Helpers ────────────────────────────────────────────────────────────────
  const txId = active?.txId ?? job?.txId ?? '';
  const destConnector = active?.destConnector ?? job?.intent?.destinationConnector ?? '';

  async function handleConfirm() {
    if (!jobId) return;
    await confirmJob(jobId);
  }

  async function handleRelaySubmit(stage: EnrichedStagePayload) {
    if (!window.ethereum) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      await provider.send('eth_requestAccounts', []);
      await ensureWalletOnChain(provider, stage.targetChainId);
      await assertContractCodePresent(provider, stage.targetConnector, stage.targetChainId);
      const readonlyConnector = new Contract(stage.targetConnector, CONNECTOR_ABI, provider);
      const stageTxId = String(stage.contractArgs[2] ?? txId);

      const expectedStatus = EXPECTED_TX_STATUS_BY_STAGE[stage.stage];
      const currentStatus = Number(await readonlyConnector.txStatus(stageTxId));
      if (currentStatus !== expectedStatus) {
        throw new Error(
          `Stage preflight failed: txStatus is ${currentStatus} (${TX_STATUS_LABELS[currentStatus] ?? 'UNKNOWN'}) on connector ${stage.targetConnector}, expected ${expectedStatus} (${TX_STATUS_LABELS[expectedStatus]}).`
        );
      }

      if (stage.stage === 'ack') {
        const txSnapshot = await readonlyConnector.getTx(stageTxId) as {
          amount: bigint;
          currencyTo: string;
        };
        const payoutToken = String(txSnapshot.currencyTo);
        const payoutAmount = BigInt(txSnapshot.amount.toString());
        const token = new Contract(payoutToken, ERC20_ABI, provider);
        const connectorLiquidity = BigInt((await token.balanceOf(stage.targetConnector)).toString());

        if (connectorLiquidity < payoutAmount) {
          throw new Error(
            `ACK preflight failed: destination connector ${stage.targetConnector} has insufficient token liquidity. Required ${payoutAmount.toString()}, balance ${connectorLiquidity.toString()} on token ${payoutToken}. Mint destination tokens to the connector, not to the user wallet.`
          );
        }
      }

      const proofTypeRaw = stage.contractArgs[0];
      const proofType = typeof proofTypeRaw === 'number' ? proofTypeRaw : Number(proofTypeRaw);
      if (proofType === 0) {
        const decoded = abiCoder.decode(['bytes', 'bytes32', 'bytes32'], stage.proofPayload);
        const proofImageId = String(decoded[1]);
        const expectedImageId = String(
          await readonlyConnector.getExpectedRisc0ImageId(
            RISC0_ROUTE_BY_STAGE[stage.stage]
          )
        );
        if (proofImageId.toLowerCase() !== expectedImageId.toLowerCase()) {
          throw new Error(
            `RISC0 image-id mismatch for ${stage.stage}: proof has ${proofImageId}, connector expects ${expectedImageId}. Redeploy connector/adapter with matching image IDs.`
          );
        }
      }

      const signer = await provider.getSigner();
      const connector = new Contract(stage.targetConnector, CONNECTOR_ABI, signer);
      const fn = connector[stage.contractMethod];
      if (typeof fn !== 'function') {
        throw new Error(`Unknown contract method: ${stage.contractMethod}`);
      }

      const relayTx = await (fn as (...args: unknown[]) => Promise<{
        wait: () => Promise<{ hash: string } | null>;
      }>)(...stage.contractArgs);
      const receipt = await relayTx.wait();
      const txHash = receipt?.hash ?? '';

      await submitReceipt({ jobId: jobId!, stage: stage.stage, txHash }).unwrap();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Base classes ───────────────────────────────────────────────────────────
  const card = 'rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
  const rowCls = 'flex items-center justify-between gap-4 text-sm';
  const labelCls = 'text-gray-500 dark:text-gray-400';
  const valueCls = 'font-mono text-xs text-gray-700 dark:text-gray-300 break-all';

  // ── Render: no jobId ───────────────────────────────────────────────────────
  if (!jobId) {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-5">
        <p className="text-sm text-red-600">No job ID in URL.</p>
        <button
          onClick={() => navigate('/')}
          className="mt-3 text-sm text-violet-600 underline"
        >
          Back to transfer form
        </button>
      </div>
    );
  }

  // ── Render: loading ────────────────────────────────────────────────────────
  if (jobLoading) {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-5">
        <p className="text-sm text-gray-500 animate-pulse">Loading job…</p>
      </div>
    );
  }

  // ── Render: agent unreachable ──────────────────────────────────────────────
  if (jobError || !job) {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-5 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Transfer in Progress
        </h1>
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
        >
          <strong>Cannot reach local agent.</strong>{' '}
          {jobError && 'error' in jobError ? String((jobError as { error: unknown }).error) : 'Unknown error'}
        </div>
        {txId && (
          <p className="text-xs text-gray-500">
            txId: <code className="font-mono">{txId}</code>
          </p>
        )}
        <button
          onClick={() => navigate('/')}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Start new transfer
        </button>
      </div>
    );
  }

  // ── Render: unsupported (refund path) ──────────────────────────────────────
  if (job.status === 'unsupported') {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-5 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Transfer in Progress
        </h1>
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
        >
          <strong>Refund state detected.</strong>{' '}
          {job.lastError ?? 'Manual recovery is required. Please contact support.'}
        </div>
        <p className="text-xs text-gray-500">
          txId: <code className="font-mono">{txId}</code>
        </p>
        <button
          onClick={() => navigate('/')}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Start new transfer
        </button>
      </div>
    );
  }

  // ── Render: completed ──────────────────────────────────────────────────────
  if (job.status === 'completed') {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-5 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Transfer Complete
        </h1>
        <div
          role="status"
          className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-300"
        >
          All three relay stages (lock → mint → ack) submitted successfully.
        </div>
        {job.latestSubmissionTxHash && (
          <p className="text-xs text-gray-500">
            Last relay tx:{' '}
            <code className="font-mono break-all">{job.latestSubmissionTxHash}</code>
          </p>
        )}
        <button
          onClick={() => navigate('/')}
          className="rounded-md bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          Start new transfer
        </button>
      </div>
    );
  }

  // ── Render: normal progress ────────────────────────────────────────────────
  const canConfirm =
    job.status === 'awaiting_confirmation' || job.status === 'failed';

  return (
    <div className="max-w-2xl mx-auto mt-10 px-5 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Transfer in Progress
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Job <code className="font-mono text-xs">{jobId}</code>
        </p>
      </div>

      {/* Status card */}
      <div className={`${card} space-y-3`}>
        <div className={rowCls}>
          <span className={labelCls}>Status</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              job.status === 'failed'
                ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                : job.status === 'ready_for_signature'
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>

        {job.currentStage && job.currentStage !== 'pending' && (
          <div className={rowCls}>
            <span className={labelCls}>Stage</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {STAGE_LABELS[job.currentStage] ?? job.currentStage}
            </span>
          </div>
        )}

        <div className={rowCls}>
          <span className={labelCls}>txId</span>
          <span className={valueCls}>{txId}</span>
        </div>

        {destConnector && (
          <div className={rowCls}>
            <span className={labelCls}>Dest connector</span>
            <span className={valueCls}>{destConnector}</span>
          </div>
        )}

        {job.verificationSummary && (
          <div className={rowCls}>
            <span className={labelCls}>Verification</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {job.verificationSummary.mode}
              {job.verificationSummary.degraded ? ' (degraded)' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Error banner */}
      {job.status === 'failed' && job.lastError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {job.lastError}
        </div>
      )}

      {/* Confirm button */}
      {canConfirm && (
        <div className={`${card} space-y-3`}>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {job.status === 'awaiting_confirmation'
              ? 'Deposit confirmed on-chain. Click below to start proof preparation.'
              : 'The previous attempt failed. Click below to retry.'}
          </p>
          <button
            onClick={() => { void handleConfirm(); }}
            disabled={confirming}
            className="rounded-md bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {confirming ? 'Confirming…' : 'Confirm & start relay'}
          </button>
        </div>
      )}

      {/* Proof ready – submit relay tx */}
      {job.status === 'ready_for_signature' && nextStage && (
        <div className={`${card} space-y-3`}>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
            Proof ready — submit relay transaction
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Stage:{' '}
            <strong>{STAGE_LABELS[nextStage.stage] ?? nextStage.stage}</strong>
            {' · '}Chain ID: <strong>{nextStage.targetChainId}</strong>
            {' · '}Verification:{' '}
            <strong>
              {nextStage.verificationMode}
              {nextStage.verificationDegraded ? ' (degraded)' : ''}
            </strong>
          </p>

          {submitError && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {submitError}
            </div>
          )}

          <button
            onClick={() => { void handleRelaySubmit(nextStage); }}
            disabled={submitting || !window.ethereum}
            className="rounded-md bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit relay transaction'}
          </button>

          {!window.ethereum && (
            <p className="text-xs text-gray-400">
              No wallet detected. Install MetaMask to submit.
            </p>
          )}
        </div>
      )}

      {/* Preparing / waiting spinner */}
      {(job.status === 'preparing_stage' || job.status === 'waiting_for_receipt') && (
        <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">
          {job.status === 'preparing_stage'
            ? 'Preparing proof, please wait…'
            : 'Waiting for on-chain receipt…'}
        </p>
      )}

      <button
        onClick={() => navigate('/')}
        className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline"
      >
        ← Back to transfer form
      </button>
    </div>
  );
}
