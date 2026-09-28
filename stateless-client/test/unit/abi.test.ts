import { describe, expect, it } from "vitest";
import { connectorInterface, describeConnectorRevert } from "../../src/contracts/abi.js";

describe("describeConnectorRevert", () => {
  it("names connector custom errors carried in revert data", () => {
    const data = connectorInterface.encodeErrorResult("AckWindowExpired", [1_000n, 2_000n]);
    expect(describeConnectorRevert({ data })).toBe("AckWindowExpired(1000, 2000)");
  });

  it("ignores unknown selectors and errors without revert data", () => {
    expect(describeConnectorRevert({ data: "0xdeadbeef" })).toBeUndefined();
    expect(describeConnectorRevert(new Error("network down"))).toBeUndefined();
    expect(describeConnectorRevert(null)).toBeUndefined();
  });
});
