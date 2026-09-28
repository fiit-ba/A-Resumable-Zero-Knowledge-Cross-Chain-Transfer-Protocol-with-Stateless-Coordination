import { useEffect, useId, useRef, useState } from "react";
import { NETWORK_OPTIONS, NETWORKS, getNetworkKind, type NetworkKind } from "../lib/networks";

const NETWORK_KIND_STYLES: Record<NetworkKind, { label: string; badgeClass: string }> = {
  local: {
    label: "Local",
    badgeClass:
      "border border-emerald-400/50 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  testnet: {
    label: "Testnet",
    badgeClass:
      "border border-sky-400/50 bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  mainnet: {
    label: "Mainnet",
    badgeClass:
      "border border-violet-400/50 bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  },
};

const NETWORK_ICON_STYLES: Record<string, { glyph: string; bgClass: string; ringClass: string }> = {
  "local-anvil": {
    glyph: "AN",
    bgClass: "bg-gradient-to-br from-emerald-400 to-teal-500",
    ringClass: "ring-emerald-300/55 dark:ring-emerald-500/45",
  },
  "local-hardhat": {
    glyph: "HH",
    bgClass: "bg-gradient-to-br from-lime-400 to-emerald-500",
    ringClass: "ring-lime-300/55 dark:ring-lime-500/45",
  },
  sepolia: {
    glyph: "SP",
    bgClass: "bg-gradient-to-br from-sky-400 to-blue-500",
    ringClass: "ring-sky-300/55 dark:ring-sky-500/45",
  },
  holesky: {
    glyph: "HO",
    bgClass: "bg-gradient-to-br from-cyan-400 to-sky-600",
    ringClass: "ring-cyan-300/55 dark:ring-cyan-500/45",
  },
  hoodi: {
    glyph: "HD",
    bgClass: "bg-gradient-to-br from-indigo-400 to-blue-600",
    ringClass: "ring-indigo-300/55 dark:ring-indigo-500/45",
  },
  gnosis: {
    glyph: "GN",
    bgClass: "bg-gradient-to-br from-violet-500 to-purple-600",
    ringClass: "ring-violet-300/55 dark:ring-violet-500/45",
  },
  chiado: {
    glyph: "CH",
    bgClass: "bg-gradient-to-br from-fuchsia-400 to-pink-600",
    ringClass: "ring-fuchsia-300/55 dark:ring-fuchsia-500/45",
  },
};

function NetworkIcon({ profile }: { profile: string }) {
  const icon = NETWORK_ICON_STYLES[profile];
  const glyph = icon?.glyph ?? profile.slice(0, 2).toUpperCase();
  const bgClass = icon?.bgClass ?? "bg-gradient-to-br from-slate-400 to-slate-600";
  const ringClass = icon?.ringClass ?? "ring-slate-300/55 dark:ring-slate-500/45";

  return (
    <span
      aria-hidden
      className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bgClass} ring-1 ${ringClass} shadow-sm`}
    >
      <span className="text-[10px] font-extrabold uppercase tracking-[0.05em] text-white">
        {glyph}
      </span>
    </span>
  );
}

/** Icon, name, profile id, chain id and network kind — shared by the trigger and each option. */
function NetworkSummary({
  profile,
  nameId,
  selected = false,
}: {
  profile: string;
  nameId?: string;
  /** The trigger shows the current choice in a heavier weight than list options. */
  selected?: boolean;
}) {
  const network = NETWORKS[profile];
  const kind = NETWORK_KIND_STYLES[getNetworkKind(profile)];

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <NetworkIcon profile={profile} />
      <span className="min-w-0 flex-1">
        <span
          id={nameId}
          className={`block text-sm ${selected ? "font-semibold" : "font-medium"} leading-5 text-slate-900 dark:text-slate-100`}
        >
          {network?.name ?? profile}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {profile}
          </span>
          <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            chain {network?.chainId ?? "n/a"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${kind.badgeClass}`}
          >
            {kind.label}
          </span>
        </span>
      </span>
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ selected }: { selected: boolean }) {
  return (
    <span
      className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
        selected
          ? "border-sky-500 bg-sky-500 text-white"
          : "border-slate-300 text-transparent dark:border-slate-600"
      }`}
      aria-hidden
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3 w-3"
      >
        <path d="M5.5 10.5L8.5 13.5L14.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

interface NetworkPickerProps {
  idPrefix: string;
  label: string;
  value: string;
  onChange: (profile: string) => void;
  disabled: boolean;
}

/** Accessible combobox for choosing a network profile, with chain metadata inline. */
export function NetworkPicker({ idPrefix, label, value, onChange, disabled }: NetworkPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const labelId = `${idPrefix}-${uid}-label`;
  const valueId = `${idPrefix}-${uid}-value`;
  const listboxId = `${idPrefix}-${uid}-listbox`;

  const selectedProfile = NETWORKS[value] ? value : NETWORK_OPTIONS[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <span id={labelId} className="text-sm text-gray-600 dark:text-gray-400">
        {label}
      </span>

      <button
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className="group relative w-full overflow-hidden rounded-xl border border-slate-300/80 bg-gradient-to-br from-white via-white to-slate-100 px-3.5 py-3 text-left shadow-sm transition hover:border-sky-400/70 hover:shadow-lg hover:shadow-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-55 dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-45 [background:radial-gradient(circle_at_100%_0%,rgba(56,189,248,0.2),transparent_55%)] dark:opacity-80"
        />
        <span className="relative flex items-center gap-2.5">
          <NetworkSummary profile={selectedProfile} nameId={valueId} selected />
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-[0_24px_70px_-26px_rgba(15,23,42,0.65)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
          <ul
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            className="max-h-72 space-y-1 overflow-y-auto p-1"
          >
            {NETWORK_OPTIONS.map((profile) => {
              const isSelected = profile === selectedProfile;
              return (
                <li key={profile}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(profile);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 ${
                      isSelected
                        ? "border-sky-400/60 bg-sky-50/80 dark:border-sky-500/70 dark:bg-sky-500/10"
                        : "border-transparent hover:border-slate-300 hover:bg-slate-100/70 dark:hover:border-slate-700 dark:hover:bg-slate-900/80"
                    }`}
                  >
                    <NetworkSummary profile={profile} />
                    <CheckIcon selected={isSelected} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
