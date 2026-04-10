import { describe, it, expect } from "vitest";
import { parseSchemeUrl, buildSchemeUrl } from "../../src/agent/scheme.js";

describe("parseSchemeUrl", () => {
  const VALID_URL =
    "trustless-client://start?txId=0xabc&sourceProfile=local-anvil&destinationProfile=local-hardhat&sourceConnector=0x1111111111111111111111111111111111111111&destinationConnector=0x2222222222222222222222222222222222222222";

  it("parses a valid URL", () => {
    const params = parseSchemeUrl(VALID_URL);
    expect(params.txId).toBe("0xabc");
    expect(params.sourceProfile).toBe("local-anvil");
    expect(params.destinationProfile).toBe("local-hardhat");
    expect(params.sourceConnector).toBe("0x1111111111111111111111111111111111111111");
    expect(params.destinationConnector).toBe("0x2222222222222222222222222222222222222222");
  });

  it("throws for a non-trustless-client scheme", () => {
    expect(() => parseSchemeUrl("https://example.com/start?txId=0x1")).toThrow("trustless-client");
  });

  it("throws for unexpected host", () => {
    expect(() =>
      parseSchemeUrl(
        "trustless-client://stop?txId=0x1&sourceProfile=p&destinationProfile=q&sourceConnector=0x1&destinationConnector=0x2",
      ),
    ).toThrow("Expected 'start'");
  });

  it("throws when required parameter is missing", () => {
    expect(() =>
      parseSchemeUrl(
        "trustless-client://start?sourceProfile=local-anvil&destinationProfile=local-hardhat&sourceConnector=0x1&destinationConnector=0x2",
      ),
    ).toThrow("txId");
  });

  it("throws for a completely invalid URL", () => {
    expect(() => parseSchemeUrl("not a url")).toThrow();
  });
});

describe("buildSchemeUrl", () => {
  it("round-trips through parseSchemeUrl", () => {
    const params = {
      txId: "0xdeadbeef",
      sourceProfile: "sepolia",
      destinationProfile: "chiado",
      sourceConnector: "0x1234",
      destinationConnector: "0x5678",
    };
    const url = buildSchemeUrl(params);
    const parsed = parseSchemeUrl(url);
    expect(parsed).toEqual(params);
  });
});
