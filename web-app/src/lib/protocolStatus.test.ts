import { describe, expect, it } from "vitest";
import {
  EXPECTED_TX_STATUS_BY_STAGE,
  TX_STATUS_LABELS,
  stageRequiresActiveAckWindow,
} from "./protocolStatus";

describe("protocol tx status mapping", () => {
  it("matches the current Solidity TxStatus enum", () => {
    expect(TX_STATUS_LABELS).toEqual({
      0: "NONE",
      1: "DEPOSIT_LOCKED",
      2: "REFUND_INITIATED",
      3: "MINTED_IN_HOLDING",
      4: "REFUND_CLAIM_ACCEPTED",
    });
  });

  it("uses the correct pre-submit status for each relay stage", () => {
    expect(EXPECTED_TX_STATUS_BY_STAGE).toMatchObject({
      lock: 0,
      mint: 1,
      ack: 3,
      "refund-initiate": 1,
      "refund-claim": 3,
      "execute-burn": 4,
      "burn-proof": 2,
      "non-accept-proof": 2,
    });
  });

  it("does not require an active ACK window for ACK submission", () => {
    expect(stageRequiresActiveAckWindow("lock")).toBe(true);
    expect(stageRequiresActiveAckWindow("mint")).toBe(true);
    expect(stageRequiresActiveAckWindow("ack")).toBe(false);
  });
});
