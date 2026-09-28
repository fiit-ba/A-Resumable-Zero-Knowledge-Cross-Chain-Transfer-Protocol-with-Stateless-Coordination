import { useState, type FormEvent } from "react";
import { useRecoverJobMutation, useUpdateJobSettingsMutation } from "../../../api/agentApi";
import type { RelayJob, RelayMode } from "../../../api/types";
import { formatUiError } from "../../../lib/errors";

const INPUT_CLASS =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100";

/** Rebuilds a relay job from on-chain evidence using only its txId. */
export function RecoveryPanel({ onRecovered }: { onRecovered: (job: RelayJob) => void }) {
  const [recoverJob, { isLoading: recovering }] = useRecoverJobMutation();
  const [updateJobSettings] = useUpdateJobSettingsMutation();
  const [txId, setTxId] = useState("");
  const [mode, setMode] = useState<RelayMode>("auto");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!txId) {
      setError("txId is required for recovery.");
      return;
    }

    try {
      const recovered = await recoverJob({ txId }).unwrap();
      if (recovered.relayMode !== mode) {
        await updateJobSettings({ jobId: recovered.id, relayMode: mode }).unwrap();
      }
      onRecovered(recovered);
    } catch (err) {
      setError(formatUiError(err));
    }
  }

  return (
    <div className="mb-6 rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Developer recovery</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Recover an existing relay job by txId and jump directly to Progress.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <input
          type="text"
          placeholder="0x txId"
          aria-label="Transaction ID to recover"
          value={txId}
          onChange={(e) => setTxId(e.target.value.trim())}
          className={`md:col-span-2 font-mono ${INPUT_CLASS}`}
        />
        <select
          aria-label="Relay mode for the recovered job"
          value={mode}
          onChange={(e) => setMode(e.target.value as RelayMode)}
          className={INPUT_CLASS}
        >
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
        </select>
        <button
          type="submit"
          disabled={recovering}
          className="rounded-md border border-violet-600 bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recovering ? "Recovering…" : "Recover job"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
