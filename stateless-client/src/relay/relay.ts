import {
  Contract,
  JsonRpcProvider,
  Wallet,
  type BlockTag,
  type ContractTransactionResponse,
  type Provider,
} from "ethers";
import { CONNECTOR_ABI } from "../contracts/abi.js";
import { runProof } from "./proof-runner.js";
import { RELAY_STAGE_REGISTRY, STAGE_DEFINITIONS, isProofRelayStage } from "./stages.js";
import type {
  AckVerificationVariant,
  BlockTagInput,
  HappyPathResult,
  ProofArtifact,
  ProofRelayStage,
  RelayConfig,
  RelayProofStage,
  RelayStageResult,
  Stage,
  StageExecutionBlocks,
  StageVerificationHistoryEntry,
  StageVerificationPolicy,
  StageReadyPayload,
  StageSubmissionConfig,
  StageSubmissionResult,
  StageVerificationResult,
  VerificationConfig,
} from "../core/types.js";
import { normalizeAddress, normalizeBytes32 } from "../core/utils.js";
import { verifyAckEventOnly, verifyStage } from "./verification.js";

interface ConnectorTxSnapshot {
  txId: string;
  amount: bigint;
  currencyFrom: string;
  currencyTo: string;
  from: string;
  to: string;
  srcChainConnector: string;
  dstChainConnector: string;
  ackDeadline: bigint;
  nonce: bigint;
  status: number;
}

interface ChainHandles {
  sourceProvider: JsonRpcProvider;
  destinationProvider: JsonRpcProvider;
  sourceReadContract: Contract;
  destinationReadContract: Contract;
  sourceWriteContract: Contract;
  destinationWriteContract: Contract;
}

function toBlockTag(value: BlockTagInput | undefined): BlockTag | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  return value;
}

function createProvider(rpcUrl: string, chainId: number, provider?: Provider): JsonRpcProvider {
  if (provider && provider instanceof JsonRpcProvider) {
    return provider;
  }
  return new JsonRpcProvider(rpcUrl, chainId);
}

async function assertProviderChainId(
  provider: JsonRpcProvider,
  expectedChainId: number,
  label: string,
): Promise<void> {
  const network = await provider.getNetwork();
  const actual = Number(network.chainId);
  if (actual !== expectedChainId) {
    throw new Error(`${label} chain id mismatch: expected ${expectedChainId}, got ${actual}`);
  }
}

async function createChainHandles(config: RelayConfig): Promise<ChainHandles> {
  const sourceProvider = createProvider(config.source.rpcUrls[0], config.source.chainId);
  const destinationProvider = createProvider(
    config.destination.rpcUrls[0],
    config.destination.chainId,
  );

  await assertProviderChainId(sourceProvider, config.source.chainId, "source");
  await assertProviderChainId(destinationProvider, config.destination.chainId, "destination");

  const sourceSigner = new Wallet(config.signerPrivateKey, sourceProvider);
  const destinationSigner = new Wallet(config.signerPrivateKey, destinationProvider);

  return {
    sourceProvider,
    destinationProvider,
    sourceReadContract: new Contract(config.connectors.source, CONNECTOR_ABI, sourceProvider),
    destinationReadContract: new Contract(
      config.connectors.destination,
      CONNECTOR_ABI,
      destinationProvider,
    ),
    sourceWriteContract: new Contract(config.connectors.source, CONNECTOR_ABI, sourceSigner),
    destinationWriteContract: new Contract(
      config.connectors.destination,
      CONNECTOR_ABI,
      destinationSigner,
    ),
  };
}

function blockForStage(
  executionBlocks: StageExecutionBlocks,
  stage: Stage,
): BlockTagInput | undefined {
  if (stage === "source-deposit") return executionBlocks.sourceDeposit;
  if (stage === "destination-funds-released") return executionBlocks.destinationFundsReleased;
  if (stage === "source-ack-ready") return executionBlocks.sourceAckReady;
  if (stage === "source-refund-initiated") return executionBlocks.sourceRefundInitiated;
  if (stage === "destination-burn-executed") return executionBlocks.destinationBurnExecuted;
  return undefined;
}

async function verifyStageFromConfig(
  config: VerificationConfig,
  stage: Stage,
  verificationPolicy: StageVerificationPolicy,
): Promise<StageVerificationResult> {
  const stageDef = STAGE_DEFINITIONS[stage];
  const chain = stageDef.side === "source" ? config.source : config.destination;
  const connector =
    stageDef.side === "source" ? config.connectors.source : config.connectors.destination;

  return verifyStage({
    stage,
    chain,
    connector,
    txId: config.txId,
    expectedSrcConnector: config.connectors.source,
    expectedDstConnector: config.connectors.destination,
    blockTag: blockForStage(config.executionBlocks, stage),
    verificationPolicy,
  });
}

export function shouldUsePrunedAckVerification(
  sourceStatus: number,
  destinationStatus: number,
): boolean {
  return sourceStatus === 0 && destinationStatus === 3;
}

function hasPriorDegradedNonLocalProofStage(config: StageSubmissionConfig): boolean {
  const prior = config.verificationHints?.priorProofStageVerifications ?? [];
  for (const entry of prior) {
    if (!entry.degraded) {
      continue;
    }
    const stageDef = STAGE_DEFINITIONS[entry.stage];
    const chain = stageDef.side === "source" ? config.source : config.destination;
    if (!chain.isLocal) {
      return true;
    }
  }
  return false;
}

export function deriveVerificationPolicyForStage(
  config: StageSubmissionConfig,
  stage: Stage,
): StageVerificationPolicy {
  const stageDef = STAGE_DEFINITIONS[stage];
  const chain = stageDef.side === "source" ? config.source : config.destination;

  return {
    retryColibriFromScratch: !chain.isLocal && hasPriorDegradedNonLocalProofStage(config),
  };
}

function toVerificationHistoryEntry(
  verification: StageVerificationResult,
): StageVerificationHistoryEntry {
  return {
    stage: verification.stage,
    mode: verification.mode,
    degraded: verification.degraded,
  };
}

async function fetchTxSnapshot(
  contract: Contract,
  txId: string,
  blockTag?: BlockTagInput,
): Promise<ConnectorTxSnapshot> {
  const tx = await contract.getTx(txId, {
    blockTag: toBlockTag(blockTag),
  });

  return {
    txId: normalizeBytes32(String(tx.txId), "getTx.txId"),
    amount: BigInt(tx.amount),
    currencyFrom: normalizeAddress(tx.currencyFrom, "getTx.currencyFrom"),
    currencyTo: normalizeAddress(tx.currencyTo, "getTx.currencyTo"),
    from: normalizeAddress(tx.from, "getTx.from"),
    to: normalizeAddress(tx.to, "getTx.to"),
    srcChainConnector: normalizeAddress(tx.srcChainConnector, "getTx.srcChainConnector"),
    dstChainConnector: normalizeAddress(tx.dstChainConnector, "getTx.dstChainConnector"),
    ackDeadline: BigInt(tx.ackDeadline),
    nonce: BigInt(tx.nonce),
    status: Number(tx.status),
  };
}

async function assertAckWindowActive(
  stage: RelayProofStage,
  txSnapshot: ConnectorTxSnapshot,
  provider: JsonRpcProvider,
  side: "source" | "destination",
): Promise<void> {
  if (txSnapshot.ackDeadline === 0n) {
    return;
  }

  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error(`Cannot fetch latest ${side} block for ${stage} stage deadline check.`);
  }

  const chainNow = BigInt(latestBlock.timestamp);
  if (chainNow >= txSnapshot.ackDeadline) {
    throw new Error(
      `ACK window expired for ${stage} stage on ${side} chain: ` +
        `deadline=${txSnapshot.ackDeadline.toString()}, current=${chainNow.toString()}. ` +
        `Refund path is required.`,
    );
  }
}

async function waitForSubmission(
  tx: ContractTransactionResponse,
  stageLabel: string,
): Promise<number> {
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error(`No receipt for ${stageLabel} submission transaction.`);
  }
  if (receipt.status !== 1) {
    throw new Error(`${stageLabel} submission transaction reverted: ${receipt.hash}`);
  }
  return receipt.blockNumber;
}

function assertLockProofConsistency(
  config: StageSubmissionConfig,
  sourceTx: ConnectorTxSnapshot,
  artifact: ProofArtifact,
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(`Lock proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`);
  }
  assertAddressMatch(
    "Lock proof srcChainConnector",
    config.connectors.source,
    artifact.srcChainConnector,
  );
  assertAddressMatch(
    "Lock proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector,
  );
  if (artifact.amount !== sourceTx.amount) {
    throw new Error(
      `Lock proof amount mismatch: expected ${sourceTx.amount}, got ${artifact.amount}`,
    );
  }
  assertAddressMatch("Lock proof receiver", sourceTx.to, artifact.receiver);
  assertAddressMatch("Lock proof sender", sourceTx.from, artifact.sender);
  assertAddressMatch("Lock proof currencyFrom", sourceTx.currencyFrom, artifact.currencyFrom);
  assertAddressMatch("Lock proof currencyTo", sourceTx.currencyTo, artifact.currencyTo);
  if (artifact.sourceChainId !== config.source.chainId) {
    throw new Error(
      `Lock proof sourceChainId mismatch: expected ${config.source.chainId}, got ${artifact.sourceChainId}`,
    );
  }
  if (artifact.destChainId !== config.destination.chainId) {
    throw new Error(
      `Lock proof destChainId mismatch: expected ${config.destination.chainId}, got ${artifact.destChainId}`,
    );
  }
}

function assertMintProofConsistency(
  config: StageSubmissionConfig,
  destinationTx: ConnectorTxSnapshot,
  artifact: ProofArtifact,
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(`Mint proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`);
  }
  assertAddressMatch(
    "Mint proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector,
  );
  if (artifact.amount !== destinationTx.amount) {
    throw new Error(
      `Mint proof amount mismatch: expected ${destinationTx.amount}, got ${artifact.amount}`,
    );
  }
  assertAddressMatch("Mint proof receiver", destinationTx.to, artifact.receiver);
}

function assertAckProofConsistency(
  config: StageSubmissionConfig,
  artifact: ProofArtifact,
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(`Ack proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`);
  }
  assertAddressMatch(
    "Ack proof srcChainConnector",
    config.connectors.source,
    artifact.srcChainConnector,
  );
  assertAddressMatch(
    "Ack proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector,
  );
}

function assertAddressMatch(label: string, expected: string, actual: string | undefined): void {
  if (!actual) {
    throw new Error(`${label} missing in proof artifact`);
  }
  const normalizedExpected = normalizeAddress(expected, `${label}.expected`);
  const normalizedActual = normalizeAddress(actual, `${label}.actual`);
  if (normalizedExpected.toLowerCase() !== normalizedActual.toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${normalizedExpected}, got ${normalizedActual}`);
  }
}

async function getStatus(contract: Contract, txId: string): Promise<number> {
  return Number(await contract.txStatus(txId));
}

export async function runVerifyStageCommand(
  config: VerificationConfig,
  stage: Stage,
): Promise<StageVerificationResult> {
  return verifyStageFromConfig(config, stage, { retryColibriFromScratch: false });
}

// ---------------------------------------------------------------------------
// Handler maps — replace per-stage if/else chains in prepareStageSubmission
// ---------------------------------------------------------------------------

type TimelockPreflightHandler = (
  config: StageSubmissionConfig,
  sourceReadContract: Contract,
  destinationReadContract: Contract,
  sourceProvider: JsonRpcProvider,
  destinationProvider: JsonRpcProvider,
) => Promise<void>;

/** Stages that require an ACK-window check before proof preparation. */
const TIMELOCK_PREFLIGHT: Partial<Record<ProofRelayStage, TimelockPreflightHandler>> = {
  mint: async (config, sourceReadContract, _destRC, sourceProvider) => {
    const sourceTx = await fetchTxSnapshot(
      sourceReadContract,
      config.txId,
      config.executionBlocks.sourceDeposit,
    );
    await assertAckWindowActive("mint", sourceTx, sourceProvider, "source");
  },
  // No preflight for 'ack': submitAckProof has no ackDeadline guard on-chain because
  // once submitMintProof is accepted the source tx record is deleted, making
  // initiateRefund (and therefore submitRefundClaimProof) impossible.  The ack proof
  // is safe to submit at any time after MINTED_IN_HOLDING regardless of the deadline.
};

type ExecutionBlockResolver = (
  executionBlocks: StageExecutionBlocks,
  eventBlockNumber: number | undefined,
) => BlockTagInput;

/** Maps each proof stage to a function that resolves the execution block for the proof host. */
const EXECUTION_BLOCK_RESOLVER: Record<ProofRelayStage, ExecutionBlockResolver> = {
  lock: (eb, ev) => eb.sourceDeposit ?? ev ?? "latest",
  // Mint deliberately skips eventBlockNumber — the destination (Chiado) pruned RPC lacks
  // historical state trie data, so "latest" is the safe choice.
  mint: (eb) => eb.destinationFundsReleased ?? "latest",
  ack: (eb, ev) => eb.sourceAckReady ?? ev ?? "latest",
  "refund-claim": (eb, ev) => eb.sourceRefundInitiated ?? ev ?? "latest",
  "burn-proof": (eb, ev) => eb.destinationBurnExecuted ?? ev ?? "latest",
  // Non-accept proof runs against the destination chain; eventBlockNumber comes
  // from verifying source-refund-initiated (a source block), so we skip it and
  // always prefer "latest" on the destination unless an explicit override is set.
  "non-accept-proof": (eb) => eb.destinationNonAccept ?? "latest",
};

type ContractArgsBuilder = (config: StageSubmissionConfig, proof: ProofArtifact) => unknown[];

/** Maps each proof stage to a function that builds the unsigned contract-call argument list. */
const CONTRACT_ARGS_BUILDER: Record<ProofRelayStage, ContractArgsBuilder> = {
  lock: (config, proof) => [
    0,
    proof.proofPayload,
    config.txId,
    String(proof.amount),
    proof.currencyFrom,
    proof.currencyTo,
    proof.sender,
    proof.receiver,
    proof.srcChainConnector,
    String(proof.originAckDeadline),
    String(proof.nonce),
    proof.sourceChainId,
  ],
  mint: (config, proof) => [0, proof.proofPayload, config.txId],
  ack: (config, proof) => [0, proof.proofPayload, config.txId],
  "refund-claim": (config, proof) => [0, proof.proofPayload, config.txId],
  "burn-proof": (config, proof) => [0, proof.proofPayload, config.txId],
  "non-accept-proof": (config, proof) => [0, proof.proofPayload, config.txId],
};

type ProofConsistencyChecker = (
  config: StageSubmissionConfig,
  proof: ProofArtifact,
  sourceReadContract: Contract,
  destinationReadContract: Contract,
) => Promise<void>;

/** Stages that have extra on-chain consistency checks after proof generation. */
const PROOF_CONSISTENCY_CHECKER: Partial<Record<ProofRelayStage, ProofConsistencyChecker>> = {
  lock: async (config, proof, sourceReadContract) => {
    const sourceTx = await fetchTxSnapshot(
      sourceReadContract,
      config.txId,
      config.executionBlocks.sourceDeposit,
    );
    assertLockProofConsistency(config, sourceTx, proof);
  },
  mint: async (config, proof, _srcRC, destinationReadContract) => {
    const destinationTx = await fetchTxSnapshot(
      destinationReadContract,
      config.txId,
      config.executionBlocks.destinationFundsReleased,
    );
    assertMintProofConsistency(config, destinationTx, proof);
  },
  ack: async (config, proof) => {
    assertAckProofConsistency(config, proof);
  },
  // refund-claim and burn-proof: no additional consistency checks beyond proof host output.
};

// ---------------------------------------------------------------------------
// Core shared preparation API (no private key / signing required)
// ---------------------------------------------------------------------------

/**
 * Builds a wallet-ready payload for a direct-action stage (no proof required).
 * Direct stages are: refund-initiate (initiateRefund) and execute-burn (executeBurn).
 */
export function buildDirectActionPayload(
  config: Pick<StageSubmissionConfig, "source" | "destination" | "connectors" | "txId">,
  stage: "refund-initiate" | "execute-burn",
): StageReadyPayload {
  const spec = RELAY_STAGE_REGISTRY[stage];
  const targetChainId =
    spec.submissionSide === "source" ? config.source.chainId : config.destination.chainId;
  const targetConnector =
    spec.submissionSide === "source" ? config.connectors.source : config.connectors.destination;

  return {
    stage,
    actionKind: "direct",
    proofPayload: null,
    contractMethod: spec.submissionMethod,
    contractArgs: [config.txId],
    targetChainId,
    targetConnector,
  };
}

/**
 * Performs the full verified preparation sequence for one relay stage.
 *
 * For proof stages (lock/mint/ack/refund-claim/burn-proof):
 *   1. Stage verification via Colibri (or local RPC fallback)
 *   2. Proof generation
 *   3. Proof consistency checks against on-chain data
 *   4. Unsigned contract-call payload construction
 *
 * For direct stages (refund-initiate/execute-burn):
 *   - Returns a minimal payload with actionKind:"direct" and no proof.
 *
 * This is the single authoritative path used by both the local agent and the
 * CLI relay commands.  The browser wallet signs and submits; we only prepare.
 */
export async function prepareStageSubmission(
  config: StageSubmissionConfig,
  stage: RelayProofStage,
): Promise<StageSubmissionResult> {
  const spec = RELAY_STAGE_REGISTRY[stage];

  // Direct-action stages: no proof generation needed.
  if (spec.actionKind === "direct") {
    const payload = buildDirectActionPayload(
      config,
      stage as "refund-initiate" | "execute-burn",
    );
    return { payload };
  }

  // All remaining stages are proof stages.
  const proofStage = stage as ProofRelayStage;
  const verifyStageKey = spec.verifyStage as Stage;
  const stageDef = STAGE_DEFINITIONS[verifyStageKey];

  // Read-only providers for verification and tx-snapshot fetches
  const sourceProvider = new JsonRpcProvider(config.source.rpcUrls[0], config.source.chainId);
  const destinationProvider = new JsonRpcProvider(
    config.destination.rpcUrls[0],
    config.destination.chainId,
  );
  const sourceReadContract = new Contract(config.connectors.source, CONNECTOR_ABI, sourceProvider);
  const destinationReadContract = new Contract(
    config.connectors.destination,
    CONNECTOR_ABI,
    destinationProvider,
  );

  // Timelock preflight: do not prepare stages that are already expired.
  await TIMELOCK_PREFLIGHT[proofStage]?.(
    config,
    sourceReadContract,
    destinationReadContract,
    sourceProvider,
    destinationProvider,
  );

  // 1. Stage verification
  const verificationPolicy = deriveVerificationPolicyForStage(config, verifyStageKey);
  let verification: StageVerificationResult;
  const ackVariant: AckVerificationVariant = config.verificationHints?.ackVariant ?? "standard";
  if (proofStage === "ack" && ackVariant === "pruned-source-origin") {
    verification = await verifyAckEventOnly({
      stage: "source-ack-ready",
      chain: config.source,
      connector: config.connectors.source,
      txId: config.txId,
      expectedSrcConnector: config.connectors.source,
      expectedDstConnector: config.connectors.destination,
      blockTag: config.executionBlocks.sourceAckReady,
      verificationPolicy,
    });
  } else {
    verification = await verifyStageFromConfig(config, verifyStageKey, verificationPolicy);
  }

  // 2. Resolve execution block for the proof host via the per-stage resolver map.
  const executionBlock = EXECUTION_BLOCK_RESOLVER[proofStage](
    config.executionBlocks,
    verification.eventBlockNumber,
  );

  // 3. Proof generation
  // Determine which chain the proof host reads against. Most stages use the same
  // side as their verifyStage; non-accept-proof overrides this to "destination".
  const proofHostSide = spec.proofHostSide ?? stageDef.side;
  const proofRpcUrl =
    proofHostSide === "source" ? config.source.rpcUrls[0] : config.destination.rpcUrls[0];
  const proofConnector =
    proofHostSide === "source" ? config.connectors.source : config.connectors.destination;

  // Fetch ackDeadline from the source tx record for non-accept-proof (the proof
  // host needs it to validate block_timestamp >= ackDeadline in the guest).
  let ackDeadline: string | undefined;
  if (proofStage === "non-accept-proof") {
    const sourceTx = await fetchTxSnapshot(sourceReadContract, config.txId);
    ackDeadline = sourceTx.ackDeadline.toString();
  }

  const proof = await runProof({
    stage: proofStage,
    backend: config.proofBackend,
    txId: config.txId,
    rpcUrl: proofRpcUrl,
    connector: proofConnector,
    sourceChainId: config.source.chainId,
    destinationChainId: config.destination.chainId,
    ackDeadline,
    executionBlock,
    repoRoot: config.repoRoot,
    proofPaths: config.proofPaths,
    risc0ProverMode: config.risc0ProverMode,
  });

  // 4. Proof consistency checks (per-stage, optional)
  await PROOF_CONSISTENCY_CHECKER[proofStage]?.(
    config,
    proof,
    sourceReadContract,
    destinationReadContract,
  );

  // 5. Build unsigned payload
  const targetChainId =
    spec.submissionSide === "source" ? config.source.chainId : config.destination.chainId;
  const targetConnector =
    spec.submissionSide === "source" ? config.connectors.source : config.connectors.destination;

  const contractArgs = CONTRACT_ARGS_BUILDER[proofStage](config, proof);

  const payload: StageReadyPayload = {
    stage: proofStage,
    actionKind: "proof",
    proofPayload: proof.proofPayload,
    contractMethod: spec.submissionMethod,
    contractArgs,
    targetChainId,
    targetConnector,
  };

  return { proof, payload, verification };
}

// ---------------------------------------------------------------------------
// CLI relay commands — generic helper + thin public wrappers
// ---------------------------------------------------------------------------

async function runRelayStage(config: RelayConfig, stage: RelayProofStage): Promise<RelayStageResult> {
  const spec = RELAY_STAGE_REGISTRY[stage];

  const { proof, payload, verification } = await prepareStageSubmission(config, stage);

  if (isProofRelayStage(stage) && (!proof || !verification)) {
    throw new Error(`prepareStageSubmission(${stage}) returned an incomplete proof result.`);
  }

  const handles = await createChainHandles(config);
  const writeContract =
    spec.submissionSide === "source" ? handles.sourceWriteContract : handles.destinationWriteContract;
  const readContract =
    spec.submissionSide === "source" ? handles.sourceReadContract : handles.destinationReadContract;

  const fn = writeContract[spec.submissionMethod] as (
    ...args: unknown[]
  ) => Promise<ContractTransactionResponse>;
  const submitTx = await fn(...payload.contractArgs);

  const receiptBlock = await waitForSubmission(submitTx, stage);
  const resultingStatus = await getStatus(readContract, config.txId);

  if (spec.expectedPostSubmitStatus !== null && resultingStatus !== spec.expectedPostSubmitStatus) {
    throw new Error(
      `Status mismatch after relay-${stage}: expected ${spec.expectedPostSubmitStatus}, got ${resultingStatus}`,
    );
  }

  return {
    verification,
    proof,
    submission: { stage, txHash: submitTx.hash, receiptBlock, resultingStatus },
  };
}

export async function runRelayLock(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "lock");
}

export async function runRelayMint(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "mint");
}

export async function runRelayAck(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "ack");
}

export async function runRelayRefundInitiate(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "refund-initiate");
}

export async function runRelayRefundClaim(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "refund-claim");
}

export async function runRelayExecuteBurn(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "execute-burn");
}

export async function runRelayBurnProof(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "burn-proof");
}

export async function runRelayNonAcceptProof(config: RelayConfig): Promise<RelayStageResult> {
  return runRelayStage(config, "non-accept-proof");
}

function withExecutionBlockOverrides(
  config: RelayConfig,
  overrides: Partial<StageExecutionBlocks>,
): RelayConfig {
  return {
    ...config,
    executionBlocks: {
      ...config.executionBlocks,
      ...overrides,
    },
  };
}

function withVerificationHistory(
  config: RelayConfig,
  history: StageVerificationHistoryEntry[],
): RelayConfig {
  return {
    ...config,
    verificationHints: {
      ...config.verificationHints,
      priorProofStageVerifications: history,
    },
  };
}

export async function runRelayHappyPath(config: RelayConfig): Promise<HappyPathResult> {
  const lock = await runRelayLock(config);

  const mintConfig = withVerificationHistory(
    withExecutionBlockOverrides(config, {
      destinationFundsReleased:
        config.executionBlocks.destinationFundsReleased ?? lock.submission.receiptBlock,
    }),
    lock.verification ? [toVerificationHistoryEntry(lock.verification)] : [],
  );
  const mint = await runRelayMint(mintConfig);

  const ackConfig = withVerificationHistory(
    withExecutionBlockOverrides(config, {
      sourceAckReady: config.executionBlocks.sourceAckReady ?? mint.submission.receiptBlock,
    }),
    [
      ...(lock.verification ? [toVerificationHistoryEntry(lock.verification)] : []),
      ...(mint.verification ? [toVerificationHistoryEntry(mint.verification)] : []),
    ],
  );
  const ack = await runRelayAck(ackConfig);

  return {
    lock,
    mint,
    ack,
  };
}
