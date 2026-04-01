import { describe, expect, it } from "vitest";
import { connectorInterface } from "../../src/contracts/abi.js";
import { validateStageLog } from "../../src/relay/verification.js";

const TX_ID = "0x1111111111111111111111111111111111111111111111111111111111111111";
const SOURCE_CONNECTOR = "0x1000000000000000000000000000000000000001";
const DEST_CONNECTOR = "0x2000000000000000000000000000000000000002";
const USER = "0x3000000000000000000000000000000000000003";
const RECEIVER = "0x4000000000000000000000000000000000000004";
const TOKEN_A = "0x5000000000000000000000000000000000000005";
const TOKEN_B = "0x6000000000000000000000000000000000000006";

function encodeStageLog(eventName: string, args: unknown[]) {
  const eventFragment = connectorInterface.getEvent(eventName);
  const encoded = connectorInterface.encodeEventLog(eventFragment, args);
  return {
    address: eventName === "FundsReleased" ? DEST_CONNECTOR : SOURCE_CONNECTOR,
    topics: encoded.topics,
    data: encoded.data,
  };
}

describe("validateStageLog", () => {
  it("decodes and validates DepositLocked", () => {
    const log = encodeStageLog("DepositLocked", [
      TX_ID,
      USER,
      RECEIVER,
      1000n,
      TOKEN_A,
      TOKEN_B,
      SOURCE_CONNECTOR,
      DEST_CONNECTOR,
      10,
      7n,
      31337n,
    ]);

    expect(() =>
      validateStageLog(
        "source-deposit",
        log,
        SOURCE_CONNECTOR,
        TX_ID,
        SOURCE_CONNECTOR,
        DEST_CONNECTOR,
      ),
    ).not.toThrow();
  });

  it("decodes and validates FundsReleased", () => {
    const log = encodeStageLog("FundsReleased", [
      TX_ID,
      1000n,
      TOKEN_A,
      TOKEN_B,
      USER,
      RECEIVER,
      SOURCE_CONNECTOR,
      DEST_CONNECTOR,
      10,
      0,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "0x1234",
    ]);

    expect(() =>
      validateStageLog(
        "destination-funds-released",
        log,
        DEST_CONNECTOR,
        TX_ID,
        SOURCE_CONNECTOR,
        DEST_CONNECTOR,
      ),
    ).not.toThrow();
  });

  it("decodes and validates AckReady", () => {
    const log = encodeStageLog("AckReady", [
      TX_ID,
      1000n,
      TOKEN_A,
      TOKEN_B,
      USER,
      RECEIVER,
      SOURCE_CONNECTOR,
      DEST_CONNECTOR,
      10,
      0,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "0x1234",
    ]);

    expect(() =>
      validateStageLog(
        "source-ack-ready",
        log,
        SOURCE_CONNECTOR,
        TX_ID,
        SOURCE_CONNECTOR,
        DEST_CONNECTOR,
      ),
    ).not.toThrow();
  });

  it("fails when connector addresses mismatch", () => {
    const log = encodeStageLog("DepositLocked", [
      TX_ID,
      USER,
      RECEIVER,
      1000n,
      TOKEN_A,
      TOKEN_B,
      SOURCE_CONNECTOR,
      DEST_CONNECTOR,
      10,
      7n,
      31337n,
    ]);

    expect(() =>
      validateStageLog(
        "source-deposit",
        log,
        SOURCE_CONNECTOR,
        TX_ID,
        "0x9000000000000000000000000000000000000009",
        DEST_CONNECTOR,
      ),
    ).toThrow(/srcChainConnector mismatch/i);
  });
});
