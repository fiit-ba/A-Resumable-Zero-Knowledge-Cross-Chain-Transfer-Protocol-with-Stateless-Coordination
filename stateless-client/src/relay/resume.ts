import { planRelayResume } from "./planner.js";
import { runRelayAck, runRelayLock, runRelayMint } from "./relay.js";
import type { RelayConfig, ResumeResult } from "../core/types.js";

export async function runRelayResume(
  config: RelayConfig
): Promise<ResumeResult> {
  const decision = await planRelayResume(config);

  if (decision.action === "lock") {
    const executed = await runRelayLock(config);
    return { decision, executed };
  }

  if (decision.action === "mint") {
    const executed = await runRelayMint(config);
    return { decision, executed };
  }

  if (decision.action === "ack") {
    const ackConfig: RelayConfig =
      decision.sourceStatus === 0 && decision.destinationStatus === 4
        ? { ...config, allowPrunedSourceAck: true }
        : config;
    const executed = await runRelayAck(ackConfig);
    return { decision, executed };
  }

  if (decision.action === "noop") {
    return { decision };
  }

  // action === "error"
  throw new Error(decision.reason);
}
