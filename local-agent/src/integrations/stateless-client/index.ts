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

  return {
    source,
    destination,
    connectors: {
      source: normalizeAddress(intent.sourceConnector, "sourceConnector"),
      destination: normalizeAddress(intent.destinationConnector, "destinationConnector")
    },
    txId: normalizeBytes32(txId, "txId"),
    proofBackend: "local" as const,
    executionBlocks: {},
    repoRoot,
    proofPaths: defaultProofPaths(repoRoot),
    risc0ProverMode: "local" as const
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
