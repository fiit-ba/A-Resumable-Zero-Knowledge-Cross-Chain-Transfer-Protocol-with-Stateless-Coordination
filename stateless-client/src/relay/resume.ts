import { planRelayResume } from "./planner.js";
import {
  runRelayAck,
  runRelayBurnProof,
  runRelayExecuteBurn,
  runRelayLock,
  runRelayMint,
  runRelayRefundClaim,
  runRelayRefundInitiate,
  shouldUsePrunedAckVerification,
} from "./relay.js";
import type { RelayConfig, RelayStageResult, ResumeAction, ResumeResult } from "../core/types.js";

// ---------------------------------------------------------------------------
// Typed action handler map — replaces per-action if/else chain
// ---------------------------------------------------------------------------

type RelayActionHandler = (config: RelayConfig) => Promise<RelayStageResult>;

const ACTION_HANDLERS: Partial<Record<ResumeAction, RelayActionHandler>> = {
  lock: (c) => runRelayLock(c),
  mint: (c) => runRelayMint(c),
  "refund-initiate": (c) => runRelayRefundInitiate(c),
  "refund-claim": (c) => runRelayRefundClaim(c),
  "execute-burn": (c) => runRelayExecuteBurn(c),
  "burn-proof": (c) => runRelayBurnProof(c),
};

export async function runRelayResume(config: RelayConfig): Promise<ResumeResult> {
  const decision = await planRelayResume(config);

  if (decision.action === "noop") {
    return { decision };
  }

  if (decision.action === "error") {
    throw new Error(decision.reason);
  }

  // Ack may require the pruned-source-origin verification variant.
  if (decision.action === "ack") {
    const ackConfig: RelayConfig = shouldUsePrunedAckVerification(
      decision.sourceStatus,
      decision.destinationStatus,
    )
      ? { ...config, verificationHints: { ...config.verificationHints, ackVariant: "pruned-source-origin" } }
      : config;
    const executed = await runRelayAck(ackConfig);
    return { decision, executed };
  }

  const handler = ACTION_HANDLERS[decision.action];
  if (!handler) {
    throw new Error(`No handler for action: ${decision.action}`);
  }

  const executed = await handler(config);
  return { decision, executed };
}
