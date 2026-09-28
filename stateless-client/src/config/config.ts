import fs from "node:fs";
import path from "node:path";
import type {
  BlockTagInput,
  ChainConfig,
  NetworkProfileName,
  ProofBackend,
  ProofPaths,
  RelayConfig,
  Side,
  StageExecutionBlocks,
  VerificationConfig,
} from "../core/types.js";
import { resolveChainConfig } from "./profiles.js";
import { normalizeAddress, normalizeBlockTag, normalizeBytes32 } from "../core/utils.js";

export type CliOptions = Record<string, string | boolean | undefined>;

/** Default location of every proof path, relative to zk-proofs/risc_zero. */
const DEFAULT_PROOF_PATHS: Record<keyof ProofPaths, string> = {
  lockWorkspace: "lock_event",
  mintWorkspace: "mint_event",
  ackWorkspace: "ack_event",
  refundClaimWorkspace: "refund_claim_event",
  burnWorkspace: "burn_event",
  nonAcceptWorkspace: "non_accept_event",
  lockDockerScript: "lock_event/scripts/prove-lock-docker.sh",
  mintDockerScript: "mint_event/scripts/prove-mint-docker.sh",
  ackDockerScript: "ack_event/scripts/prove-ack-docker.sh",
  refundClaimDockerScript: "refund_claim_event/scripts/prove-refund-claim-docker.sh",
  burnDockerScript: "burn_event/scripts/prove-burn-docker.sh",
  nonAcceptDockerScript: "non_accept_event/scripts/prove-non-accept-docker.sh",
};

/** CLI option that overrides each proof path. */
export const PROOF_PATH_OPTIONS: Record<keyof ProofPaths, string> = {
  lockWorkspace: "lock-workspace",
  mintWorkspace: "mint-workspace",
  ackWorkspace: "ack-workspace",
  refundClaimWorkspace: "refund-claim-workspace",
  burnWorkspace: "burn-workspace",
  nonAcceptWorkspace: "non-accept-workspace",
  lockDockerScript: "lock-docker-script",
  mintDockerScript: "mint-docker-script",
  ackDockerScript: "ack-docker-script",
  refundClaimDockerScript: "refund-claim-docker-script",
  burnDockerScript: "burn-docker-script",
  nonAcceptDockerScript: "non-accept-docker-script",
};

/** CLI option that overrides the execution block for each verified stage. */
export const EXECUTION_BLOCK_OPTIONS: Record<keyof StageExecutionBlocks, string> = {
  sourceDeposit: "lock-execution-block",
  destinationFundsReleased: "mint-execution-block",
  sourceAckReady: "ack-execution-block",
  sourceRefundInitiated: "refund-claim-execution-block",
  destinationBurnExecuted: "burn-proof-execution-block",
  destinationNonAccept: "non-accept-execution-block",
};

const DEFAULT_PROFILE_BY_SIDE: Record<Side, NetworkProfileName> = {
  source: "local-anvil",
  destination: "local-hardhat",
};

function typedEntries<K extends string, V>(record: Record<K, V>): [K, V][] {
  return Object.entries(record) as [K, V][];
}

function getStringOption(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function requireStringOption(options: CliOptions, key: string): string {
  const value = getStringOption(options, key);
  if (!value) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

function resolveExecutionBlocks(options: CliOptions): StageExecutionBlocks {
  const global = parseBlockOption(options, "execution-block");
  const blocks: StageExecutionBlocks = {};
  for (const [key, option] of typedEntries(EXECUTION_BLOCK_OPTIONS)) {
    blocks[key] = parseBlockOption(options, option, global);
  }
  return blocks;
}

function parseBlockOption(
  options: CliOptions,
  key: string,
  fallback?: BlockTagInput,
): BlockTagInput | undefined {
  const value = getStringOption(options, key);
  if (value === undefined) {
    return fallback;
  }
  return normalizeBlockTag(value, fallback ?? "latest");
}

function isRepoRoot(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "zk-proofs", "risc_zero", "lock_event")) &&
    fs.existsSync(path.join(candidate, "zk-proofs", "risc_zero", "mint_event")) &&
    fs.existsSync(path.join(candidate, "zk-proofs", "risc_zero", "ack_event"))
    // The refund-path workspaces are optional; their absence degrades gracefully.
  );
}

export function discoverRepoRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);

  while (true) {
    if (isRepoRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(
    "Could not discover repository root containing zk-proofs/risc_zero/*_event. Pass --repo-root explicitly.",
  );
}

function mapProofPaths(resolve: (key: keyof ProofPaths) => string): ProofPaths {
  const paths = {} as ProofPaths;
  for (const [key] of typedEntries(DEFAULT_PROOF_PATHS)) {
    paths[key] = resolve(key);
  }
  return paths;
}

export function defaultProofPaths(repoRoot: string): ProofPaths {
  const proofsRoot = path.join(repoRoot, "zk-proofs", "risc_zero");
  return mapProofPaths((key) => path.join(proofsRoot, DEFAULT_PROOF_PATHS[key]));
}

function resolveProofPaths(options: CliOptions, repoRoot: string): ProofPaths {
  const defaults = defaultProofPaths(repoRoot);
  return mapProofPaths((key) => getStringOption(options, PROOF_PATH_OPTIONS[key]) ?? defaults[key]);
}

function resolveSideChainConfig(options: CliOptions, side: Side): ChainConfig {
  const option = (name: string) => getStringOption(options, `${side}-${name}`);
  return resolveChainConfig({
    side,
    profileName: option("profile"),
    chainId: option("chain-id"),
    rpcUrl: option("rpc-url"),
    rpcUrls: option("rpc-urls"),
    proverUrls: option("prover-urls") ?? getStringOption(options, "prover-urls"),
    beaconUrls: option("beacon-urls") ?? getStringOption(options, "beacon-urls"),
    checkpointzUrls: option("checkpointz-urls") ?? getStringOption(options, "checkpointz-urls"),
    defaultProfileName: DEFAULT_PROFILE_BY_SIDE[side],
  });
}

export function resolveVerificationConfig(options: CliOptions): VerificationConfig {
  return {
    source: resolveSideChainConfig(options, "source"),
    destination: resolveSideChainConfig(options, "destination"),
    txId: normalizeBytes32(requireStringOption(options, "tx-id"), "tx-id"),
    connectors: {
      source: normalizeAddress(
        requireStringOption(options, "source-connector"),
        "source-connector",
      ),
      destination: normalizeAddress(
        requireStringOption(options, "destination-connector"),
        "destination-connector",
      ),
    },
    executionBlocks: resolveExecutionBlocks(options),
  };
}

function resolveProofBackend(options: CliOptions): ProofBackend {
  const backend = requireStringOption(options, "proof-backend");
  if (backend !== "local" && backend !== "docker") {
    throw new Error(`Unsupported --proof-backend '${backend}'. Expected 'local' or 'docker'.`);
  }
  return backend;
}

function resolveRisc0ProverMode(options: CliOptions): "local" | "bonsai" {
  const value = getStringOption(options, "risc0-prover-mode") ?? "local";
  if (value !== "local" && value !== "bonsai") {
    throw new Error(`Unsupported --risc0-prover-mode '${value}'. Expected 'local' or 'bonsai'.`);
  }
  return value;
}

export function resolveRelayConfig(options: CliOptions): RelayConfig {
  const shared = resolveVerificationConfig(options);

  const repoRootOption = getStringOption(options, "repo-root");
  const repoRoot = repoRootOption ? path.resolve(repoRootOption) : discoverRepoRoot(process.cwd());

  const signerPrivateKey = requireStringOption(options, "private-key");

  return {
    ...shared,
    signerPrivateKey,
    proofBackend: resolveProofBackend(options),
    repoRoot,
    proofPaths: resolveProofPaths(options, repoRoot),
    risc0ProverMode: resolveRisc0ProverMode(options),
  };
}
