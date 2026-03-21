import { Contract, JsonRpcProvider } from "ethers";
import { CONNECTOR_ABI, connectorInterface } from "../contracts/abi.js";
import { normalizeBytes32 } from "../core/utils.js";
import type { HistoryFlags, RelayConfig, ResumeDecision } from "../core/types.js";

const PLANNER_LOG_LOOKBACK_BLOCKS = 50_000;

function getEventTopic(eventName: string): string {
  const event = connectorInterface.getEvent(eventName);
  if (!event) {
    throw new Error(`Missing ABI event fragment for ${eventName}`);
  }
  return event.topicHash;
}

async function hasEventInRange(
  provider: JsonRpcProvider,
  connectorAddress: string,
  eventTopic: string,
  txId: string,
  lookback: number
): Promise<boolean> {
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - lookback + 1);
  const logs = await provider.getLogs({
    address: connectorAddress,
    topics: [eventTopic, txId],
    fromBlock,
    toBlock: latestBlock
  });
  return logs.length > 0;
}

async function checkHistoryFlags(
  sourceProvider: JsonRpcProvider,
  destinationProvider: JsonRpcProvider,
  config: RelayConfig,
  txId: string
): Promise<HistoryFlags> {
  const depositLockedTopic = getEventTopic("DepositLocked");
  const fundsReleasedTopic = getEventTopic("FundsReleased");
  const ackReadyTopic = getEventTopic("AckReady");

  const [depositLocked, fundsReleased, ackReady] = await Promise.all([
    hasEventInRange(
      sourceProvider,
      config.connectors.source,
      depositLockedTopic,
      txId,
      PLANNER_LOG_LOOKBACK_BLOCKS
    ),
    hasEventInRange(
      destinationProvider,
      config.connectors.destination,
      fundsReleasedTopic,
      txId,
      PLANNER_LOG_LOOKBACK_BLOCKS
    ),
    hasEventInRange(
      sourceProvider,
      config.connectors.source,
      ackReadyTopic,
      txId,
      PLANNER_LOG_LOOKBACK_BLOCKS
    )
  ]);

  return { depositLocked, fundsReleased, ackReady };
}

const EMPTY_HISTORY: HistoryFlags = {
  depositLocked: false,
  fundsReleased: false,
  ackReady: false
};

export function computeResumeDecision(
  sourceStatus: number,
  destinationStatus: number,
  historyFlags: HistoryFlags
): ResumeDecision {
  // Refund path takes priority over all other checks
  if (sourceStatus === 3 || destinationStatus === 5) {
    return {
      action: "error",
      reason: "unsupported refund path",
      sourceStatus,
      destinationStatus,
      historyFlags
    };
  }

  if (sourceStatus === 1 && destinationStatus === 0) {
    return {
      action: "lock",
      reason: "source has deposit, destination needs lock proof",
      sourceStatus,
      destinationStatus,
      historyFlags
    };
  }

  if (sourceStatus === 1 && destinationStatus === 4) {
    return {
      action: "mint",
      reason: "destination has funds, source needs mint proof",
      sourceStatus,
      destinationStatus,
      historyFlags
    };
  }

  if (sourceStatus === 2 && destinationStatus === 4) {
    return {
      action: "ack",
      reason: "source is ack-ready, destination has funds",
      sourceStatus,
      destinationStatus,
      historyFlags
    };
  }

  if (sourceStatus === 0 && destinationStatus === 4) {
    if (historyFlags.ackReady) {
      return {
        action: "ack",
        reason:
          "source origin pruned but AckReady event found; destination needs ack proof",
        sourceStatus,
        destinationStatus,
        historyFlags
      };
    }
    return {
      action: "error",
      reason: "inconsistent cross-chain state",
      sourceStatus,
      destinationStatus,
      historyFlags
    };
  }

  if (sourceStatus === 2 && destinationStatus === 0) {
    return {
      action: "noop",
      reason: "destination finished, origin cleanup is manual",
      sourceStatus,
      destinationStatus,
      historyFlags
    };
  }

  if (sourceStatus === 0 && destinationStatus === 0) {
    if (
      historyFlags.depositLocked ||
      historyFlags.fundsReleased ||
      historyFlags.ackReady
    ) {
      return {
        action: "noop",
        reason: "transaction already terminal",
        sourceStatus,
        destinationStatus,
        historyFlags
      };
    }
    return {
      action: "error",
      reason: "tx not found",
      sourceStatus,
      destinationStatus,
      historyFlags
    };
  }

  return {
    action: "error",
    reason: "inconsistent cross-chain state",
    sourceStatus,
    destinationStatus,
    historyFlags
  };
}

export async function planRelayResume(
  config: RelayConfig
): Promise<ResumeDecision> {
  const txId = normalizeBytes32(config.txId, "txId");

  const sourceProvider = new JsonRpcProvider(
    config.source.rpcUrls[0],
    config.source.chainId
  );
  const destinationProvider = new JsonRpcProvider(
    config.destination.rpcUrls[0],
    config.destination.chainId
  );

  const sourceContract = new Contract(
    config.connectors.source,
    CONNECTOR_ABI,
    sourceProvider
  );
  const destinationContract = new Contract(
    config.connectors.destination,
    CONNECTOR_ABI,
    destinationProvider
  );

  const [sourceStatus, destinationStatus] = await Promise.all([
    sourceContract.txStatus(txId).then(Number),
    destinationContract.txStatus(txId).then(Number)
  ]);

  let historyFlags: HistoryFlags = EMPTY_HISTORY;

  if (sourceStatus === 0 && destinationStatus === 4) {
    const ackReadyTopic = getEventTopic("AckReady");
    const ackReady = await hasEventInRange(
      sourceProvider,
      config.connectors.source,
      ackReadyTopic,
      txId,
      PLANNER_LOG_LOOKBACK_BLOCKS
    );
    historyFlags = { depositLocked: false, fundsReleased: false, ackReady };
  } else if (sourceStatus === 0 && destinationStatus === 0) {
    historyFlags = await checkHistoryFlags(
      sourceProvider,
      destinationProvider,
      config,
      txId
    );
  }

  return computeResumeDecision(sourceStatus, destinationStatus, historyFlags);
}
