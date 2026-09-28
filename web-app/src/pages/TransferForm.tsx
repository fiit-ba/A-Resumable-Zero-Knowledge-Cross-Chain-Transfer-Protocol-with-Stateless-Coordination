import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "../app/store";
import {
  resetTransfer,
  setDraftField,
  setError,
  setTxStatus,
  type TransferDraft,
} from "../features/transfer-start/transferSlice";
import { activeSessionFromJob, setActiveJob } from "../features/job-progress/jobsSlice";
import { useCreateJobMutation, useGetJobsQuery } from "../api/agentApi";
import type { RelayJob } from "../api/types";
import { NetworkPicker } from "../components/NetworkPicker";
import { FIELD_LABEL_CLASS, PAGE_CLASS, TEXT_INPUT_CLASS, buttonClass } from "../components/styles";
import { Alert } from "../components/ui";
import { ActiveJobsPanel } from "../features/transfer-start/components/ActiveJobsPanel";
import { RecoveryPanel } from "../features/transfer-start/components/RecoveryPanel";
import {
  depositAndLock,
  type AmountMode,
  type PendingTxInfo,
} from "../features/transfer-start/depositAndLock";
import { formatUiError, isUserRejection } from "../lib/errors";
import { getTxExplorerUrl } from "../lib/networks";
import { TERMINAL_JOB_STATUSES } from "../lib/stages";

const JOBS_POLL_INTERVAL_MS = 10_000;

const SUBMIT_LABELS = {
  idle: "Deposit & Lock",
  approving: "Approving token…",
  depositing: "Sending deposit…",
  registering: "Registering job…",
} as const;

type AddressField = "sourceConnector" | "destConnector" | "tokenFrom" | "tokenTo";

const ADDRESS_FIELD_ROWS: [AddressField, string][][] = [
  [
    ["sourceConnector", "Source connector address"],
    ["destConnector", "Destination connector address"],
  ],
  [
    ["tokenFrom", "Token (from) address"],
    ["tokenTo", "Token (to) address"],
  ],
];

const AMOUNT_MODES: { value: AmountMode; label: string; hint: string; placeholder: string }[] = [
  {
    value: "wei",
    label: "Wei",
    hint: "Enter smallest unit (e.g. 1 ETH = 1000000000000000000 wei).",
    placeholder: "1000000000000000000",
  },
  {
    value: "tokens",
    label: "Tokens",
    hint: "Enter token amount (e.g. 100). App converts to wei using token decimals().",
    placeholder: "100",
  },
];

export function TransferForm() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { draft, txStatus, error } = useSelector((s: RootState) => s.transferStart);
  const [createJob] = useCreateJobMutation();
  const { data: jobsData, isError: jobsListError } = useGetJobsQuery(undefined, {
    pollingInterval: JOBS_POLL_INTERVAL_MS,
  });
  const [amountMode, setAmountMode] = useState<AmountMode>("wei");
  const [pendingTx, setPendingTx] = useState<PendingTxInfo | null>(null);

  const busy = txStatus !== "idle";
  const pendingTxUrl = pendingTx ? getTxExplorerUrl(draft.sourceProfile, pendingTx.hash) : null;
  const activeJobs = [...(jobsData ?? [])]
    .filter((job) => !TERMINAL_JOB_STATUSES.has(job.status))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const amountModeConfig = AMOUNT_MODES.find((mode) => mode.value === amountMode)!;

  function updateField(key: keyof TransferDraft, value: string) {
    dispatch(setDraftField({ key, value: value.trim() }));
  }

  function openJob(job: RelayJob) {
    dispatch(setActiveJob(activeSessionFromJob(job)));
    navigate(`/progress/${job.id}`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    dispatch(setError(null));
    setPendingTx(null);

    const missing = (Object.keys(draft) as (keyof TransferDraft)[]).filter((k) => !draft[k]);
    if (missing.length) {
      dispatch(setError(`Please fill in: ${missing.join(", ")}`));
      return;
    }

    if (!window.ethereum) {
      dispatch(setError("No wallet detected. Please install MetaMask or another browser wallet."));
      return;
    }

    try {
      const { txId, amount } = await depositAndLock(window.ethereum, draft, amountMode, {
        onPhase: (phase) => dispatch(setTxStatus(phase)),
        onPendingTx: setPendingTx,
      });

      dispatch(setTxStatus("registering"));
      const job = await createJob({
        txId,
        intent: {
          sourceProfile: draft.sourceProfile,
          destinationProfile: draft.destProfile,
          sourceConnector: draft.sourceConnector,
          destinationConnector: draft.destConnector,
          tokenFrom: draft.tokenFrom,
          tokenTo: draft.tokenTo,
          amount: amount.toString(),
          receiver: draft.receiver,
        },
      }).unwrap();

      dispatch(resetTransfer());
      openJob(job);
    } catch (err) {
      setPendingTx(null);
      dispatch(
        setError(
          isUserRejection(err) ? "Transaction request was rejected in wallet." : formatUiError(err),
        ),
      );
      dispatch(setTxStatus("idle"));
    }
  }

  return (
    <div className={PAGE_CLASS}>
      <h1 className="mb-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        Cross-Chain Transfer
      </h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Fill in the details below, then deposit to start the trustless relay.
      </p>

      <RecoveryPanel onRecovered={openJob} />

      {activeJobs.length > 0 && <ActiveJobsPanel jobs={activeJobs} onOpen={openJob} />}

      {jobsListError && (
        <p className="mb-6 text-xs text-amber-700 dark:text-amber-300">
          Could not refresh active jobs right now. You can still start a new transfer or recover by
          txId.
        </p>
      )}

      {error && (
        <Alert tone="error" role="alert" className="mb-4">
          {error}
        </Alert>
      )}

      {txStatus === "approving" && !pendingTx && (
        <Alert tone="warning" role="status" className="mb-4">
          Waiting for wallet confirmation. Please approve the token transaction in your wallet
          popup.
        </Alert>
      )}

      {pendingTx && (
        <Alert tone="pending" role="status" className="mb-4">
          <p>
            {pendingTx.phase === "approval"
              ? "Approval transaction sent. Waiting for on-chain confirmation…"
              : "Deposit transaction sent. Waiting for on-chain confirmation…"}
          </p>
          <p className="mt-1 break-all font-mono text-xs">{pendingTx.hash}</p>
          {pendingTxUrl && (
            <a
              href={pendingTxUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs font-semibold underline underline-offset-2 hover:opacity-80"
            >
              View transaction on explorer
            </a>
          )}
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <NetworkPicker
            idPrefix="source-network"
            label="Source network"
            value={draft.sourceProfile}
            onChange={(value) => updateField("sourceProfile", value)}
            disabled={busy}
          />
          <NetworkPicker
            idPrefix="destination-network"
            label="Destination network"
            value={draft.destProfile}
            onChange={(value) => updateField("destProfile", value)}
            disabled={busy}
          />
        </div>

        {ADDRESS_FIELD_ROWS.map((row) => (
          <div key={row[0][0]} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {row.map(([key, label]) => (
              <label key={key} className={FIELD_LABEL_CLASS}>
                {label}
                <input
                  type="text"
                  placeholder="0x…"
                  value={draft[key]}
                  onChange={(e) => updateField(key, e.target.value)}
                  disabled={busy}
                  className={TEXT_INPUT_CLASS}
                />
              </label>
            ))}
          </div>
        ))}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className={FIELD_LABEL_CLASS}>
            Amount
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              {AMOUNT_MODES.map(({ value, label }) => (
                <label key={value} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="amount-mode"
                    value={value}
                    checked={amountMode === value}
                    onChange={() => setAmountMode(value)}
                    disabled={busy}
                    className="h-3.5 w-3.5 accent-violet-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            <span className="text-xs text-gray-400">{amountModeConfig.hint}</span>
            <input
              type="text"
              placeholder={amountModeConfig.placeholder}
              value={draft.amount}
              onChange={(e) => updateField("amount", e.target.value)}
              disabled={busy}
              className={TEXT_INPUT_CLASS}
            />
          </label>
          <label className={FIELD_LABEL_CLASS}>
            Receiver address
            <input
              type="text"
              placeholder="0x…"
              value={draft.receiver}
              onChange={(e) => updateField("receiver", e.target.value)}
              disabled={busy}
              className={TEXT_INPUT_CLASS}
            />
          </label>
        </div>

        <button type="submit" disabled={busy} className={`mt-2 ${buttonClass("primary")}`}>
          {SUBMIT_LABELS[txStatus]}
        </button>
      </form>
    </div>
  );
}
