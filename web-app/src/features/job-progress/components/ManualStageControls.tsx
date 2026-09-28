import type { PostSubmitBehavior, RelayJob, RelayProofStage } from "../../../api/types";
import { SELECT_CLASS, buttonClass } from "../../../components/styles";
import { Alert, Card, InfoRow } from "../../../components/ui";
import { ALL_STAGES, DIRECT_ACTION_STAGES, STAGE_LABELS, stageLabel } from "../../../lib/stages";

interface ManualStageControlsProps {
  job: RelayJob;
  selectedStage: RelayProofStage;
  plannerMismatch: boolean;
  refreshing: boolean;
  preparing: boolean;
  onSelectStage: (stage: RelayProofStage) => void;
  onPostSubmitBehaviorChange: (behavior: PostSubmitBehavior) => void;
  onRefresh: () => void;
  onPrepare: () => void;
  onRegenerate: (stage: RelayProofStage) => void;
}

/** Manual-mode panel: pick any stage, compare it with the planner, and prepare it. */
export function ManualStageControls({
  job,
  selectedStage,
  plannerMismatch,
  refreshing,
  preparing,
  onSelectStage,
  onPostSubmitBehaviorChange,
  onRefresh,
  onPrepare,
  onRegenerate,
}: ManualStageControlsProps) {
  return (
    <Card>
      <InfoRow label="Planner recommendation">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {stageLabel(job.plannerAction)}
        </span>
      </InfoRow>
      {job.plannerReason && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{job.plannerReason}</p>
      )}

      <InfoRow label="Source / Destination status">
        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
          {job.sourceStatus} / {job.destinationStatus}
        </span>
      </InfoRow>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-sm text-gray-600 dark:text-gray-400">
          Stage
          <select
            value={selectedStage}
            onChange={(e) => onSelectStage(e.target.value as RelayProofStage)}
            className={SELECT_CLASS}
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
            onChange={(e) => onPostSubmitBehaviorChange(e.target.value as PostSubmitBehavior)}
            className={SELECT_CLASS}
          >
            <option value="pause">Pause after receipt</option>
            <option value="auto_prepare">Auto-prepare next planner stage</option>
          </select>
        </label>
      </div>

      {plannerMismatch && (
        <Alert tone="warning" role="alert" compact>
          Selected stage differs from planner recommendation ({job.plannerAction ?? "n/a"}).
          Preparation will use the selected stage.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className={buttonClass("secondary", "sm")}
        >
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
        <button
          type="button"
          onClick={onPrepare}
          disabled={preparing}
          className={buttonClass("primary", "sm")}
        >
          {preparing ? "Preparing…" : "Prepare selected stage"}
        </button>
        {!DIRECT_ACTION_STAGES.has(selectedStage) && (
          <button
            type="button"
            onClick={() => onRegenerate(selectedStage)}
            disabled={preparing}
            className={buttonClass("outline", "sm")}
          >
            {preparing ? "Regenerating proof…" : "Regenerate proof"}
          </button>
        )}
      </div>
    </Card>
  );
}
