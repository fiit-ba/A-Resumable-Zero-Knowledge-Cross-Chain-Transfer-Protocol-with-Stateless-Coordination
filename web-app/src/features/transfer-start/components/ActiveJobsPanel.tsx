import type { JobStatus, RelayJob } from "../../../api/types";
import { JOB_STATUS_LABELS, stageLabel } from "../../../lib/stages";

const JOB_STATUS_BADGE_CLASSES: Record<JobStatus, string> = {
  awaiting_confirmation:
    "border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300",
  preparing_stage:
    "border border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-300",
  ready_for_signature:
    "border border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300",
  waiting_for_receipt:
    "border border-cyan-300 bg-cyan-100 text-cyan-700 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-300",
  completed:
    "border border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-300",
  failed:
    "border border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300",
  unsupported:
    "border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/50 dark:bg-slate-500/10 dark:text-slate-300",
};

interface ActiveJobsPanelProps {
  jobs: RelayJob[];
  onOpen: (job: RelayJob) => void;
}

/** Lists in-progress or retryable jobs, most recently updated first. */
export function ActiveJobsPanel({ jobs, onOpen }: ActiveJobsPanelProps) {
  return (
    <section className="mb-6 rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Active Jobs</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Reopen any in-progress or retryable relay job.
      </p>
      <div className="mt-3 space-y-2">
        {jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => onOpen(job)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-left transition hover:border-violet-400 hover:bg-violet-50/70 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-950 dark:hover:border-violet-500"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                {job.id}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${JOB_STATUS_BADGE_CLASSES[job.status]}`}
              >
                {JOB_STATUS_LABELS[job.status]}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Stage: {stageLabel(job.currentStage)}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {job.intent.sourceProfile} → {job.intent.destinationProfile}
            </p>
            {job.txId && (
              <p
                className="mt-1 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400"
                title={job.txId}
              >
                {job.txId}
              </p>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
