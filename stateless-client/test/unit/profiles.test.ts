import { describe, expect, it } from "vitest";
import { resolveChainConfig } from "../../src/config/profiles.js";

describe("resolveChainConfig", () => {
  it("uses default local profiles when no explicit side config is provided", () => {
    const source = resolveChainConfig({
      side: "source",
      defaultProfileName: "local-anvil"
    });

    const destination = resolveChainConfig({
      side: "destination",
      defaultProfileName: "local-hardhat"
    });

    expect(source.profileName).toBe("local-anvil");
    expect(source.chainId).toBe(31337);
    expect(source.rpcUrls[0]).toBe("http://127.0.0.1:8545");

    expect(destination.profileName).toBe("local-hardhat");
    expect(destination.chainId).toBe(31338);
    expect(destination.rpcUrls[0]).toBe("http://127.0.0.1:8546");
  });

  it("applies explicit overrides over profile defaults with correct precedence", () => {
    const chain = resolveChainConfig({
      side: "source",
      defaultProfileName: "local-anvil",
      profileName: "sepolia",
      chainId: "11155112",
      rpcUrl: "https://override-single.example",
      rpcUrls: "https://override-csv-1.example,https://override-csv-2.example",
      proverUrls: "https://override-prover.example"
    });

    expect(chain.profileName).toBe("sepolia");
    expect(chain.chainId).toBe(11155112);
    expect(chain.rpcUrls).toEqual([
      "https://override-csv-1.example",
      "https://override-csv-2.example"
    ]);
    expect(chain.proverUrls).toEqual(["https://override-prover.example"]);
  });

  it("requires explicit chain id when no profile is selected", () => {
    expect(() =>
      resolveChainConfig({
        side: "source",
        defaultProfileName: "local-anvil",
        rpcUrl: "https://rpc.example"
      })
    ).toThrow(/chain id/i);
  });
});
