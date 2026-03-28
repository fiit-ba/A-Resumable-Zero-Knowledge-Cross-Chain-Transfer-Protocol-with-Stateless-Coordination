import {
  prepareStageSubmission,
  planRelayResume,
  discoverRepoRoot,
  defaultProofPaths,
  resolveChainConfig,
  normalizeAddress,
  normalizeBytes32
} from "stateless-client";
import type {
  RelayProofStage,
  ResumeDecision,
  StageSubmissionResult
} from "stateless-client";
import type { TransferIntent } from "agent-shared";

export type { StageSubmissionResult };

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

function resolveProofBackend(): "local" | "docker" {
  const raw = process.env["STATELESS_CLIENT_PROOF_BACKEND"]?.trim().toLowerCase();
  if (!raw) return "local";
  if (raw === "local" || raw === "docker") return raw;
  console.warn(
    `[agent] Ignoring invalid STATELESS_CLIENT_PROOF_BACKEND='${raw}'. Expected 'local' or 'docker'. Using 'local'.`
  );
  return "local";
}

function resolveRisc0ProverMode(
  sourceIsLocal: boolean,
  destinationIsLocal: boolean
): "local" | "bonsai" {
  const raw = process.env["STATELESS_CLIENT_RISC0_PROVER_MODE"]?.trim().toLowerCase();
  if (raw === "local" || raw === "bonsai") {
    return raw;
  }
  if (raw) {
    console.warn(
      `[agent] Ignoring invalid STATELESS_CLIENT_RISC0_PROVER_MODE='${raw}'. Expected 'local' or 'bonsai'.`
    );
  }

  const hasBonsaiCreds = Boolean(
    process.env["BONSAI_API_URL"] && process.env["BONSAI_API_KEY"]
  );
  if ((!sourceIsLocal || !destinationIsLocal) && hasBonsaiCreds) {
    return "bonsai";
  }
  return "local";
}

export function buildStageConfig(intent: TransferIntent, txId: string) {
  const repoRoot = discoverRepoRoot(process.cwd());

  const source = resolveChainConfig({
    side: "source",
    profileName: intent.sourceProfile,
    defaultProfileName: "local-anvil" as const
  });

  const destination = resolveChainConfig({
    side: "destination",
    profileName: intent.destinationProfile,
    defaultProfileName: "local-hardhat" as const
  });

  const proofBackend = resolveProofBackend();
  const risc0ProverMode = resolveRisc0ProverMode(source.isLocal, destination.isLocal);
  if (
    risc0ProverMode === "local" &&
    (!source.isLocal || !destination.isLocal)
  ) {
    console.warn(
      `[agent] Using local RISC0 prover for non-local profiles ${source.profileName}->${destination.profileName}; proving can take 20+ minutes.`
    );
  }

  return {
    source,
    destination,
    connectors: {
      source: normalizeAddress(intent.sourceConnector, "sourceConnector"),
      destination: normalizeAddress(intent.destinationConnector, "destinationConnector")
    },
    txId: normalizeBytes32(txId, "txId"),
    proofBackend,
    executionBlocks: {},
    repoRoot,
    proofPaths: defaultProofPaths(repoRoot),
    risc0ProverMode
  };
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export async function resolveRepoRoot(): Promise<string> {
  return discoverRepoRoot(process.cwd());
}

export async function getResumeDecision(
  intent: TransferIntent,
  txId: string
): Promise<ResumeDecision> {
  const config = buildStageConfig(intent, txId);
  return planRelayResume(config as Parameters<typeof planRelayResume>[0]);
}

export async function runPrepareStage(
  intent: TransferIntent,
  txId: string,
  stage: RelayProofStage
): Promise<StageSubmissionResult> {
  const config = buildStageConfig(intent, txId);
  return prepareStageSubmission(config, stage);
}
