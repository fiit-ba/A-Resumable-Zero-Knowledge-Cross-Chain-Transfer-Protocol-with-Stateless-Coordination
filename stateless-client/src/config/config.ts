import fs from "node:fs";
import path from "node:path";
import type {
  BlockTagInput,
  ProofBackend,
  ProofPaths,
  RelayConfig,
  StageExecutionBlocks,
  VerificationConfig,
} from "../core/types.js";
import { resolveChainConfig } from "./profiles.js";
import { normalizeAddress, normalizeBlockTag, normalizeBytes32 } from "../core/utils.js";

export type CliOptions = Record<string, string | boolean | undefined>;

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

  return {
    sourceDeposit: parseBlockOption(options, "lock-execution-block", global),
    destinationFundsReleased: parseBlockOption(options, "mint-execution-block", global),
    sourceAckReady: parseBlockOption(options, "ack-execution-block", global),
    sourceRefundInitiated: parseBlockOption(options, "refund-claim-execution-block", global),
    destinationBurnExecuted: parseBlockOption(options, "burn-proof-execution-block", global),
  };
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
    // refund_claim_event and burn_event are optional; their absence degrades gracefully.
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

export function defaultProofPaths(repoRoot: string): ProofPaths {
  const rz = path.join(repoRoot, "zk-proofs", "risc_zero");
  return {
    lockWorkspace: path.join(rz, "lock_event"),
    mintWorkspace: path.join(rz, "mint_event"),
    ackWorkspace: path.join(rz, "ack_event"),
    refundClaimWorkspace: path.join(rz, "refund_claim_event"),
    burnWorkspace: path.join(rz, "burn_event"),
    lockDockerScript: path.join(rz, "lock_event", "scripts", "prove-lock-docker.sh"),
    mintDockerScript: path.join(rz, "mint_event", "scripts", "prove-mint-docker.sh"),
    ackDockerScript: path.join(rz, "ack_event", "scripts", "prove-ack-docker.sh"),
    refundClaimDockerScript: path.join(
      rz,
      "refund_claim_event",
      "scripts",
      "prove-refund-claim-docker.sh",
    ),
    burnDockerScript: path.join(rz, "burn_event", "scripts", "prove-burn-docker.sh"),
  };
}

function resolveProofPaths(options: CliOptions, repoRoot: string): ProofPaths {
  const defaults = defaultProofPaths(repoRoot);
  return {
    lockWorkspace: getStringOption(options, "lock-workspace") ?? defaults.lockWorkspace,
    mintWorkspace: getStringOption(options, "mint-workspace") ?? defaults.mintWorkspace,
    ackWorkspace: getStringOption(options, "ack-workspace") ?? defaults.ackWorkspace,
    refundClaimWorkspace:
      getStringOption(options, "refund-claim-workspace") ?? defaults.refundClaimWorkspace,
    burnWorkspace: getStringOption(options, "burn-workspace") ?? defaults.burnWorkspace,
    lockDockerScript: getStringOption(options, "lock-docker-script") ?? defaults.lockDockerScript,
    mintDockerScript: getStringOption(options, "mint-docker-script") ?? defaults.mintDockerScript,
    ackDockerScript: getStringOption(options, "ack-docker-script") ?? defaults.ackDockerScript,
    refundClaimDockerScript:
      getStringOption(options, "refund-claim-docker-script") ?? defaults.refundClaimDockerScript,
    burnDockerScript: getStringOption(options, "burn-docker-script") ?? defaults.burnDockerScript,
  };
}

function resolveSharedConfig(options: CliOptions): VerificationConfig {
  const sourceProfile = getStringOption(options, "source-profile");
  const destinationProfile = getStringOption(options, "destination-profile");

  const globalProverUrls = getStringOption(options, "prover-urls");
  const globalBeaconUrls = getStringOption(options, "beacon-urls");
  const globalCheckpointzUrls = getStringOption(options, "checkpointz-urls");

  const source = resolveChainConfig({
    side: "source",
    profileName: sourceProfile,
    chainId: getStringOption(options, "source-chain-id"),
    rpcUrl: getStringOption(options, "source-rpc-url"),
    rpcUrls: getStringOption(options, "source-rpc-urls"),
    proverUrls: getStringOption(options, "source-prover-urls") ?? globalProverUrls,
    beaconUrls: getStringOption(options, "source-beacon-urls") ?? globalBeaconUrls,
    checkpointzUrls: getStringOption(options, "source-checkpointz-urls") ?? globalCheckpointzUrls,
    defaultProfileName: "local-anvil",
  });

  const destination = resolveChainConfig({
    side: "destination",
    profileName: destinationProfile,
    chainId: getStringOption(options, "destination-chain-id"),
    rpcUrl: getStringOption(options, "destination-rpc-url"),
    rpcUrls: getStringOption(options, "destination-rpc-urls"),
    proverUrls: getStringOption(options, "destination-prover-urls") ?? globalProverUrls,
    beaconUrls: getStringOption(options, "destination-beacon-urls") ?? globalBeaconUrls,
    checkpointzUrls:
      getStringOption(options, "destination-checkpointz-urls") ?? globalCheckpointzUrls,
    defaultProfileName: "local-hardhat",
  });

  const txId = normalizeBytes32(requireStringOption(options, "tx-id"), "tx-id");

  const sourceConnector = normalizeAddress(
    requireStringOption(options, "source-connector"),
    "source-connector",
  );
  const destinationConnector = normalizeAddress(
    requireStringOption(options, "destination-connector"),
    "destination-connector",
  );

  return {
    source,
    destination,
    connectors: {
      source: sourceConnector,
      destination: destinationConnector,
    },
    txId,
    executionBlocks: resolveExecutionBlocks(options),
  };
}

export function resolveVerificationConfig(options: CliOptions): VerificationConfig {
  return resolveSharedConfig(options);
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
  const shared = resolveSharedConfig(options);

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
