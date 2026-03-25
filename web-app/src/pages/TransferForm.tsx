import { useState, type ChangeEvent, type FormEvent } from 'react';
import { BrowserProvider, Contract, Interface, parseUnits } from 'ethers';
import type { Eip1193Provider } from 'ethers';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../app/store';
import {
  setDraftField,
  setTxStatus,
  setError,
  resetTransfer,
} from '../features/transfer-start/transferSlice';
import { setActiveJob } from '../features/job-progress/jobsSlice';
import { useCreateJobMutation } from '../shared/api/agentApi';
import { CONNECTOR_ABI, ERC20_ABI } from '../lib/abi';
import { NETWORK_OPTIONS, getChainId } from '../lib/networks';
import { ensureWalletOnChain } from '../lib/wallet';

const TX_STATUS_LABELS = {
  idle: 'Deposit & Lock',
  approving: 'Approving token…',
  depositing: 'Sending deposit…',
  registering: 'Registering job…',
} as const;

type AmountMode = 'wei' | 'tokens';

export function TransferForm() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { draft, txStatus, error } = useSelector(
    (s: RootState) => s.transferStart
  );
  const [createJob] = useCreateJobMutation();
  const [amountMode, setAmountMode] = useState<AmountMode>('wei');

  const busy = txStatus !== 'idle';

  function field(key: keyof typeof draft) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      dispatch(setDraftField({ key, value: e.target.value.trim() }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    dispatch(setError(null));

    const missing = (Object.keys(draft) as (keyof typeof draft)[]).filter(
      (k) => !draft[k]
    );
    if (missing.length) {
      dispatch(setError(`Please fill in: ${missing.join(', ')}`));
      return;
    }

    if (!window.ethereum) {
      dispatch(
        setError(
          'No wallet detected. Please install MetaMask or another browser wallet.'
        )
      );
      return;
    }

    try {
      const provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      await provider.send('eth_requestAccounts', []);

      const srcChainId = getChainId(draft.sourceProfile);
      if (srcChainId) {
        await ensureWalletOnChain(provider, srcChainId);
      }

      const signer = await provider.getSigner();
      const token = new Contract(draft.tokenFrom, ERC20_ABI, signer);

      let amountBn: bigint;
      if (amountMode === 'wei') {
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
            throw new Error('Invalid token decimals');
          }
        } catch {
          dispatch(
            setError('Could not read token decimals() from tokenFrom contract. Check the address and network.')
          );
          return;
        }
        try {
          amountBn = parseUnits(draft.amount, tokenDecimals);
        } catch {
          dispatch(
            setError(
              `Amount must be a valid token number for decimals=${tokenDecimals} (examples: 100, 0.5, 1.234).`
            )
          );
          return;
        }
      }
      if (amountBn <= 0n) {
        dispatch(setError('Amount must be greater than 0.'));
        return;
      }

      dispatch(setTxStatus('approving'));
      const approveTx = await (token.approve!(draft.sourceConnector, amountBn) as Promise<{ wait: () => Promise<unknown> }>);
      await approveTx.wait();

      dispatch(setTxStatus('depositing'));
      const connector = new Contract(draft.sourceConnector, CONNECTOR_ABI, signer);
      const depositTx = await (connector.depositAndLock!(
        draft.tokenFrom,
        draft.tokenTo,
        draft.receiver,
        amountBn,
        draft.destConnector
      ) as Promise<{ wait: () => Promise<{ logs: { topics: readonly string[]; data: string }[] } | null> }>);

      const receipt = await depositTx.wait();
      if (!receipt) throw new Error('No transaction receipt returned');

      const iface = new Interface(CONNECTOR_ABI);
      let txId: string | undefined;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'DepositLocked') {
            txId = parsed.args[0] as string;
            break;
          }
        } catch {
          // Not a matching log
        }
      }
      if (!txId) throw new Error('DepositLocked event not found in receipt');

      dispatch(setTxStatus('registering'));
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
        })
      );
      dispatch(resetTransfer());
      navigate(`/progress/${job.id}`);
    } catch (err) {
      dispatch(setError(err instanceof Error ? err.message : String(err)));
      dispatch(setTxStatus('idle'));
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

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Network row */}
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            Source network
            <select
              value={draft.sourceProfile}
              onChange={field('sourceProfile')}
              disabled={busy}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              {NETWORK_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            Destination network
            <select
              value={draft.destProfile}
              onChange={field('destProfile')}
              disabled={busy}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              {NETWORK_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Connector row */}
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ['sourceConnector', 'Source connector address'],
              ['destConnector', 'Destination connector address'],
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
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ['tokenFrom', 'Token (from) address'],
              ['tokenTo', 'Token (to) address'],
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
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            Amount
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="amount-mode"
                  value="wei"
                  checked={amountMode === 'wei'}
                  onChange={() => setAmountMode('wei')}
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
                  checked={amountMode === 'tokens'}
                  onChange={() => setAmountMode('tokens')}
                  disabled={busy}
                  className="h-3.5 w-3.5 accent-violet-600"
                />
                Tokens
              </label>
            </div>
            <span className="text-xs text-gray-400">
              {amountMode === 'wei'
                ? 'Enter smallest unit (e.g. 1 ETH = 1000000000000000000 wei).'
                : 'Enter token amount (e.g. 100). App converts to wei using token decimals().'}
            </span>
            <input
              type="text"
              placeholder={amountMode === 'wei' ? '1000000000000000000' : '100'}
              value={draft.amount}
              onChange={field('amount')}
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
              onChange={field('receiver')}
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
