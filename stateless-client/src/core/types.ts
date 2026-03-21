export type Side = "source" | "destination";

export type Stage =
  | "source-deposit"
  | "destination-funds-released"
  | "source-ack-ready";

export type RelayProofStage = "lock" | "mint" | "ack";

export type ProofBackend = "local" | "docker";

export type VerificationMode = "colibri" | "rpc-fallback";

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

export interface RelayConfig {
  source: ChainConfig;
  destination: ChainConfig;
  connectors: ConnectorConfig;
  txId: string;
  signerPrivateKey: string;
  proofBackend: ProofBackend;
  executionBlocks: StageExecutionBlocks;
  repoRoot: string;
  proofPaths: ProofPaths;
  risc0ProverMode: "local" | "bonsai";
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
  eventName: string;
  txId: string;
  connector: string;
  status: number;
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
