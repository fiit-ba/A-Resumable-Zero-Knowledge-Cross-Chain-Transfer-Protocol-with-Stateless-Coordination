import { describe, expect, it } from "vitest";
import { getNetworkProfile, resolveChainConfig } from "../../src/config/profiles.js";

describe("resolveChainConfig", () => {
  it("uses default local profiles when no explicit side config is provided", () => {
    const source = resolveChainConfig({
      side: "source",
      defaultProfileName: "local-anvil",
    });

    const destination = resolveChainConfig({
      side: "destination",
      defaultProfileName: "local-hardhat",
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
      proverUrls: "https://override-prover.example",
    });

    expect(chain.profileName).toBe("sepolia");
    expect(chain.chainId).toBe(11155112);
    expect(chain.rpcUrls).toEqual([
      "https://override-csv-1.example",
      "https://override-csv-2.example",
    ]);
    expect(chain.proverUrls).toEqual(["https://override-prover.example"]);
  });

  it("requires explicit chain id when no profile is selected", () => {
    expect(() =>
      resolveChainConfig({
        side: "source",
        defaultProfileName: "local-anvil",
        rpcUrl: "https://rpc.example",
      }),
    ).toThrow(/chain id/i);
  });

  it("chiado profile places chiado.colibri-proof.tech first in beacon and checkpointz lists", () => {
    const chain = resolveChainConfig({
      side: "destination",
      defaultProfileName: "chiado",
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

describe("resolveChainConfig with the custom profile", () => {
  const TAIKO_HOODI = {
    side: "source" as const,
    defaultProfileName: "local-anvil" as const,
    profileName: "custom",
    chainId: "167013",
    rpcUrl: "https://rpc.hoodi.taiko.xyz",
  };

  it("takes the chain id and RPC only from the explicit options", () => {
    const chain = resolveChainConfig(TAIKO_HOODI);

    expect(chain.profileName).toBe("custom");
    expect(chain.isLocal).toBe(false);
    expect(chain.chainId).toBe(167013);
    expect(chain.rpcUrls).toEqual(["https://rpc.hoodi.taiko.xyz"]);
    expect(chain.proverUrls).toEqual([]);
    expect(chain.beaconUrls).toEqual([]);
    expect(chain.rpcFallback).toBe(false);
  });

  it("allows the RPC fallback for a custom public network only when asked", () => {
    expect(resolveChainConfig({ ...TAIKO_HOODI, allowRpcFallback: true }).rpcFallback).toBe(true);
  });

  it("keeps Colibri for a network it supports even with the RPC fallback allowed", () => {
    for (const profileName of ["mainnet", "sepolia", "gnosis", "chiado"]) {
      const chain = resolveChainConfig({
        side: "source",
        defaultProfileName: "local-anvil",
        profileName,
        allowRpcFallback: true,
      });

      expect(chain.rpcFallback).toBe(false);
    }
  });

  it("allows the RPC fallback for a built-in profile Colibri does not support only when asked", () => {
    for (const profileName of ["holesky", "hoodi"]) {
      const profile = { side: "source" as const, defaultProfileName: "local-anvil" as const };

      expect(resolveChainConfig({ ...profile, profileName }).rpcFallback).toBe(false);
      expect(
        resolveChainConfig({ ...profile, profileName, allowRpcFallback: true }).rpcFallback,
      ).toBe(true);
    }
  });

  it("allows the RPC fallback for Hoodi's chain id given under the custom profile", () => {
    const hoodiAsCustom = { ...TAIKO_HOODI, chainId: "560048", allowRpcFallback: true };

    expect(resolveChainConfig(hoodiAsCustom).rpcFallback).toBe(true);
  });

  it("keeps Colibri for the chain id of a network it supports given under the custom profile", () => {
    const sepoliaAsCustom = { ...TAIKO_HOODI, chainId: "11155111", allowRpcFallback: true };

    expect(resolveChainConfig(sepoliaAsCustom).rpcFallback).toBe(false);
    expect(resolveChainConfig({ ...sepoliaAsCustom, profileName: undefined }).rpcFallback).toBe(
      false,
    );
  });

  it("treats an explicit chain id and RPC without a profile name as the custom profile", () => {
    const chain = resolveChainConfig({
      ...TAIKO_HOODI,
      profileName: undefined,
      allowRpcFallback: true,
    });

    expect(chain.profileName).toBe("custom");
    expect(chain.rpcFallback).toBe(true);
  });

  it("treats a custom network on a local RPC as a local chain", () => {
    const chain = resolveChainConfig({
      ...TAIKO_HOODI,
      rpcUrl: "http://127.0.0.1:28545",
      allowRpcFallback: true,
    });

    expect(chain.isLocal).toBe(true);
    expect(chain.rpcFallback).toBe(false);
  });

  it("requires an explicit chain id and RPC for the custom profile", () => {
    expect(() => resolveChainConfig({ ...TAIKO_HOODI, chainId: undefined })).toThrow(/chain id/i);
    expect(() => resolveChainConfig({ ...TAIKO_HOODI, rpcUrl: undefined })).toThrow(/RPC URL/i);
    expect(() =>
      resolveChainConfig({ ...TAIKO_HOODI, chainId: undefined, rpcUrl: undefined }),
    ).toThrow("The custom source profile needs --source-chain-id and --source-rpc-url.");
  });

  it("lists custom among the supported profiles", () => {
    expect(() => getNetworkProfile("taiko")).toThrow(/Supported profiles: .*chiado, custom$/);
  });
});
