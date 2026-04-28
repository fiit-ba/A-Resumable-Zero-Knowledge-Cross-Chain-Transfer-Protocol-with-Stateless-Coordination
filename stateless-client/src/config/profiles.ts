import type { ChainConfig, NetworkProfileName, Side } from "../core/types.js";
import { isLikelyLocalRpcUrl, parseChainId, parseCsv } from "../core/utils.js";

export interface NetworkProfileDefaults {
  name: NetworkProfileName;
  chainId: number;
  isLocal: boolean;
  rpcUrls: string[];
  proverUrls: string[];
  beaconUrls: string[];
  checkpointzUrls: string[];
}

interface ChainResolveInput {
  side: Side;
  profileName?: string;
  chainId?: string;
  rpcUrls?: string;
  rpcUrl?: string;
  proverUrls?: string;
  beaconUrls?: string;
  checkpointzUrls?: string;
  defaultProfileName: NetworkProfileName;
}

export const NETWORK_PROFILES: Record<NetworkProfileName, NetworkProfileDefaults> = {
  "local-anvil": {
    name: "local-anvil",
    chainId: 31337,
    isLocal: true,
    rpcUrls: ["http://127.0.0.1:8545"],
    proverUrls: [],
    beaconUrls: [],
    checkpointzUrls: [],
  },
  "local-hardhat": {
    name: "local-hardhat",
    chainId: 31338,
    isLocal: true,
    rpcUrls: ["http://127.0.0.1:8546"],
    proverUrls: [],
    beaconUrls: [],
    checkpointzUrls: [],
  },
  mainnet: {
    name: "mainnet",
    chainId: 1,
    isLocal: false,
    rpcUrls: ["https://mainnet1.colibri-proof.tech/execution"],
    proverUrls: ["https://mainnet1.colibri-proof.tech"],
    beaconUrls: ["https://mainnet1.colibri-proof.tech/consensus/"],
    checkpointzUrls: [],
  },
  sepolia: {
    name: "sepolia",
    chainId: 11155111,
    isLocal: false,
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    proverUrls: ["https://sepolia.colibri-proof.tech"],
    beaconUrls: [
      "https://sepolia.colibri-proof.tech/consensus/",
      "https://ethereum-sepolia-beacon-api.publicnode.com",
    ],
    checkpointzUrls: [
      "https://sepolia.colibri-proof.tech/consensus/",
      "https://ethereum-sepolia-beacon-api.publicnode.com",
    ],
  },
  holesky: {
    name: "holesky",
    chainId: 17000,
    isLocal: false,
    rpcUrls: ["https://ethereum-holesky-rpc.publicnode.com"],
    proverUrls: [],
    beaconUrls: ["https://ethereum-holesky-beacon-api.publicnode.com"],
    checkpointzUrls: [],
  },
  hoodi: {
    name: "hoodi",
    chainId: 560048,
    isLocal: false,
    rpcUrls: ["https://ethereum-hoodi-rpc.publicnode.com"],
    proverUrls: [],
    beaconUrls: ["https://ethereum-hoodi-beacon-api.publicnode.com"],
    checkpointzUrls: [],
  },
  gnosis: {
    name: "gnosis",
    chainId: 100,
    isLocal: false,
    rpcUrls: ["https://rpc.ankr.com/gnosis"],
    proverUrls: ["https://gnosis.colibri-proof.tech"],
    beaconUrls: ["https://gnosis.colibri-proof.tech"],
    checkpointzUrls: [],
  },
  chiado: {
    name: "chiado",
    chainId: 10200,
    isLocal: false,
    rpcUrls: ["https://gnosis-chiado-rpc.publicnode.com"],
    proverUrls: ["https://chiado.colibri-proof.tech"],
    // The first entry in beaconUrls and checkpointzUrls MUST be the same host so
    // that Colibri bootstraps from the same source it uses for finality updates —
    // a mismatch causes sync-backwards.  chiado.colibri-proof.tech is the
    // dedicated Colibri prover/beacon for Chiado; rpc-gbc.chiadochain.net is
    // kept as a secondary beacon fallback only.
    beaconUrls: [
      "https://chiado.colibri-proof.tech",
      "https://rpc-gbc.chiadochain.net",
      "https://gnosis-chiado-beacon-api.publicnode.com",
    ],
    checkpointzUrls: [
      "https://chiado.colibri-proof.tech",
      "https://gnosis-chiado-beacon-api.publicnode.com",
    ],
  },
};

export function listNetworkProfiles(): NetworkProfileDefaults[] {
  return Object.values(NETWORK_PROFILES);
}

export function getNetworkProfile(profileName: string): NetworkProfileDefaults {
  if (!(profileName in NETWORK_PROFILES)) {
    throw new Error(
      `Unsupported network profile '${profileName}'. Supported profiles: ${Object.keys(
        NETWORK_PROFILES,
      ).join(", ")}`,
    );
  }
  return NETWORK_PROFILES[profileName as NetworkProfileName];
}

export function resolveChainConfig(input: ChainResolveInput): ChainConfig {
  const hasAnyExplicitOverride = Boolean(
    input.chainId ||
    input.rpcUrl ||
    input.rpcUrls ||
    input.proverUrls ||
    input.beaconUrls ||
    input.checkpointzUrls,
  );

  const selectedProfileName =
    input.profileName ?? (hasAnyExplicitOverride ? undefined : input.defaultProfileName);
  const baseProfile = selectedProfileName ? getNetworkProfile(selectedProfileName) : undefined;

  if (!baseProfile && !hasAnyExplicitOverride) {
    throw new Error(
      `No ${input.side} profile or explicit ${input.side} chain configuration provided.`,
    );
  }

  const rpcOverrides = parseCsv(input.rpcUrls);
  const proverOverrides = parseCsv(input.proverUrls);
  const beaconOverrides = parseCsv(input.beaconUrls);
  const checkpointzOverrides = parseCsv(input.checkpointzUrls);

  const rpcUrls =
    rpcOverrides.length > 0
      ? rpcOverrides
      : input.rpcUrl
        ? [input.rpcUrl]
        : (baseProfile?.rpcUrls ?? []);

  if (rpcUrls.length === 0) {
    throw new Error(
      `No ${input.side} RPC URL configured. Use --${input.side}-rpc-url or --${input.side}-rpc-urls.`,
    );
  }

  const chainIdText = input.chainId ?? (baseProfile ? String(baseProfile.chainId) : undefined);
  if (!chainIdText) {
    throw new Error(
      `No ${input.side} chain id configured. Use --${input.side}-chain-id or --${input.side}-profile.`,
    );
  }

  const chainId = parseChainId(chainIdText, `${input.side} chain id`);

  const profileName = baseProfile?.name ?? "custom";
  const isLocal =
    baseProfile?.isLocal ??
    (chainId === 31337 || chainId === 31338 || rpcUrls.some((url) => isLikelyLocalRpcUrl(url)));

  return {
    side: input.side,
    profileName,
    isLocal,
    chainId,
    rpcUrls,
    proverUrls: proverOverrides.length > 0 ? proverOverrides : (baseProfile?.proverUrls ?? []),
    beaconUrls: beaconOverrides.length > 0 ? beaconOverrides : (baseProfile?.beaconUrls ?? []),
    checkpointzUrls:
      checkpointzOverrides.length > 0 ? checkpointzOverrides : (baseProfile?.checkpointzUrls ?? []),
  };
}
