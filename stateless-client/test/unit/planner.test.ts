import { describe, expect, it } from "vitest";
import { computeResumeDecision } from "../../src/relay/planner.js";
import type { HistoryFlags } from "../../src/core/types.js";

const NO_HISTORY: HistoryFlags = {
  depositLocked: false,
  fundsReleased: false,
  ackReady: false
};

describe("computeResumeDecision", () => {
  it("1/0 -> lock", () => {
    const d = computeResumeDecision(1, 0, NO_HISTORY);
    expect(d.action).toBe("lock");
    expect(d.sourceStatus).toBe(1);
    expect(d.destinationStatus).toBe(0);
  });

  it("1/4 -> mint", () => {
    const d = computeResumeDecision(1, 4, NO_HISTORY);
    expect(d.action).toBe("mint");
  });

  it("2/4 -> ack", () => {
    const d = computeResumeDecision(2, 4, NO_HISTORY);
    expect(d.action).toBe("ack");
  });

  it("0/4 + AckReady history -> ack", () => {
    const d = computeResumeDecision(0, 4, {
      ...NO_HISTORY,
      ackReady: true
    });
    expect(d.action).toBe("ack");
    expect(d.reason).toMatch(/pruned/i);
    expect(d.historyFlags.ackReady).toBe(true);
  });

  it("0/4 without AckReady history -> inconsistent error", () => {
    const d = computeResumeDecision(0, 4, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/inconsistent/i);
  });

  it("2/0 -> noop with manual-cleanup reason", () => {
    const d = computeResumeDecision(2, 0, NO_HISTORY);
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/manual/i);
  });

  it("0/0 + DepositLocked history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      depositLocked: true
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + FundsReleased history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      fundsReleased: true
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + AckReady history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      ackReady: true
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + no history -> tx not found error", () => {
    const d = computeResumeDecision(0, 0, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/not found/i);
  });

  it("source=3 -> unsupported refund path error", () => {
    const d = computeResumeDecision(3, 0, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/refund/i);
  });

  it("destination=5 -> unsupported refund path error", () => {
    const d = computeResumeDecision(0, 5, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/refund/i);
  });

  it("source=3 takes priority over destination=5", () => {
    const d = computeResumeDecision(3, 5, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/refund/i);
  });

  it("unknown combination 1/1 -> inconsistent error", () => {
    const d = computeResumeDecision(1, 1, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/inconsistent/i);
  });

  it("unknown combination 2/2 -> inconsistent error", () => {
    const d = computeResumeDecision(2, 2, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/inconsistent/i);
  });

  it("decision carries sourceStatus and destinationStatus", () => {
    const d = computeResumeDecision(1, 0, NO_HISTORY);
    expect(d.sourceStatus).toBe(1);
    expect(d.destinationStatus).toBe(0);
  });

  it("decision carries historyFlags", () => {
    const flags: HistoryFlags = {
      depositLocked: true,
      fundsReleased: false,
      ackReady: false
    };
    const d = computeResumeDecision(0, 0, flags);
    expect(d.historyFlags).toEqual(flags);
  });
});
