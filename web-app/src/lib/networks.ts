export interface NetworkInfo {
  profile: string;
  name: string;
  chainId: number;
  rpcUrls: string[];
  blockExplorerUrls?: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface WalletAddEthereumChainParameter {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrls?: string[];
}

export const NETWORKS: Record<string, NetworkInfo> = {
  "local-anvil": {
    profile: "local-anvil",
    name: "Local Anvil",
    chainId: 31337,
    rpcUrls: ["http://127.0.0.1:8545"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  "local-hardhat": {
    profile: "local-hardhat",
    name: "Local Hardhat",
    chainId: 31338,
    rpcUrls: ["http://127.0.0.1:8546"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  sepolia: {
    profile: "sepolia",
    name: "Sepolia",
    chainId: 11155111,
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
    nativeCurrency: { name: "Sepolia Ether", symbol: "SEP", decimals: 18 },
  },
  holesky: {
    profile: "holesky",
    name: "Holesky",
    chainId: 17000,
    rpcUrls: ["https://ethereum-holesky-rpc.publicnode.com"],
    blockExplorerUrls: ["https://holesky.etherscan.io"],
    nativeCurrency: { name: "Holesky Ether", symbol: "ETH", decimals: 18 },
  },
  hoodi: {
    profile: "hoodi",
    name: "Hoodi",
    chainId: 560048,
    rpcUrls: ["https://ethereum-hoodi-rpc.publicnode.com"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  gnosis: {
    profile: "gnosis",
    name: "Gnosis",
    chainId: 100,
    rpcUrls: ["https://rpc.ankr.com/gnosis"],
    blockExplorerUrls: ["https://gnosisscan.io"],
    nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18 },
  },
  chiado: {
    profile: "chiado",
    name: "Chiado",
    chainId: 10200,
    rpcUrls: ["https://gnosis-chiado-rpc.publicnode.com"],
    blockExplorerUrls: ["https://gnosis-chiado.blockscout.com"],
    nativeCurrency: { name: "Chiado xDAI", symbol: "xDAI", decimals: 18 },
  },
};

const NETWORKS_BY_CHAIN_ID = new Map<number, NetworkInfo>(
  Object.values(NETWORKS).map((network) => [network.chainId, network]),
);

export const NETWORK_OPTIONS = Object.keys(NETWORKS).filter((profile) => !profile.startsWith("local-"));

export function getChainId(profile: string): number {
  return NETWORKS[profile]?.chainId ?? 0;
}

export function toHexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

export function getNetworkByChainId(chainId: number): NetworkInfo | undefined {
  return NETWORKS_BY_CHAIN_ID.get(chainId);
}

export function getAddChainParams(chainId: number): WalletAddEthereumChainParameter | undefined {
  const network = getNetworkByChainId(chainId);
  if (!network) return undefined;
  return {
    chainId: toHexChainId(network.chainId),
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    blockExplorerUrls: network.blockExplorerUrls,
    nativeCurrency: network.nativeCurrency,
  };
}
