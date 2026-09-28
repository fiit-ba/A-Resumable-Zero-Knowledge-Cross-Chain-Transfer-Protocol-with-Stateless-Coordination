import { planRelayResume } from "./planner.js";
import { runRelayStage, shouldUsePrunedAckVerification } from "./relay.js";
import type { RelayConfig, ResumeResult } from "../core/types.js";

/** Reads both connectors, picks the next valid relay action, and executes it. */
export async function runRelayResume(config: RelayConfig): Promise<ResumeResult> {
  const decision = await planRelayResume(config);

  if (decision.action === "noop") {
    return { decision };
  }

  if (decision.action === "error") {
    throw new Error(decision.reason);
  }

  // After the source record is pruned, ack must use the event-only verification variant.
  const usePrunedAck =
    decision.action === "ack" &&
    shouldUsePrunedAckVerification(decision.sourceStatus, decision.destinationStatus);
  const stageConfig: RelayConfig = usePrunedAck
    ? {
        ...config,
        verificationHints: { ...config.verificationHints, ackVariant: "pruned-source-origin" },
      }
    : config;

  const executed = await runRelayStage(stageConfig, decision.action);
  return { decision, executed };
}
