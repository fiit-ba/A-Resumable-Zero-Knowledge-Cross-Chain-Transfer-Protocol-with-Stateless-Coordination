import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { BrowserProvider, Contract, Interface, MaxUint256, parseUnits } from "ethers";
import type { Eip1193Provider } from "ethers";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "../app/store";
import {
  setDraftField,
  setTxStatus,
  setError,
  resetTransfer,
} from "../features/transfer-start/transferSlice";
import { setActiveJob } from "../features/job-progress/jobsSlice";
import { useCreateJobMutation } from "../api/agentApi";
import { CONNECTOR_ABI, ERC20_ABI } from "../lib/abi";
import { NETWORK_OPTIONS, NETWORKS, getChainId } from "../lib/networks";
import { ensureWalletOnChain } from "../lib/wallet";

const TX_STATUS_LABELS = {
  idle: "Deposit & Lock",
  approving: "Approving token…",
  depositing: "Sending deposit…",
  registering: "Registering job…",
} as const;

type AmountMode = "wei" | "tokens";
type NetworkKind = "local" | "testnet" | "mainnet";

interface NetworkPickerProps {
  idPrefix: string;
  label: string;
  value: string;
  onChange: (profile: string) => void;
  disabled: boolean;
}

interface PendingTxInfo {
  phase: "approval" | "deposit";
  hash: string;
}

const TESTNET_PROFILES = new Set(["sepolia", "holesky", "hoodi", "chiado"]);

const NETWORK_KIND_STYLES: Record<
  NetworkKind,
  { label: string; dotClass: string; badgeClass: string }
> = {
  local: {
    label: "Local",
    dotClass: "bg-emerald-500",
    badgeClass:
      "border border-emerald-400/50 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  testnet: {
    label: "Testnet",
    dotClass: "bg-sky-500",
    badgeClass:
      "border border-sky-400/50 bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  mainnet: {
    label: "Mainnet",
    dotClass: "bg-violet-500",
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

function getNetworkKind(profile: string): NetworkKind {
  if (profile.startsWith("local-")) return "local";
  if (TESTNET_PROFILES.has(profile)) return "testnet";
  return "mainnet";
}

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

function getTxExplorerUrl(profile: string, txHash: string): string | null {
  const base = NETWORKS[profile]?.blockExplorerUrls?.[0];
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/tx/${txHash}`;
}

function NetworkPicker({ idPrefix, label, value, onChange, disabled }: NetworkPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const labelId = `${idPrefix}-${uid}-label`;
  const valueId = `${idPrefix}-${uid}-value`;
  const listboxId = `${idPrefix}-${uid}-listbox`;

  const selectedProfile = NETWORKS[value] ? value : NETWORK_OPTIONS[0];
  const selectedNetwork = NETWORKS[selectedProfile];
  const selectedKind = NETWORK_KIND_STYLES[getNetworkKind(selectedProfile)];

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
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <NetworkIcon profile={selectedProfile} />
            <span className="min-w-0 flex-1">
              <span
                id={valueId}
                className="block text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100"
              >
                {selectedNetwork?.name ?? selectedProfile}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedProfile}
                </span>
                <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  chain {selectedNetwork?.chainId ?? "n/a"}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${selectedKind.badgeClass}`}
                >
                  {selectedKind.label}
                </span>
              </span>
            </span>
          </span>

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
              const network = NETWORKS[profile];
              const isSelected = profile === selectedProfile;
              const kind = NETWORK_KIND_STYLES[getNetworkKind(profile)];

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
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">
                      <NetworkIcon profile={profile} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-5 text-slate-900 dark:text-slate-100">
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

                    <span
                      className={`ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        isSelected
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
                        <path
                          d="M5.5 10.5L8.5 13.5L14.5 7.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
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

export function TransferForm() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { draft, txStatus, error } = useSelector((s: RootState) => s.transferStart);
  const [createJob] = useCreateJobMutation();
  const [amountMode, setAmountMode] = useState<AmountMode>("wei");
  const [pendingTx, setPendingTx] = useState<PendingTxInfo | null>(null);

  const busy = txStatus !== "idle";
  const pendingTxUrl = pendingTx ? getTxExplorerUrl(draft.sourceProfile, pendingTx.hash) : null;

  function field(key: keyof typeof draft) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      dispatch(setDraftField({ key, value: e.target.value.trim() }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    dispatch(setError(null));
    setPendingTx(null);

    const missing = (Object.keys(draft) as (keyof typeof draft)[]).filter((k) => !draft[k]);
    if (missing.length) {
      dispatch(setError(`Please fill in: ${missing.join(", ")}`));
      return;
    }

    if (!window.ethereum) {
      dispatch(setError("No wallet detected. Please install MetaMask or another browser wallet."));
      return;
    }

    try {
      const provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      await provider.send("eth_requestAccounts", []);

      const srcChainId = getChainId(draft.sourceProfile);
      if (srcChainId) {
        await ensureWalletOnChain(provider, srcChainId);
      }

      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const token = new Contract(draft.tokenFrom, ERC20_ABI, signer);

      let amountBn: bigint;
      if (amountMode === "wei") {
        try {
          amountBn = BigInt(draft.amount);
        } catch {
          dispatch(setError("Amount must be a valid integer when unit is 'wei'."));
          return;
        }
      } else {
        let tokenDecimals: number;
        try {
          tokenDecimals = Number(await token.decimals());
          if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) {
            throw new Error("Invalid token decimals");
          }
        } catch {
          dispatch(
            setError(
              "Could not read token decimals() from tokenFrom contract. Check the address and network.",
            ),
          );
          return;
        }
        try {
          amountBn = parseUnits(draft.amount, tokenDecimals);
        } catch {
          dispatch(
            setError(
              `Amount must be a valid token number for decimals=${tokenDecimals} (examples: 100, 0.5, 1.234).`,
            ),
          );
          return;
        }
      }
      if (amountBn <= 0n) {
        dispatch(setError("Amount must be greater than 0."));
        return;
      }

      let currentAllowance: bigint;
      try {
        currentAllowance = BigInt(
          await (token.allowance!(signerAddress, draft.sourceConnector) as Promise<bigint>),
        );
      } catch {
        dispatch(
          setError(
            "Could not read token allowance() from tokenFrom contract. Check the address and selected source network.",
          ),
        );
        return;
      }

      if (currentAllowance < amountBn) {
        dispatch(setTxStatus("approving"));
        const approveTx = await (token.approve!(draft.sourceConnector, MaxUint256) as Promise<{
          hash: string;
          wait: () => Promise<unknown>;
        }>);
        setPendingTx({ phase: "approval", hash: approveTx.hash });
        await approveTx.wait();
      }

      dispatch(setTxStatus("depositing"));
      const connector = new Contract(draft.sourceConnector, CONNECTOR_ABI, signer);
      const depositTx = await (connector.depositAndLock!(
        draft.tokenFrom,
        draft.tokenTo,
        draft.receiver,
        amountBn,
        draft.destConnector,
      ) as Promise<{
        hash: string;
        wait: () => Promise<{ logs: { topics: readonly string[]; data: string }[] } | null>;
      }>);
      setPendingTx({ phase: "deposit", hash: depositTx.hash });

      const receipt = await depositTx.wait();
      if (!receipt) throw new Error("No transaction receipt returned");
      setPendingTx(null);

      const iface = new Interface(CONNECTOR_ABI);
      let txId: string | undefined;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "DepositLocked") {
            txId = parsed.args[0] as string;
            break;
          }
        } catch {
          // Not a matching log
        }
      }
      if (!txId) throw new Error("DepositLocked event not found in receipt");

      dispatch(setTxStatus("registering"));
      const intent = {
        sourceProfile: draft.sourceProfile,
        destinationProfile: draft.destProfile,
        sourceConnector: draft.sourceConnector,
        destinationConnector: draft.destConnector,
        tokenFrom: draft.tokenFrom,
        tokenTo: draft.tokenTo,
        amount: amountBn.toString(),
        receiver: draft.receiver,
      };
      const job = await createJob({ txId, intent }).unwrap();

      dispatch(
        setActiveJob({
          jobId: job.id,
          txId,
          sourceProfile: draft.sourceProfile,
          destProfile: draft.destProfile,
          sourceConnector: draft.sourceConnector,
          destConnector: draft.destConnector,
        }),
      );
      dispatch(resetTransfer());
      navigate(`/progress/${job.id}`);
    } catch (err) {
      setPendingTx(null);
      const message = err instanceof Error ? err.message : String(err);
      if (/user rejected|rejected by user|action_rejected/i.test(message)) {
        dispatch(setError("Transaction request was rejected in wallet."));
      } else {
        dispatch(setError(message));
      }
      dispatch(setTxStatus("idle"));
    }
  }

  return (
    <div className="max-w-2xl mx-auto mt-10 px-5">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-1">
        Cross-Chain Transfer
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Fill in the details below, then deposit to start the trustless relay.
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {txStatus === "approving" && !pendingTx && (
        <div
          role="status"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
        >
          Waiting for wallet confirmation. Please approve the token transaction in your wallet
          popup.
        </div>
      )}

      {pendingTx && (
        <div
          role="status"
          className="mb-4 rounded-md border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200"
        >
          <p>
            {pendingTx.phase === "approval"
              ? "Approval transaction sent. Waiting for on-chain confirmation…"
              : "Deposit transaction sent. Waiting for on-chain confirmation…"}
          </p>
          <p className="mt-1 font-mono text-xs break-all">{pendingTx.hash}</p>
          {pendingTxUrl && (
            <a
              href={pendingTxUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs font-semibold underline underline-offset-2 hover:opacity-80"
            >
              View transaction on explorer
            </a>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Network row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <NetworkPicker
            idPrefix="source-network"
            label="Source network"
            value={draft.sourceProfile}
            onChange={(value) => dispatch(setDraftField({ key: "sourceProfile", value }))}
            disabled={busy}
          />
          <NetworkPicker
            idPrefix="destination-network"
            label="Destination network"
            value={draft.destProfile}
            onChange={(value) => dispatch(setDraftField({ key: "destProfile", value }))}
            disabled={busy}
          />
        </div>

        {/* Connector row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(
            [
              ["sourceConnector", "Source connector address"],
              ["destConnector", "Destination connector address"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400"
            >
              {label}
              <input
                type="text"
                placeholder="0x…"
                value={draft[key]}
                onChange={field(key)}
                disabled={busy}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          ))}
        </div>

        {/* Token row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(
            [
              ["tokenFrom", "Token (from) address"],
              ["tokenTo", "Token (to) address"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400"
            >
              {label}
              <input
                type="text"
                placeholder="0x…"
                value={draft[key]}
                onChange={field(key)}
                disabled={busy}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          ))}
        </div>

        {/* Amount / Receiver row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            Amount
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="amount-mode"
                  value="wei"
                  checked={amountMode === "wei"}
                  onChange={() => setAmountMode("wei")}
                  disabled={busy}
                  className="h-3.5 w-3.5 accent-violet-600"
                />
                Wei
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="amount-mode"
                  value="tokens"
                  checked={amountMode === "tokens"}
                  onChange={() => setAmountMode("tokens")}
                  disabled={busy}
                  className="h-3.5 w-3.5 accent-violet-600"
                />
                Tokens
              </label>
            </div>
            <span className="text-xs text-gray-400">
              {amountMode === "wei"
                ? "Enter smallest unit (e.g. 1 ETH = 1000000000000000000 wei)."
                : "Enter token amount (e.g. 100). App converts to wei using token decimals()."}
            </span>
            <input
              type="text"
              placeholder={amountMode === "wei" ? "1000000000000000000" : "100"}
              value={draft.amount}
              onChange={field("amount")}
              disabled={busy}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            Receiver address
            <input
              type="text"
              placeholder="0x…"
              value={draft.receiver}
              onChange={field("receiver")}
              disabled={busy}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded-md bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {TX_STATUS_LABELS[txStatus as keyof typeof TX_STATUS_LABELS]}
        </button>
      </form>
    </div>
  );
}
