import { describe, expect, it } from "vitest";
import { AbiCoder } from "ethers";
import { decodeContractError } from "./contractErrors";

const abiCoder = AbiCoder.defaultAbiCoder();

describe("decodeContractError", () => {
  it("decodes WrappedTokenNotRegistered from ethers estimateGas errors", () => {
    const routeKey = "0x3b4ea7325588ab5a52bafac0688a94a2a92f2a2632a770b5c70d1a22ab8f1ecb";
    const message = decodeContractError({
      code: "CALL_EXCEPTION",
      action: "estimateGas",
      data: `0xc1c2aa5c${routeKey.slice(2)}`,
      transaction: {
        data: "0x21c53861",
      },
    });

    expect(message).toContain("Wrapped-token route is not registered");
    expect(message).toContain(routeKey);
    expect(message).toContain("make bootstrap");
  });

  it("decodes WrappedTokenMismatch with submitted and expected addresses", () => {
    const got = "0x1111111111111111111111111111111111111111";
    const expected = "0x2222222222222222222222222222222222222222";
    const payload = abiCoder.encode(["address", "address"], [got, expected]).slice(2);
    const message = decodeContractError({ error: { data: `0xd70f91f1${payload}` } });

    expect(message).toBe(
      `Destination token does not match the registered wrapped token. tokenTo=${got}, expected DEST_WRAPPED_TOKEN=${expected}.`,
    );
  });

  it("decodes NotAdmin from wrapped token connector mismatch failures", () => {
    const message = decodeContractError({ data: "0x7bfa4b9f" });

    expect(message).toContain("not authorized");
    expect(message).toContain("destination wrapped token");
    expect(message).toContain("current DEST_CONNECTOR");
  });
});
