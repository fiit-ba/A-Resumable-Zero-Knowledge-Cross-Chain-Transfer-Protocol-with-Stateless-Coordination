import type { RelayMode } from "../../../api/types";

const MODES: { value: RelayMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
];

interface RelayModeToggleProps {
  mode: RelayMode;
  disabled: boolean;
  onChange: (mode: RelayMode) => void;
}

export function RelayModeToggle({ mode, disabled, onChange }: RelayModeToggleProps) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700">
      {MODES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
          disabled={disabled}
          className={`px-3 py-1.5 text-xs ${
            mode === value
              ? "bg-violet-600 text-white"
              : "bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
