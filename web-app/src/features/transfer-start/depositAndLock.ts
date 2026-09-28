import { BrowserProvider, Contract, Interface, MaxUint256, parseUnits } from "ethers";
import type { Eip1193Provider } from "ethers";
import { CONNECTOR_ABI, ERC20_ABI } from "../../lib/abi";
import { logConnectorGasEstimate, logConnectorGasReceipt } from "../../lib/connectorGasLog";
import type { ConnectorContractMethodLike, ConnectorReceiptLike } from "../../lib/connectorGasLog";
import { NETWORKS, getChainId } from "../../lib/networks";
import { ensureWalletOnChain } from "../../lib/wallet";
import type { TransferDraft } from "./transferSlice";

export type AmountMode = "wei" | "tokens";

export interface PendingTxInfo {
  phase: "approval" | "deposit";
  hash: string;
}

export interface DepositProgress {
  onPhase: (phase: "approving" | "depositing") => void;
  onPendingTx: (tx: PendingTxInfo | null) => void;
}

export interface DepositResult {
  txId: string;
  amount: bigint;
}

interface SentTx {
  hash: string;
  wait: () => Promise<unknown>;
}

type ReceiptWithLogs = ConnectorReceiptLike & {
  logs: { topics: readonly string[]; data: string }[];
};

/** Converts the form amount to base units, reading `decimals()` when entered in whole tokens. */
async function resolveAmount(token: Contract, raw: string, mode: AmountMode): Promise<bigint> {
  if (mode === "wei") {
    try {
      return BigInt(raw);
    } catch {
      throw new Error("Amount must be a valid integer when unit is 'wei'.");
    }
  }

  let decimals: number;
  try {
    decimals = Number(await token.decimals());
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new Error("Invalid token decimals");
    }
  } catch {
    throw new Error(
      "Could not read token decimals() from tokenFrom contract. Check the address and network.",
    );
  }

  try {
    return parseUnits(raw, decimals);
  } catch {
    throw new Error(
      `Amount must be a valid token number for decimals=${decimals} (examples: 100, 0.5, 1.234).`,
    );
  }
}

function findDepositTxId(receipt: ReceiptWithLogs): string | undefined {
  const iface = new Interface(CONNECTOR_ABI);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "DepositLocked") {
        return parsed.args[0] as string;
      }
    } catch {
      // Not a connector log.
    }
  }
  return undefined;
}

/**
 * Approves the source connector if needed, then calls `depositAndLock` and
 * returns the protocol txId from the `DepositLocked` event.
 */
export async function depositAndLock(
  ethereum: unknown,
  draft: TransferDraft,
  amountMode: AmountMode,
  progress: DepositProgress,
): Promise<DepositResult> {
  const provider = new BrowserProvider(ethereum as Eip1193Provider);
  await provider.send("eth_requestAccounts", []);

  const sourceChainId = getChainId(draft.sourceProfile);
  const destinationChainId = getChainId(draft.destProfile);
  if (!destinationChainId) {
    throw new Error("Unknown destination network. Select a supported destination profile.");
  }
  if (sourceChainId) {
    await ensureWalletOnChain(provider, sourceChainId);
  }

  const signer = await provider.getSigner();
  const signerAddress = await signer.getAddress();
  const token = new Contract(draft.tokenFrom, ERC20_ABI, signer);

  const amount = await resolveAmount(token, draft.amount, amountMode);
  if (amount <= 0n) {
    throw new Error("Amount must be greater than 0.");
  }

  let allowance: bigint;
  try {
    allowance = BigInt(
      await (token.allowance!(signerAddress, draft.sourceConnector) as Promise<bigint>),
    );
  } catch {
    throw new Error(
      "Could not read token allowance() from tokenFrom contract. Check the address and selected source network.",
    );
  }

  if (allowance < amount) {
    progress.onPhase("approving");
    const approveTx = await (token.approve!(draft.sourceConnector, MaxUint256) as Promise<SentTx>);
    progress.onPendingTx({ phase: "approval", hash: approveTx.hash });
    await approveTx.wait();
  }

  progress.onPhase("depositing");
  const connector = new Contract(draft.sourceConnector, CONNECTOR_ABI, signer);
  const deposit = connector.depositAndLock as unknown as ConnectorContractMethodLike;
  const depositArgs = [
    draft.tokenFrom,
    draft.tokenTo,
    draft.receiver,
    amount,
    draft.destConnector,
    destinationChainId,
  ];
  const gasLogContext = {
    provider,
    method: "depositAndLock",
    connectorAddress: draft.sourceConnector,
    chainId: sourceChainId,
    nativeSymbol: NETWORKS[draft.sourceProfile]?.nativeCurrency.symbol,
  };

  await logConnectorGasEstimate({
    ...gasLogContext,
    args: depositArgs,
    estimateGas: deposit.estimateGas
      ? (...args: unknown[]) => deposit.estimateGas!(...args)
      : undefined,
  });

  const depositTx = await deposit(...depositArgs);
  progress.onPendingTx({ phase: "deposit", hash: depositTx.hash });

  const receipt = (await depositTx.wait()) as ReceiptWithLogs | null;
  if (!receipt) throw new Error("No transaction receipt returned");
  progress.onPendingTx(null);
  await logConnectorGasReceipt({ ...gasLogContext, txHash: depositTx.hash, receipt });

  const txId = findDepositTxId(receipt);
  if (!txId) throw new Error("DepositLocked event not found in receipt");

  return { txId, amount };
}
