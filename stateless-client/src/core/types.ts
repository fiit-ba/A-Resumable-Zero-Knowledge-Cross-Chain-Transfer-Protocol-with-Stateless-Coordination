export type Side = "source" | "destination";

export type Stage =
  | "source-deposit"
  | "destination-funds-released"
  | "source-ack-ready";

export type RelayProofStage = "lock" | "mint" | "ack";

export type ProofBackend = "local" | "docker";

export type VerificationMode = "colibri" | "rpc-fallback";

/**
 * Machine-readable reason for why a verification was degraded to rpc-fallback.
 * Consumers can use this to log or surface chain-specific diagnostics without
 * parsing human-readable warning messages.
 */
export type VerificationDegradeReason =
  | "chiado_sync_backwards"
  | "chiado_ssz_parse"
  | "chiado_parent_beacon_missing"
  | "chiado_finalization"
  | "chiado_block_not_signed"
  | "chiado_bootstrap_unsupported"
  | "local_chain";

export type NetworkProfileName =
  | "local-anvil"
  | "local-hardhat"
  | "mainnet"
  | "sepolia"
  | "holesky"
  | "hoodi"
  | "gnosis"
  | "chiado";

export type BlockTagInput = string | number;

export interface ChainConfig {
  side: Side;
  profileName: NetworkProfileName | "custom";
  isLocal: boolean;
  chainId: number;
  rpcUrls: string[];
  proverUrls: string[];
  beaconUrls: string[];
  checkpointzUrls: string[];
}

export interface ConnectorConfig {
  source: string;
  destination: string;
}

export interface StageExecutionBlocks {
  sourceDeposit?: BlockTagInput;
  destinationFundsReleased?: BlockTagInput;
  sourceAckReady?: BlockTagInput;
}

export interface ProofPaths {
  lockWorkspace: string;
  mintWorkspace: string;
  ackWorkspace: string;
  lockDockerScript: string;
  mintDockerScript: string;
  ackDockerScript: string;
}

/**
 * The subset of RelayConfig that does not require a signer private key.
 * Used by prepareStageSubmission for agent-facing proof preparation.
 */
export interface StageSubmissionConfig {
  source: ChainConfig;
  destination: ChainConfig;
  connectors: ConnectorConfig;
  txId: string;
  proofBackend: ProofBackend;
  executionBlocks: StageExecutionBlocks;
  repoRoot: string;
  proofPaths: ProofPaths;
  risc0ProverMode: "local" | "bonsai";
  allowPrunedSourceAck?: boolean;
}

export interface RelayConfig extends StageSubmissionConfig {
  signerPrivateKey: string;
}

export interface VerificationConfig {
  source: ChainConfig;
  destination: ChainConfig;
  connectors: ConnectorConfig;
  txId: string;
  executionBlocks: StageExecutionBlocks;
}

export interface StageVerificationResult {
  stage: Stage;
  mode: VerificationMode;
  degraded: boolean;
  /** Present only when degraded is true; identifies the root cause of fallback. */
  degradeReason?: VerificationDegradeReason;
  eventName: string;
  txId: string;
  connector: string;
  status: number;
  eventBlockNumber?: number;
}

export interface ProofArtifact {
  stage: RelayProofStage;
  backend: ProofBackend;
  proofPayload: string;
  txId: string;
  metadata: Record<string, string>;
  rawOutput: string;
  amount?: bigint;
  sender?: string;
  receiver?: string;
  currencyFrom?: string;
  currencyTo?: string;
  srcChainConnector?: string;
  dstChainConnector?: string;
  originAckDeadline?: bigint;
  nonce?: bigint;
  sourceChainId?: number;
  destChainId?: number;
}

export interface SubmissionResult {
  stage: RelayProofStage;
  txHash: string;
  receiptBlock: number;
  resultingStatus: number;
}

export interface RelayStageResult {
  verification: StageVerificationResult;
  proof: ProofArtifact;
  submission: SubmissionResult;
}

export interface HappyPathResult {
  lock: RelayStageResult;
  mint: RelayStageResult;
  ack: RelayStageResult;
}

/**
 * Returned by prepareStageSubmission: proof artifact, the browser-ready
 * unsigned payload, and the verification result (including Colibri/fallback mode).
 */
export interface StageSubmissionResult {
  proof: ProofArtifact;
  payload: StageReadyPayload;
  verification: StageVerificationResult;
}

export type ResumeAction = "lock" | "mint" | "ack" | "noop" | "error";

export interface HistoryFlags {
  depositLocked: boolean;
  fundsReleased: boolean;
  ackReady: boolean;
}

export interface ResumeDecision {
  action: ResumeAction;
  reason: string;
  sourceStatus: number;
  destinationStatus: number;
  historyFlags: HistoryFlags;
}

export interface ResumeResult {
  decision: ResumeDecision;
  executed?: RelayStageResult;
}

export interface ProofRunnerInput {
  stage: RelayProofStage;
  backend: ProofBackend;
  txId: string;
  rpcUrl: string;
  connector: string;
  sourceChainId?: number;
  destinationChainId?: number;
  executionBlock: BlockTagInput;
  repoRoot: string;
  proofPaths: ProofPaths;
  risc0ProverMode: "local" | "bonsai";
}

export interface StageDefinition {
  stage: Stage;
  eventName: "DepositLocked" | "FundsReleased" | "AckReady";
  expectedStatus: number;
  side: Side;
}

// ---------------------------------------------------------------------------
// Shared types used by the local agent and web app
// ---------------------------------------------------------------------------

/** The user's intent passed via the custom URL scheme and stored in each job. */
export interface TransferIntent {
  sourceProfile: string;
  destinationProfile: string;
  sourceConnector: string;
  destinationConnector: string;
  tokenFrom: string;
  tokenTo: string;
  /** Amount as a decimal string (bigint-safe JSON). */
  amount: string;
  receiver: string;
}

export type JobStatus =
  | "pending"
  | "running"
  | "proof-ready"
  | "done"
  | "error"
  | "unsupported";

/** Persisted per-job state stored in the local agent SQLite database. */
export interface RelayJob {
  id: string;
  txId: string;
  currentStage: RelayProofStage | "pending" | "done";
  status: JobStatus;
  sourceStatus: number;
  destinationStatus: number;
  lastError?: string;
  latestSubmissionTxHash?: string;
  intent: TransferIntent;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payload returned by GET /jobs/:id/stages/:stage/proof when the proof is
 * ready. contractArgs are bigint-free (all converted to decimal strings) so
 * they can be safely JSON-serialised and used with ethers.js in the browser.
 */
export interface StageReadyPayload {
  stage: RelayProofStage;
  proofPayload: string;
  contractMethod: string;
  contractArgs: unknown[];
  targetChainId: number;
  targetConnector: string;
}
