import { eventTopic } from "../contracts/abi.js";
import { normalizeBytes32 } from "../core/utils.js";
import { TxStatus } from "../core/types.js";
import type {
  HistoryFlags,
  ResumeAction,
  ResumeDecision,
  Side,
  StageSubmissionConfig,
} from "../core/types.js";
import { connectorReaders, type ConnectorReader } from "./endpoints.js";

const PLANNER_LOG_LOOKBACK_BLOCKS = 50_000;

/** The subset of a relay config the planner needs: no signer, proofs, or paths. */
export type ResumePlanConfig = Pick<
  StageSubmissionConfig,
  "source" | "destination" | "connectors" | "txId"
>;

const EMPTY_HISTORY: HistoryFlags = {
  depositLocked: false,
  fundsReleased: false,
  ackReady: false,
};

const { NONE, DEPOSIT_LOCKED, REFUND_INITIATED, MINTED_IN_HOLDING, REFUND_CLAIM_ACCEPTED } =
  TxStatus;

/** True if `eventName` was emitted for `txId` within the planner's lookback window. */
async function hasRecentEvent(
  reader: ConnectorReader,
  eventName: string,
  txId: string,
): Promise<boolean> {
  const latestBlock = await reader.provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - PLANNER_LOG_LOOKBACK_BLOCKS + 1);
  const logs = await reader.provider.getLogs({
    address: reader.address,
    topics: [eventTopic(eventName), txId],
    fromBlock,
    toBlock: latestBlock,
  });
  return logs.length > 0;
}

async function isAckDeadlineExpired(source: ConnectorReader, txId: string): Promise<boolean> {
  const sourceTx = await source.contract.getTx(txId);
  const ackDeadline = BigInt(sourceTx.ackDeadline);
  if (ackDeadline === 0n) {
    return false;
  }
  const latestBlock = await source.provider.getBlock("latest");
  return latestBlock ? BigInt(latestBlock.timestamp) >= ackDeadline : false;
}

/**
 * Pure decision table mapping (sourceStatus, destinationStatus, history) to the
 * next relay action. Exported separately from the chain reads for testing.
 */
export function computeResumeDecision(
  sourceStatus: number,
  destinationStatus: number,
  historyFlags: HistoryFlags,
): ResumeDecision {
  const decide = (action: ResumeAction, reason: string): ResumeDecision => ({
    action,
    reason,
    sourceStatus,
    destinationStatus,
    historyFlags,
  });
  const inconsistent = () => decide("error", "inconsistent cross-chain state");
  const is = (source: number, destination: number) =>
    sourceStatus === source && destinationStatus === destination;

  if (is(DEPOSIT_LOCKED, NONE)) {
    // The destination rejects lock proofs once ackDeadline has passed, so an expired
    // unaccepted deposit can only be recovered through the refund path.
    return historyFlags.ackDeadlineExpired
      ? decide(
          "refund-initiate",
          "ACK window expired before the destination accepted the lock; source must initiate refund",
        )
      : decide("lock", "source has deposit, destination needs lock proof");
  }

  if (is(DEPOSIT_LOCKED, MINTED_IN_HOLDING)) {
    return historyFlags.ackDeadlineExpired
      ? decide("refund-initiate", "ACK window expired; source must initiate refund")
      : decide("mint", "destination has funds, source needs mint proof");
  }

  if (is(NONE, MINTED_IN_HOLDING)) {
    return historyFlags.ackReady
      ? decide("ack", "source origin pruned but AckReady event found; destination needs ack proof")
      : inconsistent();
  }

  if (is(REFUND_INITIATED, MINTED_IN_HOLDING)) {
    return decide(
      "refund-claim",
      "refund initiated on source; destination needs refund-claim proof",
    );
  }

  if (is(REFUND_INITIATED, REFUND_CLAIM_ACCEPTED)) {
    return decide("execute-burn", "refund claim accepted on destination; execute burn");
  }

  if (is(REFUND_INITIATED, NONE)) {
    // Without a DestTxClosed event the destination never accepted the lock, so the
    // refund is proven via a non-acceptance proof instead of a burn proof.
    return historyFlags.burnExecuted
      ? decide("burn-proof", "burn executed on destination; source needs burn proof")
      : decide(
          "non-accept-proof",
          "destination never accepted the lock; submit non-acceptance proof on source to recover funds",
        );
  }

  if (is(NONE, NONE)) {
    const seenAnyEvent =
      historyFlags.depositLocked || historyFlags.fundsReleased || historyFlags.ackReady;
    return seenAnyEvent
      ? decide("noop", "transaction already terminal")
      : decide("error", "tx not found");
  }

  return inconsistent();
}

/**
 * Collects only the history needed to disambiguate the observed status pair;
 * most pairs need no extra RPC calls.
 */
async function readHistoryFlags(
  readers: Record<Side, ConnectorReader>,
  txId: string,
  sourceStatus: number,
  destinationStatus: number,
): Promise<HistoryFlags> {
  const { source, destination } = readers;

  if (
    sourceStatus === DEPOSIT_LOCKED &&
    (destinationStatus === NONE || destinationStatus === MINTED_IN_HOLDING)
  ) {
    return { ...EMPTY_HISTORY, ackDeadlineExpired: await isAckDeadlineExpired(source, txId) };
  }

  if (sourceStatus === NONE && destinationStatus === MINTED_IN_HOLDING) {
    return { ...EMPTY_HISTORY, ackReady: await hasRecentEvent(source, "AckReady", txId) };
  }

  if (sourceStatus === REFUND_INITIATED && destinationStatus === NONE) {
    return {
      ...EMPTY_HISTORY,
      burnExecuted: await hasRecentEvent(destination, "DestTxClosed", txId),
    };
  }

  if (sourceStatus === NONE && destinationStatus === NONE) {
    const [depositLocked, fundsReleased, ackReady] = await Promise.all([
      hasRecentEvent(source, "DepositLocked", txId),
      hasRecentEvent(destination, "FundsReleased", txId),
      hasRecentEvent(source, "AckReady", txId),
    ]);
    return { depositLocked, fundsReleased, ackReady };
  }

  return EMPTY_HISTORY;
}

export async function planRelayResume(config: ResumePlanConfig): Promise<ResumeDecision> {
  const txId = normalizeBytes32(config.txId, "txId");
  const readers = connectorReaders(config);

  const [sourceStatus, destinationStatus] = await Promise.all([
    readers.source.contract.txStatus(txId).then(Number),
    readers.destination.contract.txStatus(txId).then(Number),
  ]);

  const historyFlags = await readHistoryFlags(readers, txId, sourceStatus, destinationStatus);
  return computeResumeDecision(sourceStatus, destinationStatus, historyFlags);
}
