export type Side = "source" | "destination";

export type Stage =
  | "source-deposit"
  | "destination-funds-released"
  | "source-ack-ready"
  | "source-refund-initiated"
  | "destination-burn-executed";

export type RelayProofStage =
  | "lock"
  | "mint"
  | "ack"
  | "refund-initiate"
  | "refund-claim"
  | "execute-burn"
  | "burn-proof"
  | "non-accept-proof";

export type ProofBackend = "local" | "docker";

export type VerificationMode = "colibri" | "rpc-fallback";
export type AckVerificationVariant = "standard" | "pruned-source-origin";

export interface StageVerificationHistoryEntry {
  stage: Stage;
  mode: VerificationMode;
  degraded: boolean;
}

export interface StageVerificationHints {
  ackVariant?: AckVerificationVariant;
  priorProofStageVerifications?: StageVerificationHistoryEntry[];
}

export interface StageVerificationPolicy {
  retryColibriFromScratch: boolean;
}

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
  sourceRefundInitiated?: BlockTagInput;
  destinationBurnExecuted?: BlockTagInput;
  /** Execution block for the non-accept proof (read against destination chain). */
  destinationNonAccept?: BlockTagInput;
}

export interface ProofPaths {
  lockWorkspace: string;
  mintWorkspace: string;
  ackWorkspace: string;
  refundClaimWorkspace: string;
  burnWorkspace: string;
  nonAcceptWorkspace: string;
  lockDockerScript: string;
  mintDockerScript: string;
  ackDockerScript: string;
  refundClaimDockerScript: string;
  burnDockerScript: string;
  nonAcceptDockerScript: string;
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
  verificationHints?: StageVerificationHints;
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
  stage: ProofRelayStage;
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
  /** All relay stage types, including direct stages (refund-initiate, execute-burn). */
  stage: RelayProofStage;
  txHash: string;
  receiptBlock: number;
  resultingStatus: number;
}

export interface RelayStageResult {
  /** Absent for direct-action stages (refund-initiate, execute-burn). */
  verification?: StageVerificationResult;
  /** Absent for direct-action stages (refund-initiate, execute-burn). */
  proof?: ProofArtifact;
  submission: SubmissionResult;
}

export interface HappyPathResult {
  lock: RelayStageResult;
  mint: RelayStageResult;
  ack: RelayStageResult;
}

/**
 * Returned by prepareStageSubmission: the browser-ready unsigned payload plus
 * optional proof and verification (absent for direct-action stages).
 */
export interface StageSubmissionResult {
  /** Absent for direct-action stages (refund-initiate, execute-burn). */
  proof?: ProofArtifact;
  payload: StageReadyPayload;
  /** Absent for direct-action stages. */
  verification?: StageVerificationResult;
}

export type ResumeAction =
  | "lock"
  | "mint"
  | "ack"
  | "refund-initiate"
  | "refund-claim"
  | "execute-burn"
  | "burn-proof"
  | "non-accept-proof"
  | "noop"
  | "error";

export interface HistoryFlags {
  depositLocked: boolean;
  fundsReleased: boolean;
  ackReady: boolean;
  /** Set when source=1, destination=4 and block.timestamp >= ackDeadline. */
  ackDeadlineExpired?: boolean;
  /**
   * Set when source=3, destination=0 to distinguish burn-proof from
   * non-accept-proof. true = RefundExecuted event found on destination (burn
   * path); false = no such event (lock was never accepted — non-accept path).
   */
  burnExecuted?: boolean;
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

export type ProofRelayStage = "lock" | "mint" | "ack" | "refund-claim" | "burn-proof" | "non-accept-proof";

export interface ProofRunnerInput {
  stage: ProofRelayStage;
  backend: ProofBackend;
  txId: string;
  rpcUrl: string;
  connector: string;
  sourceChainId?: number;
  destinationChainId?: number;
  /** Required by non-accept-proof: the ackDeadline from the source transfer record (seconds, u64). */
  ackDeadline?: string;
  executionBlock: BlockTagInput;
  repoRoot: string;
  proofPaths: ProofPaths;
  risc0ProverMode: "local" | "bonsai";
}

export interface StageDefinition {
  stage: Stage;
  eventName: "DepositLocked" | "FundsReleased" | "AckReady" | "RefundClaimed" | "RefundExecuted";
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

/**
 * @deprecated Use `JobStatus` from `agent/contracts.ts` instead.
 * This old definition uses legacy status strings ("pending", "running", etc.)
 * that were replaced by the agent's richer state machine.
 */
export type JobStatus = "pending" | "running" | "proof-ready" | "done" | "error" | "unsupported";

/**
 * @deprecated Use `RelayJob` from `agent/contracts.ts` instead.
 * This definition is kept as a compatibility shim during the refactor.
 */
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
  /** "proof" stages require RISC Zero proof generation; "direct" stages call the contract immediately. */
  actionKind: "proof" | "direct";
  /** null for direct actions (refund-initiate, execute-burn). */
  proofPayload?: string | null;
  contractMethod: string;
  contractArgs: unknown[];
  targetChainId: number;
  targetConnector: string;
}
