import { Contract, JsonRpcProvider } from "ethers";
import { CONNECTOR_ABI } from "../contracts/abi.js";
import type { ChainConfig, Side, StageSubmissionConfig } from "../core/types.js";

/** The subset of a relay config that identifies both chains and their connectors. */
export type EndpointConfig = Pick<StageSubmissionConfig, "source" | "destination" | "connectors">;

export interface ChainEndpoint {
  chain: ChainConfig;
  connector: string;
}

/** Read-only handle on one side's connector. */
export interface ConnectorReader {
  address: string;
  provider: JsonRpcProvider;
  contract: Contract;
}

export const SIDES: readonly Side[] = ["source", "destination"];

export function endpointFor(config: EndpointConfig, side: Side): ChainEndpoint {
  return side === "source"
    ? { chain: config.source, connector: config.connectors.source }
    : { chain: config.destination, connector: config.connectors.destination };
}

export function createProvider(chain: ChainConfig): JsonRpcProvider {
  return new JsonRpcProvider(chain.rpcUrls[0], chain.chainId);
}

export function connectorReader(config: EndpointConfig, side: Side): ConnectorReader {
  const { chain, connector } = endpointFor(config, side);
  const provider = createProvider(chain);
  return {
    address: connector,
    provider,
    contract: new Contract(connector, CONNECTOR_ABI, provider),
  };
}

/** Read-only connector handles for both sides. Providers connect lazily on first use. */
export function connectorReaders(config: EndpointConfig): Record<Side, ConnectorReader> {
  return {
    source: connectorReader(config, "source"),
    destination: connectorReader(config, "destination"),
  };
}
