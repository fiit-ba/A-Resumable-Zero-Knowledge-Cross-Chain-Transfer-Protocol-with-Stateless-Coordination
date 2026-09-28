import type { JobStatus, RelayJob } from "../../../api/types";
import { MONO_VALUE_CLASS } from "../../../components/styles";
import { Card, InfoRow } from "../../../components/ui";
import { JOB_STATUS_LABELS, stageLabel } from "../../../lib/stages";

function statusBadgeClass(status: JobStatus): string {
  if (status === "failed") return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
  if (status === "ready_for_signature") {
    return "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300";
  }
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

interface JobStatusCardProps {
  job: RelayJob;
  txId: string;
  destConnector: string;
}

export function JobStatusCard({ job, txId, destConnector }: JobStatusCardProps) {
  return (
    <Card>
      <InfoRow label="Status">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(job.status)}`}
        >
          {JOB_STATUS_LABELS[job.status] ?? job.status}
        </span>
      </InfoRow>

      {job.currentStage && job.currentStage !== "pending" && (
        <InfoRow label="Stage">
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {stageLabel(job.currentStage)}
          </span>
        </InfoRow>
      )}

      <InfoRow label="txId">
        <span className={MONO_VALUE_CLASS}>{txId}</span>
      </InfoRow>

      {destConnector && (
        <InfoRow label="Dest connector">
          <span className={MONO_VALUE_CLASS}>{destConnector}</span>
        </InfoRow>
      )}

      {job.verificationSummary && (
        <InfoRow label="Verification">
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {job.verificationSummary.mode}
            {job.verificationSummary.degraded ? " (degraded)" : ""}
          </span>
        </InfoRow>
      )}
    </Card>
  );
}
