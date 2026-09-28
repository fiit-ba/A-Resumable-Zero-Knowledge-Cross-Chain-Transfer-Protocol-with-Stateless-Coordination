import type { RelayProofStage, StageDetails } from "../../../api/types";
import { CODE_BLOCK_CLASS, MONO_VALUE_CLASS, MUTED_TEXT_CLASS } from "../../../components/styles";
import { Card, InfoRow } from "../../../components/ui";
import { STAGE_LABELS } from "../../../lib/stages";

const SMALL_VALUE_CLASS = "text-xs text-gray-700 dark:text-gray-300";

interface StageDetailsCardProps {
  stage: RelayProofStage;
  details: StageDetails | undefined;
}

/** Shows the checkpointed payload the agent prepared for the selected stage. */
export function StageDetailsCard({ stage, details }: StageDetailsCardProps) {
  const payload = details?.preparedPayload;
  const verificationMode = payload?.verificationMode ?? details?.verificationSummary?.mode;
  const verificationDegraded =
    payload?.verificationDegraded ?? details?.verificationSummary?.degraded;

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Stage details</h2>
      <InfoRow label="Selected stage">
        <span className="text-sm text-gray-700 dark:text-gray-300">{STAGE_LABELS[stage]}</span>
      </InfoRow>
      <InfoRow label="Checkpoint">
        <span className={SMALL_VALUE_CLASS}>{details?.checkpointState ?? "missing"}</span>
      </InfoRow>

      {payload ? (
        <>
          <InfoRow label="Action kind">
            <span className={SMALL_VALUE_CLASS}>{payload.actionKind}</span>
          </InfoRow>
          <InfoRow label="Target chain">
            <span className={`font-mono ${SMALL_VALUE_CLASS}`}>{payload.targetChainId}</span>
          </InfoRow>
          <InfoRow label="Target connector">
            <span className={MONO_VALUE_CLASS}>{payload.targetConnector}</span>
          </InfoRow>
          <InfoRow label="Contract method">
            <span className={`font-mono ${SMALL_VALUE_CLASS}`}>{payload.contractMethod}</span>
          </InfoRow>
          <div className={MUTED_TEXT_CLASS}>
            Contract args:
            <pre className={CODE_BLOCK_CLASS}>{JSON.stringify(payload.contractArgs, null, 2)}</pre>
          </div>
          {verificationMode && (
            <InfoRow label="Verification">
              <span className={SMALL_VALUE_CLASS}>
                {verificationMode}
                {verificationDegraded ? " (degraded)" : ""}
              </span>
            </InfoRow>
          )}
          <details className={MUTED_TEXT_CLASS}>
            <summary className="cursor-pointer select-none">Raw prepared payload</summary>
            <pre className={CODE_BLOCK_CLASS}>{JSON.stringify(payload, null, 2)}</pre>
          </details>
        </>
      ) : (
        <p className={MUTED_TEXT_CLASS}>No prepared payload for this stage yet.</p>
      )}

      {details?.submissionTxHash && (
        <div className={`space-y-1 ${MUTED_TEXT_CLASS}`}>
          <p>
            submissionTxHash:{" "}
            <code className="font-mono break-all">{details.submissionTxHash}</code>
          </p>
          {details.completedAt && (
            <p>Completed: {new Date(details.completedAt).toLocaleString()}</p>
          )}
        </div>
      )}
    </Card>
  );
}
