import { MethodType } from "@corpus-core/colibri-stateless";
import { describe, expect, it } from "vitest";
import { decideVerificationMode } from "../../src/relay/verification.js";

describe("decideVerificationMode", () => {
  it("selects Colibri mode when both methods are proofable", () => {
    const mode = decideVerificationMode({
      isLocal: false,
      getLogsSupport: MethodType.PROOFABLE,
      ethCallSupport: MethodType.PROOFABLE
    });

    expect(mode).toBe("colibri");
  });

  it("falls back to RPC in local mode when either method is not proofable", () => {
    const mode = decideVerificationMode({
      isLocal: true,
      getLogsSupport: MethodType.NOT_SUPPORTED,
      ethCallSupport: MethodType.PROOFABLE
    });

    expect(mode).toBe("rpc-fallback");
  });

  it("fails on non-local chains when methods are not proofable", () => {
    expect(() =>
      decideVerificationMode({
        isLocal: false,
        getLogsSupport: MethodType.UNPROOFABLE,
        ethCallSupport: MethodType.PROOFABLE
      })
    ).toThrow(/non-local chain/i);
  });
});
