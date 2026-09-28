import { describe, expect, it } from "vitest";
import { getNetworkKind, getTxExplorerUrl } from "./networks";
import { ALL_STAGES, STAGE_LABELS, stageLabel } from "./stages";

describe("stageLabel", () => {
  it("labels every relay stage plus the pending/completed pseudo-stages", () => {
    for (const stage of ALL_STAGES) {
      expect(stageLabel(stage)).toBe(STAGE_LABELS[stage]);
    }
    expect(stageLabel("pending")).toBe("Pending");
    expect(stageLabel("completed")).toBe("Completed");
  });

  it("passes planner-only actions through and handles a missing action", () => {
    expect(stageLabel("noop")).toBe("noop");
    expect(stageLabel(undefined)).toBe("n/a");
  });
});

describe("network helpers", () => {
  it("classifies profiles by kind", () => {
    expect(getNetworkKind("local-anvil")).toBe("local");
    expect(getNetworkKind("chiado")).toBe("testnet");
    expect(getNetworkKind("gnosis")).toBe("mainnet");
  });

  it("builds explorer links only for networks that have an explorer", () => {
    expect(getTxExplorerUrl("sepolia", "0xabc")).toBe("https://sepolia.etherscan.io/tx/0xabc");
    expect(getTxExplorerUrl("local-anvil", "0xabc")).toBeNull();
  });
});
