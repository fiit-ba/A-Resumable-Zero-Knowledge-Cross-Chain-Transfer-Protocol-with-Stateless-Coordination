import type { ReactNode } from "react";

type AlertTone = "error" | "warning" | "info" | "success" | "pending";

const ALERT_TONES: Record<AlertTone, string> = {
  error:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300",
  warning:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
  info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300",
  success:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-300",
  pending:
    "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
};

interface AlertProps {
  tone: AlertTone;
  /** `alert` for errors needing attention, `status` for progress, `note` for context. */
  role: "alert" | "status" | "note";
  compact?: boolean;
  className?: string;
  children: ReactNode;
}

export function Alert({ tone, role, compact = false, className = "", children }: AlertProps) {
  const size = compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm";
  return (
    <div role={role} className={`rounded-md border ${size} ${ALERT_TONES[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      {children}
    </div>
  );
}

/** A label/value row inside a Card. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </div>
  );
}
