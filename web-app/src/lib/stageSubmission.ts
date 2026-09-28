import { AbiCoder, BrowserProvider, Contract } from "ethers";
import type { Eip1193Provider } from "ethers";
import type { EnrichedStagePayload } from "../api/types";
import { CONNECTOR_ABI, ERC20_ABI } from "./abi";
import { logConnectorGasEstimate, logConnectorGasReceipt } from "./connectorGasLog";
import type { ConnectorContractMethodLike } from "./connectorGasLog";
import { getNetworkByChainId } from "./networks";
import {
  EXPECTED_TX_STATUS_BY_STAGE,
  PROOF_TYPE_RISC0,
  RISC0_ROUTE_BY_STAGE,
  stageRequiresActiveAckWindow,
  txStatusLabel,
} from "./protocolStatus";
import { assertContractCodePresent, ensureWalletOnChain } from "./wallet";

/** Index of `originAckDeadline` in submitLockProof's argument list. */
const LOCK_ARG_ORIGIN_ACK_DEADLINE = 9;

async function latestBlockTimestamp(provider: BrowserProvider): Promise<bigint> {
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) throw new Error("Stage preflight failed: unable to fetch latest block.");
  return BigInt(latestBlock.timestamp.toString());
}

async function readAckDeadline(connector: Contract, txId: string): Promise<bigint> {
  const tx = (await connector.getTx(txId)) as { ackDeadline: bigint };
  return BigInt(tx.ackDeadline.toString());
}

/**
 * Mirrors the connector's on-chain guards so the wallet is never asked to sign
 * a transaction that would revert. Throws a descriptive error on the first failed check.
 */
async function assertStageSubmittable(
  provider: BrowserProvider,
  stage: EnrichedStagePayload,
  txId: string,
): Promise<void> {
  const connector = new Contract(stage.targetConnector, CONNECTOR_ABI, provider);

  const expectedStatus = EXPECTED_TX_STATUS_BY_STAGE[stage.stage];
  if (expectedStatus !== undefined) {
    const currentStatus = Number(await connector.txStatus(txId));
    if (currentStatus !== expectedStatus) {
      throw new Error(
        `Stage preflight failed: txStatus is ${currentStatus} (${txStatusLabel(currentStatus)}) on connector ${stage.targetConnector}, expected ${expectedStatus} (${txStatusLabel(expectedStatus)}).`,
      );
    }
  }

  // Refunds only open once the ACK window has closed.
  if (stage.stage === "refund-initiate") {
    const ackDeadline = await readAckDeadline(connector, txId);
    const chainNow = await latestBlockTimestamp(provider);
    if (ackDeadline > 0n && chainNow < ackDeadline) {
      throw new Error(
        `Stage preflight failed: ACK window is still active (deadline=${ackDeadline}, now=${chainNow}). ` +
          `Refund is not yet available.`,
      );
    }
  }

  // Lock and mint must land before the ACK window closes. Lock carries the
  // deadline in its proof; mint reads it from the origin record.
  if (stageRequiresActiveAckWindow(stage.stage)) {
    const ackDeadline =
      stage.stage === "lock"
        ? BigInt(String(stage.contractArgs[LOCK_ARG_ORIGIN_ACK_DEADLINE] ?? "0"))
        : await readAckDeadline(connector, txId);
    if (ackDeadline > 0n) {
      const chainNow = await latestBlockTimestamp(provider);
      if (chainNow >= ackDeadline) {
        throw new Error(
          `Stage preflight failed: ACK window expired ` +
            `(deadline=${ackDeadline}, current=${chainNow}). Refund flow is required.`,
        );
      }
    }
  }

  // Ack releases held wrapped tokens, so the destination connector must hold enough.
  if (stage.stage === "ack") {
    const txSnapshot = (await connector.getTx(txId)) as { amount: bigint; currencyTo: string };
    const payoutToken = String(txSnapshot.currencyTo);
    const payoutAmount = BigInt(txSnapshot.amount.toString());
    const token = new Contract(payoutToken, ERC20_ABI, provider);
    const connectorLiquidity = BigInt((await token.balanceOf(stage.targetConnector)).toString());
    if (connectorLiquidity < payoutAmount) {
      throw new Error(
        `ACK preflight failed: destination connector ${stage.targetConnector} has insufficient liquidity. ` +
          `Required ${payoutAmount}, balance ${connectorLiquidity} on token ${payoutToken}.`,
      );
    }
  }

  // RISC Zero proofs embed the guest image ID; catch a stale adapter/connector early.
  if (stage.actionKind === "proof" && stage.proofPayload) {
    const proofType = Number(stage.contractArgs[0]);
    const route = RISC0_ROUTE_BY_STAGE[stage.stage];
    if (proofType === PROOF_TYPE_RISC0 && route !== undefined) {
      const decoded = AbiCoder.defaultAbiCoder().decode(
        ["bytes", "bytes32", "bytes32"],
        stage.proofPayload,
      );
      const proofImageId = String(decoded[1]);
      const expectedImageId = String(await connector.getExpectedRisc0ImageId(route));
      if (proofImageId.toLowerCase() !== expectedImageId.toLowerCase()) {
        throw new Error(
          `RISC0 image-id mismatch for ${stage.stage}: proof has ${proofImageId}, ` +
            `connector expects ${expectedImageId}. Redeploy connector/adapter with matching image IDs.`,
        );
      }
    }
  }
}

/**
 * Switches the wallet to the stage's chain, runs the preflight checks, then
 * signs and submits the prepared contract call. Resolves with the relay tx hash.
 */
export async function submitPreparedStage(
  ethereum: unknown,
  stage: EnrichedStagePayload,
  fallbackTxId: string,
): Promise<string> {
  const provider = new BrowserProvider(ethereum as Eip1193Provider);
  await provider.send("eth_requestAccounts", []);
  await ensureWalletOnChain(provider, stage.targetChainId);
  await assertContractCodePresent(provider, stage.targetConnector, stage.targetChainId);

  // txId is the first arg of direct calls and the third of proof submissions.
  const txId = String(stage.contractArgs[stage.actionKind === "direct" ? 0 : 2] ?? fallbackTxId);
  await assertStageSubmittable(provider, stage, txId);

  const signer = await provider.getSigner();
  const connector = new Contract(stage.targetConnector, CONNECTOR_ABI, signer);
  const fn = connector[stage.contractMethod];
  if (typeof fn !== "function") {
    throw new Error(`Unknown contract method: ${stage.contractMethod}`);
  }

  const gasLogContext = {
    provider,
    method: stage.contractMethod,
    connectorAddress: stage.targetConnector,
    chainId: stage.targetChainId,
    nativeSymbol: getNetworkByChainId(stage.targetChainId)?.nativeCurrency.symbol,
  };
  const contractMethod = fn as ConnectorContractMethodLike;
  await logConnectorGasEstimate({
    ...gasLogContext,
    args: stage.contractArgs,
    estimateGas: contractMethod.estimateGas
      ? (...args: unknown[]) => contractMethod.estimateGas!(...args)
      : undefined,
  });

  const relayTx = await contractMethod(...stage.contractArgs);
  const receipt = await relayTx.wait();
  const txHash = receipt?.hash ?? relayTx.hash ?? "";

  await logConnectorGasReceipt({ ...gasLogContext, txHash, receipt });
  return txHash;
}
