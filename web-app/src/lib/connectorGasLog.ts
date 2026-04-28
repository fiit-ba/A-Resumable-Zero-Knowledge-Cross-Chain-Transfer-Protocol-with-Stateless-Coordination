type ChainIdLike = number | bigint | string;

interface FeeDataLike {
  gasPrice?: bigint | null;
  maxFeePerGas?: bigint | null;
  maxPriorityFeePerGas?: bigint | null;
}

interface NetworkLike {
  chainId?: ChainIdLike;
}

interface ProviderLike {
  getFeeData?: () => Promise<FeeDataLike>;
  getNetwork?: () => Promise<NetworkLike>;
}

export interface ConnectorReceiptLike {
  hash?: string;
  gasUsed?: bigint;
  gasPrice?: bigint;
  effectiveGasPrice?: bigint;
  fee?: bigint;
}

export interface ConnectorTransactionResponseLike {
  hash: string;
  wait: () => Promise<ConnectorReceiptLike | null>;
}

export type ConnectorContractMethodLike = ((
  ...args: unknown[]
) => Promise<ConnectorTransactionResponseLike>) & {
  estimateGas?: (...args: unknown[]) => Promise<bigint>;
};

interface ConnectorGasLogBase {
  provider: ProviderLike;
  method: string;
  connectorAddress: string;
  chainId?: ChainIdLike;
  nativeSymbol?: string;
}

interface ConnectorGasEstimateInput extends ConnectorGasLogBase {
  args: unknown[];
  estimateGas?: (...args: unknown[]) => Promise<bigint>;
}

interface ConnectorGasReceiptInput extends ConnectorGasLogBase {
  txHash?: string;
  receipt: ConnectorReceiptLike | null;
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatUnits(value: bigint, decimals: number, precision = 6): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;

  if (fraction === 0n || precision <= 0) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }

  const padded = fraction.toString().padStart(decimals, "0");
  const trimmed = padded.slice(0, precision).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

function formatWei(value: bigint, nativeSymbol = "ETH"): string {
  return `${formatUnits(value, 18, 8)} ${nativeSymbol}`;
}

function formatGwei(value: bigint): string {
  return `${formatUnits(value, 9, 4)} gwei`;
}

function normalizeChainId(chainId: ChainIdLike | undefined): string | undefined {
  if (chainId === undefined || chainId === null) return undefined;
  return chainId.toString();
}

async function resolveChainId(
  provider: ProviderLike,
  fallback?: ChainIdLike,
): Promise<string | undefined> {
  if (fallback !== undefined) return normalizeChainId(fallback);
  try {
    return normalizeChainId((await provider.getNetwork?.())?.chainId);
  } catch {
    return undefined;
  }
}

async function resolveFeeData(provider: ProviderLike): Promise<FeeDataLike> {
  try {
    return (await provider.getFeeData?.()) ?? {};
  } catch {
    return {};
  }
}

function selectEstimateGasPrice(feeData: FeeDataLike): { gasPrice?: bigint; source?: string } {
  if (feeData.gasPrice !== undefined && feeData.gasPrice !== null) {
    return { gasPrice: feeData.gasPrice, source: "gasPrice" };
  }
  if (feeData.maxFeePerGas !== undefined && feeData.maxFeePerGas !== null) {
    return { gasPrice: feeData.maxFeePerGas, source: "maxFeePerGas" };
  }
  return {};
}

function selectReceiptGasPrice(receipt: ConnectorReceiptLike): bigint | undefined {
  return receipt.gasPrice ?? receipt.effectiveGasPrice ?? undefined;
}

export async function logConnectorGasEstimate(input: ConnectorGasEstimateInput): Promise<void> {
  if (!input.estimateGas) {
    console.info("[connector-cost] estimate unavailable", {
      method: input.method,
      connector: input.connectorAddress,
      chainId: normalizeChainId(input.chainId),
    });
    return;
  }

  try {
    const [gasUnits, feeData, chainId] = await Promise.all([
      input.estimateGas(...input.args),
      resolveFeeData(input.provider),
      resolveChainId(input.provider, input.chainId),
    ]);
    const { gasPrice, source } = selectEstimateGasPrice(feeData);
    const estimatedCost = gasPrice === undefined ? undefined : gasUnits * gasPrice;

    console.info("[connector-cost] estimate", {
      method: input.method,
      connector: input.connectorAddress,
      chainId,
      gasUnits: gasUnits.toString(),
      gasPrice: gasPrice === undefined ? undefined : formatGwei(gasPrice),
      gasPriceSource: source,
      estimatedCost:
        estimatedCost === undefined ? undefined : formatWei(estimatedCost, input.nativeSymbol),
      maxPriorityFeePerGas:
        feeData.maxPriorityFeePerGas === undefined || feeData.maxPriorityFeePerGas === null
          ? undefined
          : formatGwei(feeData.maxPriorityFeePerGas),
    });
  } catch (err) {
    console.warn("[connector-cost] estimate failed", {
      method: input.method,
      connector: input.connectorAddress,
      chainId: normalizeChainId(input.chainId),
      error: stringifyError(err),
    });
  }
}

export async function logConnectorGasReceipt(input: ConnectorGasReceiptInput): Promise<void> {
  if (!input.receipt) {
    console.info("[connector-cost] receipt unavailable", {
      method: input.method,
      connector: input.connectorAddress,
      chainId: normalizeChainId(input.chainId),
      txHash: input.txHash,
    });
    return;
  }

  const chainId = await resolveChainId(input.provider, input.chainId);
  const gasUsed = input.receipt.gasUsed;
  const gasPrice = selectReceiptGasPrice(input.receipt);
  const fee =
    input.receipt.fee ??
    (gasUsed !== undefined && gasPrice !== undefined ? gasUsed * gasPrice : undefined);

  console.info("[connector-cost] actual", {
    method: input.method,
    connector: input.connectorAddress,
    chainId,
    txHash: input.txHash ?? input.receipt.hash,
    gasUsed: gasUsed?.toString(),
    gasPrice: gasPrice === undefined ? undefined : formatGwei(gasPrice),
    actualCost: fee === undefined ? undefined : formatWei(fee, input.nativeSymbol),
  });
}
