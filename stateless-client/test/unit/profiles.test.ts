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

  it("chiado profile places chiado.colibri-proof.tech first in beacon and checkpointz lists", () => {
    const chain = resolveChainConfig({
      side: "destination",
      defaultProfileName: "chiado"
    });

    expect(chain.chainId).toBe(10200);

    // prover: dedicated Chiado colibri node
    expect(chain.proverUrls[0]).toBe("https://chiado.colibri-proof.tech");

    // beacon: colibri first (bootstrap source), rpc-gbc second (fallback), publicnode third
    expect(chain.beaconUrls[0]).toBe("https://chiado.colibri-proof.tech");
    expect(chain.beaconUrls[1]).toBe("https://rpc-gbc.chiadochain.net");
    expect(chain.beaconUrls[2]).toBe("https://gnosis-chiado-beacon-api.publicnode.com");
    expect(chain.beaconUrls).toHaveLength(3);

    // checkpointz: colibri first, publicnode second; rpc-gbc must NOT appear
    // (it does not expose a compatible checkpointz API)
    expect(chain.checkpointzUrls[0]).toBe("https://chiado.colibri-proof.tech");
    expect(chain.checkpointzUrls[1]).toBe("https://gnosis-chiado-beacon-api.publicnode.com");
    expect(chain.checkpointzUrls).toHaveLength(2);
    expect(chain.checkpointzUrls).not.toContain("https://rpc-gbc.chiadochain.net");
  });
});
