import type { EnrichedStagePayload } from "../../../api/types";
import { buttonClass } from "../../../components/styles";
import { Alert, Card } from "../../../components/ui";
import { stageLabel } from "../../../lib/stages";

interface SubmitStageCardProps {
  payload: EnrichedStagePayload;
  isManualMode: boolean;
  hasWallet: boolean;
  submitting: boolean;
  regenerating: boolean;
  submitError: string | null;
  onSubmit: () => void;
  onRegenerate: () => void;
}

/** Shown once a stage is prepared: signs and submits it from the browser wallet. */
export function SubmitStageCard({
  payload,
  isManualMode,
  hasWallet,
  submitting,
  regenerating,
  submitError,
  onSubmit,
  onRegenerate,
}: SubmitStageCardProps) {
  const isProof = payload.actionKind === "proof";

  return (
    <Card>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
        {isProof ? "Proof ready — submit relay transaction" : "Action ready — submit transaction"}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Stage: <strong>{stageLabel(payload.stage)}</strong>
        {" · "}Chain ID: <strong>{payload.targetChainId}</strong>
        {isProof && payload.verificationMode && (
          <>
            {" · "}Verification:{" "}
            <strong>
              {payload.verificationMode}
              {payload.verificationDegraded ? " (degraded)" : ""}
            </strong>
          </>
        )}
      </p>

      {submitError && (
        <Alert tone="error" role="alert" compact>
          {submitError}
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !hasWallet}
          className={buttonClass("primary")}
        >
          {submitting
            ? "Submitting…"
            : isManualMode
              ? "Submit prepared transaction"
              : "Submit transaction"}
        </button>
        {isProof && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className={buttonClass("outline")}
          >
            {regenerating ? "Regenerating proof…" : "Regenerate proof"}
          </button>
        )}
      </div>

      {!hasWallet && (
        <p className="text-xs text-gray-400">No wallet detected. Install MetaMask to submit.</p>
      )}
    </Card>
  );
}
