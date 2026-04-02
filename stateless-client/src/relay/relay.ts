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
import {
  RELAY_STAGE_TO_SUBMISSION_METHOD,
  RELAY_STAGE_TO_VERIFY_STAGE,
  STAGE_DEFINITIONS,
} from "./stages.js";
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
  return sourceStatus === 0 && destinationStatus === 4;
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
// Core shared preparation API (no private key / signing required)
// ---------------------------------------------------------------------------

/** Target chain side for each relay stage. */
const SUBMISSION_SIDE: Record<RelayProofStage, "source" | "destination"> = {
  lock: "destination",
  mint: "source",
  ack: "destination",
  "refund-initiate": "source",
  "refund-claim": "destination",
  "execute-burn": "destination",
  "burn-proof": "source",
};

/**
 * Builds a wallet-ready payload for a direct-action stage (no proof required).
 * Direct stages are: refund-initiate (initiateRefund) and execute-burn (executeBurn).
 */
export function buildDirectActionPayload(
  config: Pick<StageSubmissionConfig, "source" | "destination" | "connectors" | "txId">,
  stage: "refund-initiate" | "execute-burn",
): StageReadyPayload {
  const targetSide = SUBMISSION_SIDE[stage];
  const targetChainId =
    targetSide === "source" ? config.source.chainId : config.destination.chainId;
  const targetConnector =
    targetSide === "source" ? config.connectors.source : config.connectors.destination;

  return {
    stage,
    actionKind: "direct",
    proofPayload: null,
    contractMethod: RELAY_STAGE_TO_SUBMISSION_METHOD[stage],
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
  // Direct-action stages: no proof generation needed.
  if (stage === "refund-initiate" || stage === "execute-burn") {
    const payload = buildDirectActionPayload(config, stage);
    return { payload };
  }

  // All remaining stages are proof stages.
  const proofStage = stage as ProofRelayStage;
  const verifyStageKey = RELAY_STAGE_TO_VERIFY_STAGE[proofStage];
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
  if (proofStage === "mint") {
    const sourceTx = await fetchTxSnapshot(
      sourceReadContract,
      config.txId,
      config.executionBlocks.sourceDeposit,
    );
    await assertAckWindowActive(proofStage, sourceTx, sourceProvider, "source");
  } else if (proofStage === "ack") {
    const destinationTx = await fetchTxSnapshot(
      destinationReadContract,
      config.txId,
      config.executionBlocks.destinationFundsReleased,
    );
    await assertAckWindowActive(proofStage, destinationTx, destinationProvider, "destination");
  }

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

  // Execution block for this stage.
  //
  // Lock and ack proof hosts use RISC0 steel's Event::preflight, which calls
  // eth_getLogs at exactly the execution block — so the execution block must be
  // the block where the event was emitted.  We therefore keep eventBlockNumber
  // as the fallback for lock and ack (Sepolia source chain, which has sufficient
  // RPC state history).
  //
  // Mint proof host does NOT use Event::preflight; it only calls Contract::preflight
  // for getTx().  We intentionally skip eventBlockNumber for mint because the
  // destination chain (Chiado) uses a pruned public RPC that lacks state trie data
  // for historical blocks.  Using "latest" is safe: getTx() status only changes
  // when the ack is submitted on-chain, which hasn't happened yet.
  let executionBlock: BlockTagInput;
  if (proofStage === "lock") {
    executionBlock =
      config.executionBlocks.sourceDeposit ?? verification.eventBlockNumber ?? "latest";
  } else if (proofStage === "mint") {
    executionBlock = config.executionBlocks.destinationFundsReleased ?? "latest";
  } else if (proofStage === "refund-claim") {
    executionBlock =
      config.executionBlocks.sourceRefundInitiated ?? verification.eventBlockNumber ?? "latest";
  } else if (proofStage === "burn-proof") {
    executionBlock =
      config.executionBlocks.destinationBurnExecuted ?? verification.eventBlockNumber ?? "latest";
  } else {
    // ack
    executionBlock =
      config.executionBlocks.sourceAckReady ?? verification.eventBlockNumber ?? "latest";
  }

  // 2. Proof generation
  const proof = await runProof({
    stage: proofStage,
    backend: config.proofBackend,
    txId: config.txId,
    rpcUrl: stageDef.side === "source" ? config.source.rpcUrls[0] : config.destination.rpcUrls[0],
    connector:
      stageDef.side === "source" ? config.connectors.source : config.connectors.destination,
    sourceChainId: config.source.chainId,
    destinationChainId: config.destination.chainId,
    executionBlock,
    repoRoot: config.repoRoot,
    proofPaths: config.proofPaths,
    risc0ProverMode: config.risc0ProverMode,
  });

  // 3. Proof consistency checks
  if (proofStage === "lock") {
    const sourceTx = await fetchTxSnapshot(
      sourceReadContract,
      config.txId,
      config.executionBlocks.sourceDeposit,
    );
    assertLockProofConsistency(config, sourceTx, proof);
  } else if (proofStage === "mint") {
    const destinationTx = await fetchTxSnapshot(
      destinationReadContract,
      config.txId,
      config.executionBlocks.destinationFundsReleased,
    );
    assertMintProofConsistency(config, destinationTx, proof);
  } else if (proofStage === "ack") {
    assertAckProofConsistency(config, proof);
  }
  // refund-claim and burn-proof: no additional consistency checks beyond proof host output.

  // 4. Build unsigned payload
  const targetSide = SUBMISSION_SIDE[proofStage];
  const targetChainId =
    targetSide === "source" ? config.source.chainId : config.destination.chainId;
  const targetConnector =
    targetSide === "source" ? config.connectors.source : config.connectors.destination;

  let contractArgs: unknown[];
  if (proofStage === "lock") {
    contractArgs = [
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
    ];
  } else {
    contractArgs = [0, proof.proofPayload, config.txId];
  }

  const payload: StageReadyPayload = {
    stage: proofStage,
    actionKind: "proof",
    proofPayload: proof.proofPayload,
    contractMethod: RELAY_STAGE_TO_SUBMISSION_METHOD[proofStage],
    contractArgs,
    targetChainId,
    targetConnector,
  };

  return { proof, payload, verification };
}

// ---------------------------------------------------------------------------
// CLI relay commands — thin wrappers over prepareStageSubmission + submission
// ---------------------------------------------------------------------------

export async function runRelayLock(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "lock");
  if (!proof || !verification) {
    throw new Error("prepareStageSubmission(lock) returned an incomplete proof result.");
  }
  const handles = await createChainHandles(config);

  const submitTx = await handles.destinationWriteContract.submitLockProof(...payload.contractArgs);

  const receiptBlock = await waitForSubmission(submitTx, "lock");
  const resultingStatus = await getStatus(handles.destinationReadContract, config.txId);

  if (resultingStatus !== 4) {
    throw new Error(
      `Destination status mismatch after relay-lock: expected 4, got ${resultingStatus}`,
    );
  }

  return {
    verification,
    proof,
    submission: { stage: "lock", txHash: submitTx.hash, receiptBlock, resultingStatus },
  };
}

export async function runRelayMint(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "mint");
  if (!proof || !verification) {
    throw new Error("prepareStageSubmission(mint) returned an incomplete proof result.");
  }
  const handles = await createChainHandles(config);

  const submitTx = await handles.sourceWriteContract.submitMintProof(...payload.contractArgs);

  const receiptBlock = await waitForSubmission(submitTx, "mint");
  const resultingStatus = await getStatus(handles.sourceReadContract, config.txId);

  if (resultingStatus !== 2) {
    throw new Error(`Source status mismatch after relay-mint: expected 2, got ${resultingStatus}`);
  }

  return {
    verification,
    proof,
    submission: { stage: "mint", txHash: submitTx.hash, receiptBlock, resultingStatus },
  };
}

export async function runRelayAck(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "ack");
  if (!proof || !verification) {
    throw new Error("prepareStageSubmission(ack) returned an incomplete proof result.");
  }
  const handles = await createChainHandles(config);

  const submitTx = await handles.destinationWriteContract.submitAckProof(...payload.contractArgs);

  const receiptBlock = await waitForSubmission(submitTx, "ack");
  const resultingStatus = await getStatus(handles.destinationReadContract, config.txId);

  if (resultingStatus !== 0) {
    throw new Error(
      `Destination status mismatch after relay-ack: expected 0, got ${resultingStatus}`,
    );
  }

  return {
    verification,
    proof,
    submission: { stage: "ack", txHash: submitTx.hash, receiptBlock, resultingStatus },
  };
}

export async function runRelayRefundInitiate(config: RelayConfig): Promise<RelayStageResult> {
  const handles = await createChainHandles(config);
  const submitTx = await handles.sourceWriteContract.initiateRefund(config.txId);
  const receiptBlock = await waitForSubmission(submitTx, "refund-initiate");
  const resultingStatus = await getStatus(handles.sourceReadContract, config.txId);
  return {
    submission: { stage: "refund-initiate", txHash: submitTx.hash, receiptBlock, resultingStatus },
  };
}

export async function runRelayRefundClaim(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "refund-claim");
  if (!proof || !verification) {
    throw new Error("prepareStageSubmission(refund-claim) returned an incomplete proof result.");
  }
  const handles = await createChainHandles(config);
  const submitTx = await handles.destinationWriteContract.submitRefundClaimProof(
    ...payload.contractArgs,
  );
  const receiptBlock = await waitForSubmission(submitTx, "refund-claim");
  const resultingStatus = await getStatus(handles.destinationReadContract, config.txId);
  return {
    verification,
    proof,
    submission: {
      stage: "refund-claim",
      txHash: submitTx.hash,
      receiptBlock,
      resultingStatus,
    },
  };
}

export async function runRelayExecuteBurn(config: RelayConfig): Promise<RelayStageResult> {
  const handles = await createChainHandles(config);
  const submitTx = await handles.destinationWriteContract.executeBurn(config.txId);
  const receiptBlock = await waitForSubmission(submitTx, "execute-burn");
  const resultingStatus = await getStatus(handles.destinationReadContract, config.txId);
  return {
    submission: { stage: "execute-burn", txHash: submitTx.hash, receiptBlock, resultingStatus },
  };
}

export async function runRelayBurnProof(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "burn-proof");
  if (!proof || !verification) {
    throw new Error("prepareStageSubmission(burn-proof) returned an incomplete proof result.");
  }
  const handles = await createChainHandles(config);
  const submitTx = await handles.sourceWriteContract.submitBurnProof(...payload.contractArgs);
  const receiptBlock = await waitForSubmission(submitTx, "burn-proof");
  const resultingStatus = await getStatus(handles.sourceReadContract, config.txId);
  return {
    verification,
    proof,
    submission: { stage: "burn-proof", txHash: submitTx.hash, receiptBlock, resultingStatus },
  };
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
