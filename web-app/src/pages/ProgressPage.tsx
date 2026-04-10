import { useEffect, useState } from "react";
import { AbiCoder, BrowserProvider, Contract } from "ethers";
import type { Eip1193Provider } from "ethers";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import type { RootState } from "../app/store";
import {
  useGetJobQuery,
  useConfirmJobMutation,
  useGetCurrentStageQuery,
  useGetStageDetailsQuery,
  usePrepareJobStageMutation,
  useRefreshJobMutation,
  useSubmitReceiptMutation,
  useUpdateJobSettingsMutation,
} from "../api/agentApi";
import { CONNECTOR_ABI, ERC20_ABI } from "../lib/abi";
import { assertContractCodePresent, ensureWalletOnChain } from "../lib/wallet";
import type {
  EnrichedStagePayload,
  PostSubmitBehavior,
  RelayMode,
  RelayProofStage,
} from "../api/types";

// ---------------------------------------------------------------------------
// Stage labels
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<RelayProofStage, string> = {
  lock: "1/3 – Lock (destination)",
  mint: "2/3 – Mint (source)",
  ack: "3/3 – Ack (destination)",
  "refund-initiate": "Refund – Initiate (source)",
  "refund-claim": "Refund – Claim proof (destination)",
  "execute-burn": "Refund – Execute burn (destination)",
  "burn-proof": "Refund – Burn proof (source)",
};

const ALL_STAGES: RelayProofStage[] = [
  "lock",
  "mint",
  "ack",
  "refund-initiate",
  "refund-claim",
  "execute-burn",
  "burn-proof",
];

const REFUND_STAGES = new Set<RelayProofStage>([
  "refund-initiate",
  "refund-claim",
  "execute-burn",
  "burn-proof",
]);

const DIRECT_ACTION_STAGES = new Set<RelayProofStage>(["refund-initiate", "execute-burn"]);

const REFUND_STAGE_CONTEXT: Record<string, string> = {
  "refund-initiate":
    "The ACK window has expired. Submit this transaction on the source chain to begin the refund process.",
  "refund-claim": "Refund initiated. Submit the refund-claim proof on the destination chain.",
  "execute-burn": "Refund claim accepted. Execute the burn on the destination chain.",
  "burn-proof": "Burn executed. Submit the burn proof on the source chain to complete the refund.",
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_confirmation: "Awaiting confirmation",
  preparing_stage: "Preparing…",
  ready_for_signature: "Ready for signature",
  waiting_for_receipt: "Waiting for receipt…",
  completed: "Completed",
  failed: "Failed",
  unsupported: "Unsupported",
};

// ---------------------------------------------------------------------------
// RISC Zero route IDs — only for proof stages
// ---------------------------------------------------------------------------

const RISC0_ROUTE_BY_STAGE: Partial<Record<RelayProofStage, number>> = {
  lock: 2,
  mint: 0,
  ack: 3,
  "refund-claim": 4,
  "burn-proof": 1,
};

// ---------------------------------------------------------------------------
// Expected txStatus on the target connector before each stage can be submitted
// ---------------------------------------------------------------------------

const EXPECTED_TX_STATUS_BY_STAGE: Partial<Record<RelayProofStage, number>> = {
  lock: 0, // NONE
  mint: 1, // DEPOSIT_LOCKED
  ack: 4, // MINTED_IN_HOLDING
  "refund-initiate": 1, // DEPOSIT_LOCKED (and deadline must be expired)
  "refund-claim": 4, // MINTED_IN_HOLDING
  "execute-burn": 5, // REFUND_CLAIM_ACCEPTED
  "burn-proof": 3, // REFUND_INITIATED
};

const TX_STATUS_LABELS: Record<number, string> = {
  0: "NONE",
  1: "DEPOSIT_LOCKED",
  2: "MINT_PROOF_ACCEPTED",
  3: "REFUND_INITIATED",
  4: "MINTED_IN_HOLDING",
  5: "REFUND_CLAIM_ACCEPTED",
};

const abiCoder = AbiCoder.defaultAbiCoder();

/**
 * Decodes known connector custom errors from raw revert data so the user
 * sees a readable message instead of "execution reverted (unknown custom error)".
 */
function decodeContractError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: unknown }).data;
  if (typeof data !== "string" || data.length < 10) return null;

  const selector = data.slice(0, 10).toLowerCase();
  const payload = data.slice(10);

  if ((selector === "0x116563d8" || selector === "0xaee908ce") && payload.length >= 128) {
    const deadline = BigInt("0x" + payload.slice(0, 64));
    const currentTime = BigInt("0x" + payload.slice(64, 128));
    const expiredSec = Number(currentTime - deadline);
    return (
      `ACK window expired — the relay deadline passed ${expiredSec}s ago ` +
      `(deadline=${deadline.toString()}, now=${currentTime.toString()}). ` +
      `Refund flow is required.`
    );
  }

  return null;
}

export function ProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const active = useSelector((s: RootState) => s.jobs.active);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualStage, setManualStage] = useState<RelayProofStage>("lock");

  // ── Job polling ────────────────────────────────────────────────────────────
  const {
    data: job,
    error: jobError,
    isLoading: jobLoading,
  } = useGetJobQuery(jobId ?? "", {
    pollingInterval: 3_000,
    skip: !jobId,
  });

  // ── Confirmation ───────────────────────────────────────────────────────────
  const [confirmJob, { isLoading: confirming }] = useConfirmJobMutation();
  const [updateJobSettings, { isLoading: savingSettings }] = useUpdateJobSettingsMutation();
  const [refreshJobMutation, { isLoading: refreshingStatus }] = useRefreshJobMutation();
  const [prepareJobStage, { isLoading: preparingManual }] = usePrepareJobStageMutation();

  // ── Current stage details (used by both auto and manual modes) ────────────
  const { data: currentStageDetails } = useGetCurrentStageQuery(jobId ?? "", {
    skip: !jobId || job?.status !== "ready_for_signature",
  });

  const { data: stageDetails } = useGetStageDetailsQuery(
    { jobId: jobId ?? "", stage: manualStage },
    { skip: !jobId || !job || job.relayMode !== "manual" },
  );

  // ── Receipt ────────────────────────────────────────────────────────────────
  const [submitReceipt] = useSubmitReceiptMutation();

  // ── Helpers ────────────────────────────────────────────────────────────────
  const txId = active?.txId ?? job?.txId ?? "";
  const destConnector = active?.destConnector ?? job?.intent?.destinationConnector ?? "";
  const isManualMode = job?.relayMode === "manual";
  const currentStage = job?.currentStage;
  const plannerMismatch =
    Boolean(job?.plannerAction) && Boolean(job?.plannerAction && job.plannerAction !== manualStage);

  useEffect(() => {
    if (!currentStage) return;
    if (currentStage !== "pending" && currentStage !== "completed") {
      setManualStage(currentStage);
    }
  }, [currentStage]);

  async function handleConfirm() {
    if (!jobId) return;
    await confirmJob(jobId);
  }

  async function handleModeChange(mode: RelayMode) {
    if (!jobId || !job) return;
    await updateJobSettings({ jobId, relayMode: mode }).unwrap();
  }

  async function handlePostSubmitBehaviorChange(behavior: PostSubmitBehavior) {
    if (!jobId || !job) return;
    await updateJobSettings({ jobId, postSubmitBehavior: behavior }).unwrap();
  }

  async function handleRefreshStatus() {
    if (!jobId) return;
    await refreshJobMutation(jobId).unwrap();
  }

  async function handlePrepareSelectedStage() {
    if (!jobId) return;
    await prepareJobStage({
      jobId,
      stage: manualStage,
      force: plannerMismatch,
    }).unwrap();
  }

  async function handleRegenerateProof(stage: RelayProofStage) {
    if (!jobId) return;
    const force = Boolean(job?.plannerAction && job.plannerAction !== stage);
    await prepareJobStage({
      jobId,
      stage,
      force,
      regenerate: true,
    }).unwrap();
  }

  async function handleRelaySubmit(stage: EnrichedStagePayload) {
    if (!window.ethereum) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      await provider.send("eth_requestAccounts", []);
      await ensureWalletOnChain(provider, stage.targetChainId);
      await assertContractCodePresent(provider, stage.targetConnector, stage.targetChainId);
      const readonlyConnector = new Contract(stage.targetConnector, CONNECTOR_ABI, provider);
      const stageTxId = String(stage.contractArgs[stage.actionKind === "direct" ? 0 : 2] ?? txId);

      // ── Status preflight ──────────────────────────────────────────────────
      const expectedStatus = EXPECTED_TX_STATUS_BY_STAGE[stage.stage];
      if (expectedStatus !== undefined) {
        const currentStatus = Number(await readonlyConnector.txStatus(stageTxId));
        if (currentStatus !== expectedStatus) {
          throw new Error(
            `Stage preflight failed: txStatus is ${currentStatus} (${TX_STATUS_LABELS[currentStatus] ?? "UNKNOWN"}) on connector ${stage.targetConnector}, expected ${expectedStatus} (${TX_STATUS_LABELS[expectedStatus]}).`,
          );
        }
      }

      // ── refund-initiate preflight: deadline must have expired ─────────────
      if (stage.stage === "refund-initiate") {
        const sourceTx = (await readonlyConnector.getTx(stageTxId)) as { ackDeadline: bigint };
        const ackDeadline = BigInt(sourceTx.ackDeadline.toString());
        const latestBlock = await provider.getBlock("latest");
        if (!latestBlock) throw new Error("Stage preflight failed: unable to fetch latest block.");
        const chainNow = BigInt(latestBlock.timestamp.toString());
        if (ackDeadline > 0n && chainNow < ackDeadline) {
          throw new Error(
            `Stage preflight failed: ACK window is still active (deadline=${ackDeadline}, now=${chainNow}). ` +
              `Refund is not yet available.`,
          );
        }
      }

      // ── lock/mint/ack deadline check ──────────────────────────────────────
      if (stage.stage === "lock") {
        const originAckDeadline = BigInt(String(stage.contractArgs[9] ?? "0"));
        if (originAckDeadline > 0n) {
          const latestBlock = await provider.getBlock("latest");
          if (!latestBlock)
            throw new Error("Stage preflight failed: unable to fetch latest block.");
          const chainNow = BigInt(latestBlock.timestamp.toString());
          if (chainNow >= originAckDeadline) {
            throw new Error(
              `Stage preflight failed: ACK window expired ` +
                `(deadline=${originAckDeadline}, current=${chainNow}). Refund flow is required.`,
            );
          }
        }
      }

      if (stage.stage === "mint" || stage.stage === "ack") {
        const txSnapshot = (await readonlyConnector.getTx(stageTxId)) as {
          amount: bigint;
          currencyTo: string;
          ackDeadline: bigint;
        };
        const latestBlock = await provider.getBlock("latest");
        if (!latestBlock) throw new Error("Stage preflight failed: unable to fetch latest block.");
        const ackDeadline = BigInt(txSnapshot.ackDeadline.toString());
        const chainNow = BigInt(latestBlock.timestamp.toString());
        if (chainNow >= ackDeadline) {
          throw new Error(
            `Stage preflight failed: ACK window expired. deadline=${ackDeadline}, current=${chainNow}. ` +
              `Refund flow is required.`,
          );
        }

        if (stage.stage === "ack") {
          const payoutToken = String(txSnapshot.currencyTo);
          const payoutAmount = BigInt(txSnapshot.amount.toString());
          const token = new Contract(payoutToken, ERC20_ABI, provider);
          const connectorLiquidity = BigInt(
            (await token.balanceOf(stage.targetConnector)).toString(),
          );
          if (connectorLiquidity < payoutAmount) {
            throw new Error(
              `ACK preflight failed: destination connector ${stage.targetConnector} has insufficient liquidity. ` +
                `Required ${payoutAmount}, balance ${connectorLiquidity} on token ${payoutToken}.`,
            );
          }
        }
      }

      // ── RISC Zero image-id check (proof stages only) ──────────────────────
      if (stage.actionKind === "proof" && stage.proofPayload) {
        const proofTypeRaw = stage.contractArgs[0];
        const proofType = typeof proofTypeRaw === "number" ? proofTypeRaw : Number(proofTypeRaw);
        if (proofType === 0) {
          const decoded = abiCoder.decode(["bytes", "bytes32", "bytes32"], stage.proofPayload);
          const proofImageId = String(decoded[1]);
          const route = RISC0_ROUTE_BY_STAGE[stage.stage];
          if (route !== undefined) {
            const expectedImageId = String(await readonlyConnector.getExpectedRisc0ImageId(route));
            if (proofImageId.toLowerCase() !== expectedImageId.toLowerCase()) {
              throw new Error(
                `RISC0 image-id mismatch for ${stage.stage}: proof has ${proofImageId}, ` +
                  `connector expects ${expectedImageId}. Redeploy connector/adapter with matching image IDs.`,
              );
            }
          }
        }
      }

      // ── Submit transaction ────────────────────────────────────────────────
      const signer = await provider.getSigner();
      const connector = new Contract(stage.targetConnector, CONNECTOR_ABI, signer);
      const fn = connector[stage.contractMethod];
      if (typeof fn !== "function") {
        throw new Error(`Unknown contract method: ${stage.contractMethod}`);
      }

      const relayTx = await (
        fn as (...args: unknown[]) => Promise<{
          wait: () => Promise<{ hash: string } | null>;
        }>
      )(...stage.contractArgs);
      const receipt = await relayTx.wait();
      const txHash = receipt?.hash ?? "";

      await submitReceipt({ jobId: jobId!, stage: stage.stage, txHash }).unwrap();
    } catch (err) {
      const decodedMsg = decodeContractError(err);
      setSubmitError(decodedMsg ?? (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Base classes ───────────────────────────────────────────────────────────
  const card =
    "rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900";
  const rowCls = "flex items-center justify-between gap-4 text-sm";
  const labelCls = "text-gray-500 dark:text-gray-400";
  const valueCls = "font-mono text-xs text-gray-700 dark:text-gray-300 break-all";

  // ── Render: no jobId ───────────────────────────────────────────────────────
  if (!jobId) {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-5">
        <p className="text-sm text-red-600">No job ID in URL.</p>
        <button onClick={() => navigate("/")} className="mt-3 text-sm text-violet-600 underline">
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
          <strong>Cannot reach local agent.</strong>{" "}
          {jobError && "error" in jobError
            ? String((jobError as { error: unknown }).error)
            : "Unknown error"}
        </div>
        {txId && (
          <p className="text-xs text-gray-500">
            txId: <code className="font-mono">{txId}</code>
          </p>
        )}
        <button
          onClick={() => navigate("/")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Start new transfer
        </button>
      </div>
    );
  }

  // ── Render: completed ──────────────────────────────────────────────────────
  if (job.status === "completed") {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-5 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Transfer Complete
        </h1>
        <div
          role="status"
          className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-300"
        >
          All relay stages submitted successfully.
        </div>
        {job.latestSubmissionTxHash && (
          <p className="text-xs text-gray-500">
            Last relay tx: <code className="font-mono break-all">{job.latestSubmissionTxHash}</code>
          </p>
        )}
        <button
          onClick={() => navigate("/")}
          className="rounded-md bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          Start new transfer
        </button>
      </div>
    );
  }

  // ── Render: normal progress (happy path + refund) ──────────────────────────
  const canConfirmJob = !isManualMode && (job.status === "awaiting_confirmation" || job.status === "failed");
  const isRefundStage = job.currentStage && REFUND_STAGES.has(job.currentStage as RelayProofStage);
  const submitPayload = isManualMode ? stageDetails?.preparedPayload : currentStageDetails?.preparedPayload;
  const manualCheckpointState = stageDetails?.checkpointState ?? "missing";
  const selectedManualStageIsProof = !DIRECT_ACTION_STAGES.has(manualStage);

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

      <div className={`${card} space-y-3`}>
        <div className={rowCls}>
          <span className={labelCls}>Relay mode</span>
          <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700">
            <button
              onClick={() => {
                void handleModeChange("auto");
              }}
              disabled={savingSettings}
              className={`px-3 py-1.5 text-xs ${
                job.relayMode === "auto"
                  ? "bg-violet-600 text-white"
                  : "bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              Auto
            </button>
            <button
              onClick={() => {
                void handleModeChange("manual");
              }}
              disabled={savingSettings}
              className={`px-3 py-1.5 text-xs ${
                job.relayMode === "manual"
                  ? "bg-violet-600 text-white"
                  : "bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              Manual
            </button>
          </div>
        </div>
      </div>

      {/* Refund path notice */}
      {isRefundStage && (
        <div
          role="note"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
        >
          <strong>Refund flow active.</strong>{" "}
          {job.currentStage && REFUND_STAGE_CONTEXT[job.currentStage]
            ? REFUND_STAGE_CONTEXT[job.currentStage]
            : "Follow the steps below to recover your funds."}
        </div>
      )}

      {/* Post-mint limitation note */}
      {job.sourceStatus === 2 && job.destinationStatus === 4 && (
        <div
          role="note"
          className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
        >
          <strong>Note:</strong> The mint proof has already been delivered to the source chain.
          Refund is not available in the current contracts at this stage — complete the{" "}
          <strong>ack</strong> step to release funds.
        </div>
      )}

      {/* Status card */}
      <div className={`${card} space-y-3`}>
        <div className={rowCls}>
          <span className={labelCls}>Status</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              job.status === "failed"
                ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                : job.status === "ready_for_signature"
                  ? "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300"
                  : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>

        {job.currentStage && job.currentStage !== "pending" && (
          <div className={rowCls}>
            <span className={labelCls}>Stage</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {STAGE_LABELS[job.currentStage as RelayProofStage] ?? job.currentStage}
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
              {job.verificationSummary.degraded ? " (degraded)" : ""}
            </span>
          </div>
        )}
      </div>

      {isManualMode && (
        <div className={`${card} space-y-3`}>
          <div className={rowCls}>
            <span className={labelCls}>Planner recommendation</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {job.plannerAction ? STAGE_LABELS[job.plannerAction as RelayProofStage] ?? job.plannerAction : "n/a"}
            </span>
          </div>
          {job.plannerReason && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{job.plannerReason}</p>
          )}

          <div className={rowCls}>
            <span className={labelCls}>Source / Destination status</span>
            <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
              {job.sourceStatus} / {job.destinationStatus}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm text-gray-600 dark:text-gray-400">
              Stage
              <select
                value={manualStage}
                onChange={(e) => setManualStage(e.target.value as RelayProofStage)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {ALL_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-400">
              After submit
              <select
                value={job.postSubmitBehavior}
                onChange={(e) => {
                  void handlePostSubmitBehaviorChange(e.target.value as PostSubmitBehavior);
                }}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                <option value="pause">Pause after receipt</option>
                <option value="auto_prepare">Auto-prepare next planner stage</option>
              </select>
            </label>
          </div>

          {plannerMismatch && (
            <div
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
            >
              Selected stage differs from planner recommendation ({job.plannerAction ?? "n/a"}).
              Preparation will use the selected stage.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                void handleRefreshStatus();
              }}
              disabled={refreshingStatus}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {refreshingStatus ? "Refreshing…" : "Refresh status"}
            </button>
            <button
              onClick={() => {
                void handlePrepareSelectedStage();
              }}
              disabled={preparingManual}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {preparingManual ? "Preparing…" : "Prepare selected stage"}
            </button>
            {selectedManualStageIsProof && (
              <button
                onClick={() => {
                  void handleRegenerateProof(manualStage);
                }}
                disabled={preparingManual}
                className="rounded-md border border-violet-300 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/20"
              >
                {preparingManual ? "Regenerating proof…" : "Regenerate proof"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error banner */}
      {job.status === "failed" && job.lastError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {job.lastError}
        </div>
      )}

      {isManualMode && (
        <div className={`${card} space-y-3`}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Stage details</h2>
          <div className={rowCls}>
            <span className={labelCls}>Selected stage</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {STAGE_LABELS[manualStage]}
            </span>
          </div>
          <div className={rowCls}>
            <span className={labelCls}>Checkpoint</span>
            <span className="text-xs text-gray-700 dark:text-gray-300">{manualCheckpointState}</span>
          </div>
          {stageDetails?.preparedPayload ? (
            <>
              <div className={rowCls}>
                <span className={labelCls}>Action kind</span>
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  {stageDetails.preparedPayload.actionKind}
                </span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>Target chain</span>
                <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                  {stageDetails.preparedPayload.targetChainId}
                </span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>Target connector</span>
                <span className={valueCls}>{stageDetails.preparedPayload.targetConnector}</span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>Contract method</span>
                <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                  {stageDetails.preparedPayload.contractMethod}
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Contract args:
                <pre className="mt-1 overflow-auto rounded bg-gray-100 p-2 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {JSON.stringify(stageDetails.preparedPayload.contractArgs, null, 2)}
                </pre>
              </div>
              {(stageDetails.preparedPayload.verificationMode || stageDetails.verificationSummary) && (
                <div className={rowCls}>
                  <span className={labelCls}>Verification</span>
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    {stageDetails.preparedPayload.verificationMode ??
                      stageDetails.verificationSummary?.mode}
                    {(stageDetails.preparedPayload.verificationDegraded ??
                      stageDetails.verificationSummary?.degraded)
                      ? " (degraded)"
                      : ""}
                  </span>
                </div>
              )}
              <details className="text-xs text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer select-none">Raw prepared payload</summary>
                <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {JSON.stringify(stageDetails.preparedPayload, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No prepared payload for this stage yet.
            </p>
          )}
          {stageDetails?.submissionTxHash && (
            <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
              <p>
                submissionTxHash:{" "}
                <code className="font-mono break-all">{stageDetails.submissionTxHash}</code>
              </p>
              {stageDetails.completedAt && <p>Completed: {new Date(stageDetails.completedAt).toLocaleString()}</p>}
            </div>
          )}
        </div>
      )}

      {/* Confirm button */}
      {canConfirmJob && (
        <div className={`${card} space-y-3`}>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {job.status === "awaiting_confirmation"
              ? "Deposit confirmed on-chain. Click below to start proof preparation."
              : "The previous attempt failed. Click below to retry."}
          </p>
          <button
            onClick={() => {
              void handleConfirm();
            }}
            disabled={confirming}
            className="rounded-md bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {confirming ? "Confirming…" : "Confirm & start relay"}
          </button>
        </div>
      )}

      {/* Ready – submit relay tx (proof or direct action) */}
      {job.status === "ready_for_signature" && submitPayload && (
        <div className={`${card} space-y-3`}>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {submitPayload.actionKind === "direct"
              ? "Action ready — submit transaction"
              : "Proof ready — submit relay transaction"}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Stage: <strong>{STAGE_LABELS[submitPayload.stage] ?? submitPayload.stage}</strong>
            {" · "}Chain ID: <strong>{submitPayload.targetChainId}</strong>
            {submitPayload.actionKind === "proof" && submitPayload.verificationMode && (
              <>
                {" · "}Verification:{" "}
                <strong>
                  {submitPayload.verificationMode}
                  {submitPayload.verificationDegraded ? " (degraded)" : ""}
                </strong>
              </>
            )}
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
            onClick={() => {
              void handleRelaySubmit(submitPayload);
            }}
            disabled={submitting || !window.ethereum}
            className="rounded-md bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting
              ? "Submitting…"
              : isManualMode
                ? "Submit prepared transaction"
                : "Submit transaction"}
          </button>
          {submitPayload.actionKind === "proof" && (
            <button
              onClick={() => {
                void handleRegenerateProof(submitPayload.stage);
              }}
              disabled={preparingManual}
              className="rounded-md border border-violet-300 px-5 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/20"
            >
              {preparingManual ? "Regenerating proof…" : "Regenerate proof"}
            </button>
          )}

          {!window.ethereum && (
            <p className="text-xs text-gray-400">No wallet detected. Install MetaMask to submit.</p>
          )}
        </div>
      )}

      {/* Preparing / waiting spinner */}
      {(job.status === "preparing_stage" || job.status === "waiting_for_receipt") && (
        <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">
          {job.status === "preparing_stage"
            ? "Preparing, please wait…"
            : "Waiting for on-chain receipt…"}
        </p>
      )}

      <button
        onClick={() => navigate("/")}
        className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline"
      >
        ← Back to transfer form
      </button>
    </div>
  );
}
