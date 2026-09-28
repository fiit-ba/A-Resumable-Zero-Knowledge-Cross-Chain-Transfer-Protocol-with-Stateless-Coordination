import { decodeContractError } from "./contractErrors";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when a wallet error means the user dismissed the request rather than it failing. */
export function isUserRejection(err: unknown): boolean {
  return /user rejected|rejected by user|action_rejected/i.test(errorMessage(err));
}

/**
 * Best-effort human-readable message for errors from contract calls, wallets,
 * and RTK Query (whose errors are plain `{ status, data: { error } }` objects).
 */
export function formatUiError(err: unknown): string {
  const decoded = decodeContractError(err);
  if (decoded) return decoded;
  if (err instanceof Error) return err.message;

  if (typeof err === "object" && err !== null) {
    const raw = err as { data?: unknown; error?: unknown; status?: unknown };
    const data = raw.data;
    if (typeof data === "object" && data !== null && "error" in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === "string") return message;
    }
    if (typeof raw.error === "string") return raw.error;
    if (raw.status !== undefined) return `Request failed with status ${String(raw.status)}.`;
  }

  return String(err);
}
