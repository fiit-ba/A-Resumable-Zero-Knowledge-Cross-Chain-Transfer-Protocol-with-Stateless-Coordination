import { BrowserProvider } from "ethers";
import { getAddChainParams, toHexChainId } from "./networks";

interface ProviderRpcErrorShape {
  code?: number;
  message?: string;
}

function extractRpcError(error: unknown): ProviderRpcErrorShape {
  if (typeof error !== "object" || error === null) return {};

  const raw = error as Record<string, unknown>;
  const directCode = typeof raw.code === "number" ? raw.code : undefined;
  const directMessage = typeof raw.message === "string" ? raw.message : undefined;

  if (directCode !== undefined || directMessage) {
    return { code: directCode, message: directMessage };
  }

  const nested = raw.error;
  if (typeof nested === "object" && nested !== null) {
    const nestedRaw = nested as Record<string, unknown>;
    return {
      code: typeof nestedRaw.code === "number" ? nestedRaw.code : undefined,
      message: typeof nestedRaw.message === "string" ? nestedRaw.message : undefined,
    };
  }

  return {};
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function ensureWalletOnChain(
  provider: BrowserProvider,
  targetChainId: number,
): Promise<void> {
  const targetHex = toHexChainId(targetChainId);

  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: targetHex }]);
  } catch (error) {
    const { code, message } = extractRpcError(error);

    if (code === 4001) {
      throw new Error("Wallet network switch request was rejected by user.");
    }

    const unknownChain =
      code === 4902 || Boolean(message && /unrecognized chain|unknown chain/i.test(message));

    if (!unknownChain) {
      throw new Error(
        `Failed to switch wallet to chain ${targetChainId}: ${toErrorMessage(error)}`,
      );
    }

    const addParams = getAddChainParams(targetChainId);
    if (!addParams) {
      throw new Error(
        `Wallet does not know chain ${targetChainId} and no add-chain config is available in the app.`,
      );
    }

    try {
      await provider.send("wallet_addEthereumChain", [addParams]);
    } catch (addError) {
      const addDetails = extractRpcError(addError);
      if (addDetails.code === 4001) {
        throw new Error("Wallet add-network request was rejected by user.");
      }
      throw new Error(
        `Failed to add chain ${targetChainId} to wallet: ${toErrorMessage(addError)}`,
      );
    }

    await provider.send("wallet_switchEthereumChain", [{ chainId: targetHex }]);
  }

  const network = await provider.getNetwork();
  const currentChainId = Number(network.chainId);
  if (currentChainId !== targetChainId) {
    throw new Error(
      `Wallet is on chain ${currentChainId}, but stage requires chain ${targetChainId}.`,
    );
  }
}

export async function assertContractCodePresent(
  provider: BrowserProvider,
  contractAddress: string,
  chainId: number,
): Promise<void> {
  const code = await provider.getCode(contractAddress);
  if (code === "0x") {
    throw new Error(
      `No contract code at ${contractAddress} on chain ${chainId}. Check connector address and selected network.`,
    );
  }
}
