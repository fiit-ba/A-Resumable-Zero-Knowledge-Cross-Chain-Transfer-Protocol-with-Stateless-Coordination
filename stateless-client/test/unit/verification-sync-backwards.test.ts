import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isChiadoSyncBackwardsFallbackAllowed,
  isSyncBackwardsError
} from "../../src/relay/verification.js";

describe("isSyncBackwardsError", () => {
  it("returns true for the canonical sync-backwards message", () => {
    const err = new Error(
      "last sync state is higher than the required period: cannot sync backwards"
    );
    expect(isSyncBackwardsError(err)).toBe(true);
  });

  it("returns true when both substrings appear anywhere in the message", () => {
    const err = new Error(
      "Colibri error: last sync state is higher than period 42, cannot sync backwards to period 40"
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
