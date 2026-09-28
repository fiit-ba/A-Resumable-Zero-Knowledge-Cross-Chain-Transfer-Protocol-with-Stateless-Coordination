import { useEffect, useState } from "react";
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
import type {
  EnrichedStagePayload,
  PostSubmitBehavior,
  RelayMode,
  RelayProofStage,
} from "../api/types";
import { PAGE_CLASS, PAGE_TITLE_CLASS, buttonClass } from "../components/styles";
import { Alert, Card, InfoRow } from "../components/ui";
import { JobStatusCard } from "../features/job-progress/components/JobStatusCard";
import { ManualStageControls } from "../features/job-progress/components/ManualStageControls";
import { RelayModeToggle } from "../features/job-progress/components/RelayModeToggle";
import { StageDetailsCard } from "../features/job-progress/components/StageDetailsCard";
import { SubmitStageCard } from "../features/job-progress/components/SubmitStageCard";
import { formatUiError } from "../lib/errors";
import { TX_STATUS } from "../lib/protocolStatus";
import { submitPreparedStage } from "../lib/stageSubmission";
import { REFUND_STAGE_CONTEXT, REFUND_STAGES } from "../lib/stages";

const JOB_POLL_INTERVAL_MS = 3_000;

export function ProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const active = useSelector((s: RootState) => s.jobs.active);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualStage, setManualStage] = useState<RelayProofStage>("lock");

  const {
    data: job,
    error: jobError,
    isLoading: jobLoading,
  } = useGetJobQuery(jobId ?? "", {
    pollingInterval: JOB_POLL_INTERVAL_MS,
    skip: !jobId,
  });

  const [confirmJob, { isLoading: confirming }] = useConfirmJobMutation();
  const [updateJobSettings, { isLoading: savingSettings }] = useUpdateJobSettingsMutation();
  const [refreshJobMutation, { isLoading: refreshingStatus }] = useRefreshJobMutation();
  const [prepareJobStage, { isLoading: preparing }] = usePrepareJobStageMutation();
  const [submitReceipt] = useSubmitReceiptMutation();

  // Auto mode submits the agent's current stage; manual mode submits the selected stage.
  const { data: currentStageDetails } = useGetCurrentStageQuery(jobId ?? "", {
    skip: !jobId || job?.status !== "ready_for_signature",
  });
  const { data: stageDetails } = useGetStageDetailsQuery(
    { jobId: jobId ?? "", stage: manualStage },
    { skip: !jobId || !job || job.relayMode !== "manual" },
  );

  const txId = active?.txId ?? job?.txId ?? "";
  const destConnector = active?.destConnector ?? job?.intent?.destinationConnector ?? "";
  const isManualMode = job?.relayMode === "manual";
  const currentStage = job?.currentStage;
  const differsFromPlanner = (stage: RelayProofStage) =>
    Boolean(job?.plannerAction && job.plannerAction !== stage);
  const plannerMismatch = differsFromPlanner(manualStage);

  useEffect(() => {
    if (currentStage && currentStage !== "pending" && currentStage !== "completed") {
      setManualStage(currentStage);
    }
  }, [currentStage]);

  async function prepareStage(stage: RelayProofStage, regenerate: boolean) {
    if (!jobId) return;
    setSubmitError(null);
    try {
      await prepareJobStage({
        jobId,
        stage,
        force: differsFromPlanner(stage),
        ...(regenerate ? { regenerate: true } : {}),
      }).unwrap();
    } catch (err) {
      setSubmitError(formatUiError(err));
    }
  }

  async function handleRelaySubmit(payload: EnrichedStagePayload) {
    if (!window.ethereum || !jobId) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const txHash = await submitPreparedStage(window.ethereum, payload, txId);
      await submitReceipt({ jobId, stage: payload.stage, txHash }).unwrap();
    } catch (err) {
      setSubmitError(formatUiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const backToForm = (
    <button
      type="button"
      onClick={() => navigate("/")}
      className="text-sm text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-300"
    >
      ← Back to transfer form
    </button>
  );

  if (!jobId) {
    return (
      <div className={`${PAGE_CLASS} space-y-3`}>
        <p className="text-sm text-red-600">No job ID in URL.</p>
        {backToForm}
      </div>
    );
  }

  if (jobLoading) {
    return (
      <div className={PAGE_CLASS}>
        <p className="animate-pulse text-sm text-gray-500">Loading job…</p>
      </div>
    );
  }

  if (jobError || !job) {
    return (
      <div className={`${PAGE_CLASS} space-y-4`}>
        <h1 className={PAGE_TITLE_CLASS}>Transfer in Progress</h1>
        <Alert tone="error" role="alert">
          <strong>Cannot reach local agent.</strong>{" "}
          {jobError && "error" in jobError
            ? String((jobError as { error: unknown }).error)
            : "Unknown error"}
        </Alert>
        {txId && (
          <p className="text-xs text-gray-500">
            txId: <code className="font-mono">{txId}</code>
          </p>
        )}
        <button
          type="button"
          onClick={() => navigate("/")}
          className={buttonClass("secondary", "sm")}
        >
          Start new transfer
        </button>
      </div>
    );
  }

  if (job.status === "completed") {
    return (
      <div className={`${PAGE_CLASS} space-y-4`}>
        <h1 className={PAGE_TITLE_CLASS}>Transfer Complete</h1>
        <Alert tone="success" role="status">
          All relay stages submitted successfully.
        </Alert>
        {job.latestSubmissionTxHash && (
          <p className="text-xs text-gray-500">
            Last relay tx: <code className="font-mono break-all">{job.latestSubmissionTxHash}</code>
          </p>
        )}
        <button type="button" onClick={() => navigate("/")} className={buttonClass("primary")}>
          Start new transfer
        </button>
      </div>
    );
  }

  const canConfirmJob =
    !isManualMode && (job.status === "awaiting_confirmation" || job.status === "failed");
  const refundContext =
    job.currentStage && REFUND_STAGES.has(job.currentStage as RelayProofStage)
      ? (REFUND_STAGE_CONTEXT[job.currentStage as RelayProofStage] ??
        "Follow the steps below to recover your funds.")
      : null;
  // After the mint proof lands the source record is gone, so refunds are no longer possible.
  const ackOnlyRemaining =
    job.sourceStatus === TX_STATUS.NONE &&
    job.destinationStatus === TX_STATUS.MINTED_IN_HOLDING &&
    job.plannerAction === "ack";
  const submitPayload = isManualMode
    ? stageDetails?.preparedPayload
    : currentStageDetails?.preparedPayload;

  return (
    <div className={`${PAGE_CLASS} space-y-5`}>
      <div>
        <h1 className={`${PAGE_TITLE_CLASS} mb-1`}>Transfer in Progress</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Job <code className="font-mono text-xs">{jobId}</code>
        </p>
      </div>

      <Card>
        <InfoRow label="Relay mode">
          <RelayModeToggle
            mode={job.relayMode}
            disabled={savingSettings}
            onChange={(relayMode: RelayMode) => {
              void updateJobSettings({ jobId, relayMode });
            }}
          />
        </InfoRow>
      </Card>

      {refundContext && (
        <Alert tone="warning" role="note">
          <strong>Refund flow active.</strong> {refundContext}
        </Alert>
      )}

      {ackOnlyRemaining && (
        <Alert tone="info" role="note">
          <strong>Note:</strong> The mint proof has already been delivered to the source chain.
          Refund is not available in the current contracts at this stage — complete the{" "}
          <strong>ack</strong> step to release funds.
        </Alert>
      )}

      <JobStatusCard job={job} txId={txId} destConnector={destConnector} />

      {isManualMode && (
        <ManualStageControls
          job={job}
          selectedStage={manualStage}
          plannerMismatch={plannerMismatch}
          refreshing={refreshingStatus}
          preparing={preparing}
          onSelectStage={setManualStage}
          onPostSubmitBehaviorChange={(postSubmitBehavior: PostSubmitBehavior) => {
            void updateJobSettings({ jobId, postSubmitBehavior });
          }}
          onRefresh={() => {
            void refreshJobMutation(jobId);
          }}
          onPrepare={() => {
            void prepareStage(manualStage, false);
          }}
          onRegenerate={(stage) => {
            void prepareStage(stage, true);
          }}
        />
      )}

      {job.status === "failed" && job.lastError && (
        <Alert tone="error" role="alert">
          {job.lastError}
        </Alert>
      )}

      {isManualMode && <StageDetailsCard stage={manualStage} details={stageDetails} />}

      {canConfirmJob && (
        <Card>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {job.status === "awaiting_confirmation"
              ? "Deposit confirmed on-chain. Click below to start proof preparation."
              : "The previous attempt failed. Click below to retry."}
          </p>
          <button
            type="button"
            onClick={() => {
              void confirmJob(jobId);
            }}
            disabled={confirming}
            className={buttonClass("primary")}
          >
            {confirming ? "Confirming…" : "Confirm & start relay"}
          </button>
        </Card>
      )}

      {job.status === "ready_for_signature" && submitPayload && (
        <SubmitStageCard
          payload={submitPayload}
          isManualMode={isManualMode}
          hasWallet={Boolean(window.ethereum)}
          submitting={submitting}
          regenerating={preparing}
          submitError={submitError}
          onSubmit={() => {
            void handleRelaySubmit(submitPayload);
          }}
          onRegenerate={() => {
            void prepareStage(submitPayload.stage, true);
          }}
        />
      )}

      {(job.status === "preparing_stage" || job.status === "waiting_for_receipt") && (
        <p className="animate-pulse text-sm text-gray-500 dark:text-gray-400">
          {job.status === "preparing_stage"
            ? "Preparing, please wait…"
            : "Waiting for on-chain receipt…"}
        </p>
      )}

      {backToForm}
    </div>
  );
}
