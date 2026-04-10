import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isBlockNotSignedYetError,
  isExceedMaximumBlockRangeError,
  isFinalizedCheckpointBootstrapError,
  isChiadoSyncBackwardsFallbackAllowed,
  isParentBeaconSuccessorBlockMissingError,
  isTransientSszBootstrapError,
  isSyncBackwardsError,
} from "../../src/relay/verification.js";

describe("isSyncBackwardsError", () => {
  it("returns true for the canonical sync-backwards message", () => {
    const err = new Error(
      "last sync state is higher than the required period: cannot sync backwards",
    );
    expect(isSyncBackwardsError(err)).toBe(true);
  });

  it("returns true when both substrings appear anywhere in the message", () => {
    const err = new Error(
      "Colibri error: last sync state is higher than period 42, cannot sync backwards to period 40",
    );
    expect(isSyncBackwardsError(err)).toBe(true);
  });

  it("returns false when only one substring matches", () => {
    const err = new Error("last sync state is higher than the required period");
    expect(isSyncBackwardsError(err)).toBe(false);
  });

  it("returns false for an unrelated error", () => {
    const err = new Error("connection refused");
    expect(isSyncBackwardsError(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isSyncBackwardsError("some string")).toBe(false);
    expect(isSyncBackwardsError(null)).toBe(false);
    expect(isSyncBackwardsError(42)).toBe(false);
  });
});

describe("isChiadoSyncBackwardsFallbackAllowed", () => {
  const ENV_KEY = "STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK";

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns true for Chiado (10200) when env is unset", () => {
    expect(isChiadoSyncBackwardsFallbackAllowed(10200)).toBe(true);
  });

  it("returns true for Chiado when env is empty string", () => {
    process.env[ENV_KEY] = "";
    expect(isChiadoSyncBackwardsFallbackAllowed(10200)).toBe(true);
  });

  it("returns true for Chiado when env is '1'", () => {
    process.env[ENV_KEY] = "1";
    expect(isChiadoSyncBackwardsFallbackAllowed(10200)).toBe(true);
  });

  it("returns true for Chiado when env is 'true'", () => {
    process.env[ENV_KEY] = "true";
    expect(isChiadoSyncBackwardsFallbackAllowed(10200)).toBe(true);
  });

  it("returns true for Chiado when env is 'TRUE' (case-insensitive)", () => {
    process.env[ENV_KEY] = "TRUE";
    expect(isChiadoSyncBackwardsFallbackAllowed(10200)).toBe(true);
  });

  it("returns false for Chiado when env is '0' (force disabled)", () => {
    process.env[ENV_KEY] = "0";
    expect(isChiadoSyncBackwardsFallbackAllowed(10200)).toBe(false);
  });

  it("returns false for Chiado when env is 'false'", () => {
    process.env[ENV_KEY] = "false";
    expect(isChiadoSyncBackwardsFallbackAllowed(10200)).toBe(false);
  });

  it("returns false for non-Chiado chain even when env is unset", () => {
    expect(isChiadoSyncBackwardsFallbackAllowed(1)).toBe(false);
  });

  it("returns false for non-Chiado chain even when env is '1'", () => {
    process.env[ENV_KEY] = "1";
    expect(isChiadoSyncBackwardsFallbackAllowed(1)).toBe(false);
  });

  it("returns false for local dev chain 31337", () => {
    expect(isChiadoSyncBackwardsFallbackAllowed(31337)).toBe(false);
  });
});

describe("isFinalizedCheckpointBootstrapError", () => {
  it("returns true for finalized-checkpoint bootstrap NOT_FOUND error", () => {
    const err = new Error(
      '(404)  : {"code":404,"message":"NOT_FOUND: Sync committee branch for block root 0xabc not found. This typically occurs when the block is not a finalized checkpoint. Light client bootstrap is only supported for finalized checkpoint block roots."}',
    );
    expect(isFinalizedCheckpointBootstrapError(err)).toBe(true);
  });

  it("returns false for unrelated Colibri errors", () => {
    const err = new Error("parentBeaconBlockRoot missing for requested block");
    expect(isFinalizedCheckpointBootstrapError(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isFinalizedCheckpointBootstrapError("NOT_FOUND")).toBe(false);
    expect(isFinalizedCheckpointBootstrapError(null)).toBe(false);
  });
});

describe("isParentBeaconSuccessorBlockMissingError", () => {
  it("returns true for parentBeaconBlockRoot successor-missing error", () => {
    const err = new Error(
      "The Block after 10520082, which should contain the parentBeaconBlockRoot for the data block can not be found in the execution layer!",
    );
    expect(isParentBeaconSuccessorBlockMissingError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    const err = new Error("connection timeout");
    expect(isParentBeaconSuccessorBlockMissingError(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isParentBeaconSuccessorBlockMissingError("parentBeaconBlockRoot")).toBe(false);
    expect(isParentBeaconSuccessorBlockMissingError(undefined)).toBe(false);
  });
});

describe("isBlockNotSignedYetError", () => {
  it("returns true for the canonical unsigned-block message", () => {
    const err = new Error("The requested block has not been signed yet and cannot be verified!!");
    expect(isBlockNotSignedYetError(err)).toBe(true);
  });

  it("returns true for alternative unsigned-block phrasing", () => {
    const err = new Error("requested block has not been signed yet");
    expect(isBlockNotSignedYetError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    const err = new Error("connection timeout");
    expect(isBlockNotSignedYetError(err)).toBe(false);
  });
});

describe("isTransientSszBootstrapError", () => {
  it("returns true for invalid offset parse errors", () => {
    const err = new Error("Invalid offset for container");
    expect(isTransientSszBootstrapError(err)).toBe(true);
  });

  it("returns true for list offset parse errors", () => {
    const err = new Error("Invalid offset for list");
    expect(isTransientSszBootstrapError(err)).toBe(true);
  });

  it("returns true for malformed duplicated invalid list offset errors", () => {
    const err = new Error("Invalid Invalid  offset for list");
    expect(isTransientSszBootstrapError(err)).toBe(true);
  });

  it("returns true for invalid SSZ bootstrap structure errors", () => {
    const err = new Error("Invalid SSZ structure in bootstrap data");
    expect(isTransientSszBootstrapError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    const err = new Error("parentBeaconBlockRoot missing");
    expect(isTransientSszBootstrapError(err)).toBe(false);
  });
});

describe("isExceedMaximumBlockRangeError", () => {
  it("returns true for eth_getLogs maximum-range errors", () => {
    const err = new Error(
      "Error when calling eth-rpc for eth_getLogs (params: [...]) : exceed maximum block range: 50000",
    );
    expect(isExceedMaximumBlockRangeError(err)).toBe(true);
  });

  it("returns false for non-getLogs maximum-range errors", () => {
    const err = new Error("maximum block range exceeded");
    expect(isExceedMaximumBlockRangeError(err)).toBe(false);
  });
});
