import { describe, expect, it } from "vitest";
import { computeResumeDecision } from "../../src/relay/planner.js";
import type { HistoryFlags } from "../../src/core/types.js";

const NO_HISTORY: HistoryFlags = {
  depositLocked: false,
  fundsReleased: false,
  ackReady: false,
};

describe("computeResumeDecision", () => {
  it("1/0 -> lock", () => {
    const d = computeResumeDecision(1, 0, NO_HISTORY);
    expect(d.action).toBe("lock");
    expect(d.sourceStatus).toBe(1);
    expect(d.destinationStatus).toBe(0);
  });

  it("1/3 -> mint", () => {
    const d = computeResumeDecision(1, 3, NO_HISTORY);
    expect(d.action).toBe("mint");
  });

  it("0/3 + AckReady history -> ack", () => {
    const d = computeResumeDecision(0, 3, {
      ...NO_HISTORY,
      ackReady: true,
    });
    expect(d.action).toBe("ack");
    expect(d.reason).toMatch(/pruned/i);
    expect(d.historyFlags.ackReady).toBe(true);
  });

  it("0/3 without AckReady history -> inconsistent error", () => {
    const d = computeResumeDecision(0, 3, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/inconsistent/i);
  });

  it("0/0 + DepositLocked history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      depositLocked: true,
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + FundsReleased history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      fundsReleased: true,
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + AckReady history -> noop terminal", () => {
    const d = computeResumeDecision(0, 0, {
      ...NO_HISTORY,
      ackReady: true,
    });
    expect(d.action).toBe("noop");
    expect(d.reason).toMatch(/terminal/i);
  });

  it("0/0 + no history -> tx not found error", () => {
    const d = computeResumeDecision(0, 0, NO_HISTORY);
    expect(d.action).toBe("error");
    expect(d.reason).toMatch(/not found/i);
  });

  it("1/3 + ackDeadlineExpired -> refund-initiate", () => {
    const d = computeResumeDecision(1, 3, { ...NO_HISTORY, ackDeadlineExpired: true });
    expect(d.action).toBe("refund-initiate");
    expect(d.reason).toMatch(/expired/i);
  });

  it("1/0 + ackDeadlineExpired -> refund-initiate, since the destination would reject the lock", () => {
    const d = computeResumeDecision(1, 0, { ...NO_HISTORY, ackDeadlineExpired: true });
    expect(d.action).toBe("refund-initiate");
    expect(d.reason).toMatch(/expired before the destination accepted/i);
  });

  it("1/0 within the ACK window -> lock", () => {
    expect(computeResumeDecision(1, 0, { ...NO_HISTORY, ackDeadlineExpired: false }).action).toBe(
      "lock",
    );
  });

  it("2/3 -> refund-claim", () => {
    const d = computeResumeDecision(2, 3, NO_HISTORY);
    expect(d.action).toBe("refund-claim");
    expect(d.reason).toMatch(/refund/i);
  });

  it("2/4 -> execute-burn", () => {
    const d = computeResumeDecision(2, 4, NO_HISTORY);
    expect(d.action).toBe("execute-burn");
    expect(d.reason).toMatch(/burn/i);
  });

  it("2/0 + DestTxClosed history -> burn-proof", () => {
    const d = computeResumeDecision(2, 0, { ...NO_HISTORY, burnExecuted: true });
    expect(d.action).toBe("burn-proof");
    expect(d.reason).toMatch(/burn/i);
  });

  it("2/0 without DestTxClosed history -> non-accept-proof", () => {
    const d = computeResumeDecision(2, 0, NO_HISTORY);
    expect(d.action).toBe("non-accept-proof");
    expect(d.reason).toMatch(/non-acceptance/i);
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
      ackReady: false,
    };
    const d = computeResumeDecision(0, 0, flags);
    expect(d.historyFlags).toEqual(flags);
  });
});
