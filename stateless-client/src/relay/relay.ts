import {
  Contract,
  JsonRpcProvider,
  Wallet,
  type BlockTag,
  type ContractTransactionResponse,
  type Provider
} from "ethers";
import { CONNECTOR_ABI } from "../contracts/abi.js";
import { runProof } from "./proof-runner.js";
import { RELAY_STAGE_TO_SUBMISSION_METHOD, RELAY_STAGE_TO_VERIFY_STAGE, STAGE_DEFINITIONS } from "./stages.js";
import type {
  BlockTagInput,
  HappyPathResult,
  RelayConfig,
  RelayProofStage,
  RelayStageResult,
  Stage,
  StageExecutionBlocks,
  StageReadyPayload,
  StageSubmissionConfig,
  StageSubmissionResult,
  StageVerificationResult,
  VerificationConfig
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

function createProvider(
  rpcUrl: string,
  chainId: number,
  provider?: Provider
): JsonRpcProvider {
  if (provider && provider instanceof JsonRpcProvider) {
    return provider;
  }
  return new JsonRpcProvider(rpcUrl, chainId);
}

async function assertProviderChainId(
  provider: JsonRpcProvider,
  expectedChainId: number,
  label: string
): Promise<void> {
  const network = await provider.getNetwork();
  const actual = Number(network.chainId);
  if (actual !== expectedChainId) {
    throw new Error(
      `${label} chain id mismatch: expected ${expectedChainId}, got ${actual}`
    );
  }
}

async function createChainHandles(config: RelayConfig): Promise<ChainHandles> {
  const sourceProvider = createProvider(
    config.source.rpcUrls[0],
    config.source.chainId
  );
  const destinationProvider = createProvider(
    config.destination.rpcUrls[0],
    config.destination.chainId
  );

  await assertProviderChainId(sourceProvider, config.source.chainId, "source");
  await assertProviderChainId(
    destinationProvider,
    config.destination.chainId,
    "destination"
  );

  const sourceSigner = new Wallet(config.signerPrivateKey, sourceProvider);
  const destinationSigner = new Wallet(
    config.signerPrivateKey,
    destinationProvider
  );

  return {
    sourceProvider,
    destinationProvider,
    sourceReadContract: new Contract(
      config.connectors.source,
      CONNECTOR_ABI,
      sourceProvider
    ),
    destinationReadContract: new Contract(
      config.connectors.destination,
      CONNECTOR_ABI,
      destinationProvider
    ),
    sourceWriteContract: new Contract(
      config.connectors.source,
      CONNECTOR_ABI,
      sourceSigner
    ),
    destinationWriteContract: new Contract(
      config.connectors.destination,
      CONNECTOR_ABI,
      destinationSigner
    )
  };
}

function blockForStage(
  executionBlocks: StageExecutionBlocks,
  stage: Stage
): BlockTagInput | undefined {
  if (stage === "source-deposit") {
    return executionBlocks.sourceDeposit;
  }
  if (stage === "destination-funds-released") {
    return executionBlocks.destinationFundsReleased;
  }
  return executionBlocks.sourceAckReady;
}

async function verifyStageFromConfig(
  config: VerificationConfig,
  stage: Stage
): Promise<StageVerificationResult> {
  const stageDef = STAGE_DEFINITIONS[stage];
  const chain = stageDef.side === "source" ? config.source : config.destination;
  const connector =
    stageDef.side === "source"
      ? config.connectors.source
      : config.connectors.destination;

  return verifyStage({
    stage,
    chain,
    connector,
    txId: config.txId,
    expectedSrcConnector: config.connectors.source,
    expectedDstConnector: config.connectors.destination,
    blockTag: blockForStage(config.executionBlocks, stage)
  });
}

async function fetchTxSnapshot(
  contract: Contract,
  txId: string,
  blockTag?: BlockTagInput
): Promise<ConnectorTxSnapshot> {
  const tx = await contract.getTx(txId, {
    blockTag: toBlockTag(blockTag)
  });

  return {
    txId: normalizeBytes32(String(tx.txId), "getTx.txId"),
    amount: BigInt(tx.amount),
    currencyFrom: normalizeAddress(tx.currencyFrom, "getTx.currencyFrom"),
    currencyTo: normalizeAddress(tx.currencyTo, "getTx.currencyTo"),
    from: normalizeAddress(tx.from, "getTx.from"),
    to: normalizeAddress(tx.to, "getTx.to"),
    srcChainConnector: normalizeAddress(
      tx.srcChainConnector,
      "getTx.srcChainConnector"
    ),
    dstChainConnector: normalizeAddress(
      tx.dstChainConnector,
      "getTx.dstChainConnector"
    ),
    ackDeadline: BigInt(tx.ackDeadline),
    nonce: BigInt(tx.nonce),
    status: Number(tx.status)
  };
}

async function waitForSubmission(
  tx: ContractTransactionResponse,
  stageLabel: string
): Promise<number> {
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error(`No receipt for ${stageLabel} submission transaction.`);
  }
  if (receipt.status !== 1) {
    throw new Error(
      `${stageLabel} submission transaction reverted: ${receipt.hash}`
    );
  }
  return receipt.blockNumber;
}

function assertLockProofConsistency(
  config: StageSubmissionConfig,
  sourceTx: ConnectorTxSnapshot,
  artifact: RelayStageResult["proof"]
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(
      `Lock proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`
    );
  }
  assertAddressMatch(
    "Lock proof srcChainConnector",
    config.connectors.source,
    artifact.srcChainConnector
  );
  assertAddressMatch(
    "Lock proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector
  );
  if (artifact.amount !== sourceTx.amount) {
    throw new Error(
      `Lock proof amount mismatch: expected ${sourceTx.amount}, got ${artifact.amount}`
    );
  }
  assertAddressMatch("Lock proof receiver", sourceTx.to, artifact.receiver);
  assertAddressMatch("Lock proof sender", sourceTx.from, artifact.sender);
  assertAddressMatch(
    "Lock proof currencyFrom",
    sourceTx.currencyFrom,
    artifact.currencyFrom
  );
  assertAddressMatch(
    "Lock proof currencyTo",
    sourceTx.currencyTo,
    artifact.currencyTo
  );
  if (artifact.sourceChainId !== config.source.chainId) {
    throw new Error(
      `Lock proof sourceChainId mismatch: expected ${config.source.chainId}, got ${artifact.sourceChainId}`
    );
  }
  if (artifact.destChainId !== config.destination.chainId) {
    throw new Error(
      `Lock proof destChainId mismatch: expected ${config.destination.chainId}, got ${artifact.destChainId}`
    );
  }
}

function assertMintProofConsistency(
  config: StageSubmissionConfig,
  destinationTx: ConnectorTxSnapshot,
  artifact: RelayStageResult["proof"]
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(
      `Mint proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`
    );
  }
  assertAddressMatch(
    "Mint proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector
  );
  if (artifact.amount !== destinationTx.amount) {
    throw new Error(
      `Mint proof amount mismatch: expected ${destinationTx.amount}, got ${artifact.amount}`
    );
  }
  assertAddressMatch("Mint proof receiver", destinationTx.to, artifact.receiver);
}

function assertAckProofConsistency(
  config: StageSubmissionConfig,
  artifact: RelayStageResult["proof"]
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(
      `Ack proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`
    );
  }
  assertAddressMatch(
    "Ack proof srcChainConnector",
    config.connectors.source,
    artifact.srcChainConnector
  );
  assertAddressMatch(
    "Ack proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector
  );
}

function assertAddressMatch(
  label: string,
  expected: string,
  actual: string | undefined
): void {
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
  stage: Stage
): Promise<StageVerificationResult> {
  return verifyStageFromConfig(config, stage);
}

// ---------------------------------------------------------------------------
// Core shared preparation API (no private key / signing required)
// ---------------------------------------------------------------------------

/**
 * Performs the full verified preparation sequence for one relay stage:
 *   1. Stage verification via Colibri (or local RPC fallback)
 *   2. Proof generation
 *   3. Proof consistency checks against on-chain data
 *   4. Unsigned contract-call payload construction
 *
 * This is the single authoritative path used by both the local agent and the
 * CLI relay commands.  The browser wallet signs and submits; we only prepare.
 */
export async function prepareStageSubmission(
  config: StageSubmissionConfig,
  stage: RelayProofStage
): Promise<StageSubmissionResult> {
  const verifyStageKey = RELAY_STAGE_TO_VERIFY_STAGE[stage];
  const stageDef = STAGE_DEFINITIONS[verifyStageKey];

  // Read-only providers for verification and tx-snapshot fetches
  const sourceProvider = new JsonRpcProvider(config.source.rpcUrls[0], config.source.chainId);
  const destinationProvider = new JsonRpcProvider(config.destination.rpcUrls[0], config.destination.chainId);
  const sourceReadContract = new Contract(config.connectors.source, CONNECTOR_ABI, sourceProvider);
  const destinationReadContract = new Contract(config.connectors.destination, CONNECTOR_ABI, destinationProvider);

  // 1. Stage verification
  let verification: StageVerificationResult;
  if (stage === "ack" && config.allowPrunedSourceAck) {
    verification = await verifyAckEventOnly({
      stage: "source-ack-ready",
      chain: config.source,
      connector: config.connectors.source,
      txId: config.txId,
      expectedSrcConnector: config.connectors.source,
      expectedDstConnector: config.connectors.destination,
      blockTag: config.executionBlocks.sourceAckReady
    });
  } else {
    verification = await verifyStageFromConfig(config, verifyStageKey);
  }

  // Execution block for this stage
  const executionBlock: BlockTagInput =
    stage === "lock"
      ? (config.executionBlocks.sourceDeposit ?? "latest")
      : stage === "mint"
        ? (config.executionBlocks.destinationFundsReleased ?? "latest")
        : (config.executionBlocks.sourceAckReady ?? "latest");

  // 2. Proof generation
  const proof = await runProof({
    stage,
    backend: config.proofBackend,
    txId: config.txId,
    rpcUrl: stageDef.side === "source" ? config.source.rpcUrls[0] : config.destination.rpcUrls[0],
    connector: stageDef.side === "source" ? config.connectors.source : config.connectors.destination,
    sourceChainId: config.source.chainId,
    destinationChainId: config.destination.chainId,
    executionBlock,
    repoRoot: config.repoRoot,
    proofPaths: config.proofPaths,
    risc0ProverMode: config.risc0ProverMode
  });

  // 3. Proof consistency checks
  if (stage === "lock") {
    const sourceTx = await fetchTxSnapshot(sourceReadContract, config.txId, config.executionBlocks.sourceDeposit);
    assertLockProofConsistency(config, sourceTx, proof);
  } else if (stage === "mint") {
    const destinationTx = await fetchTxSnapshot(destinationReadContract, config.txId, config.executionBlocks.destinationFundsReleased);
    assertMintProofConsistency(config, destinationTx, proof);
  } else {
    assertAckProofConsistency(config, proof);
  }

  // 4. Build unsigned payload
  const submissionSide: Record<RelayProofStage, "source" | "destination"> = {
    lock: "destination",
    mint: "source",
    ack: "destination"
  };
  const targetSide = submissionSide[stage];
  const targetChainId = targetSide === "source" ? config.source.chainId : config.destination.chainId;
  const targetConnector = targetSide === "source" ? config.connectors.source : config.connectors.destination;

  let contractArgs: unknown[];
  if (stage === "lock") {
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
      proof.sourceChainId
    ];
  } else {
    contractArgs = [0, proof.proofPayload, config.txId];
  }

  const payload: StageReadyPayload = {
    stage,
    proofPayload: proof.proofPayload,
    contractMethod: RELAY_STAGE_TO_SUBMISSION_METHOD[stage],
    contractArgs,
    targetChainId,
    targetConnector
  };

  return { proof, payload, verification };
}

// ---------------------------------------------------------------------------
// CLI relay commands — thin wrappers over prepareStageSubmission + submission
// ---------------------------------------------------------------------------

export async function runRelayLock(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "lock");
  const handles = await createChainHandles(config);

  const submitTx = await handles.destinationWriteContract.submitLockProof(
    ...payload.contractArgs
  );

  const receiptBlock = await waitForSubmission(submitTx, "lock");
  const resultingStatus = await getStatus(handles.destinationReadContract, config.txId);

  if (resultingStatus !== 4) {
    throw new Error(`Destination status mismatch after relay-lock: expected 4, got ${resultingStatus}`);
  }

  return { verification, proof, submission: { stage: "lock", txHash: submitTx.hash, receiptBlock, resultingStatus } };
}

export async function runRelayMint(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "mint");
  const handles = await createChainHandles(config);

  const submitTx = await handles.sourceWriteContract.submitMintProof(...payload.contractArgs);

  const receiptBlock = await waitForSubmission(submitTx, "mint");
  const resultingStatus = await getStatus(handles.sourceReadContract, config.txId);

  if (resultingStatus !== 2) {
    throw new Error(`Source status mismatch after relay-mint: expected 2, got ${resultingStatus}`);
  }

  return { verification, proof, submission: { stage: "mint", txHash: submitTx.hash, receiptBlock, resultingStatus } };
}

export async function runRelayAck(config: RelayConfig): Promise<RelayStageResult> {
  const { proof, payload, verification } = await prepareStageSubmission(config, "ack");
  const handles = await createChainHandles(config);

  const submitTx = await handles.destinationWriteContract.submitAckProof(...payload.contractArgs);

  const receiptBlock = await waitForSubmission(submitTx, "ack");
  const resultingStatus = await getStatus(handles.destinationReadContract, config.txId);

  if (resultingStatus !== 0) {
    throw new Error(`Destination status mismatch after relay-ack: expected 0, got ${resultingStatus}`);
  }

  return { verification, proof, submission: { stage: "ack", txHash: submitTx.hash, receiptBlock, resultingStatus } };
}

function withExecutionBlockOverrides(
  config: RelayConfig,
  overrides: Partial<StageExecutionBlocks>
): RelayConfig {
  return {
    ...config,
    executionBlocks: {
      ...config.executionBlocks,
      ...overrides
    }
  };
}

export async function runRelayHappyPath(config: RelayConfig): Promise<HappyPathResult> {
  const lock = await runRelayLock(config);

  const mintConfig = withExecutionBlockOverrides(config, {
    destinationFundsReleased:
      config.executionBlocks.destinationFundsReleased ??
      lock.submission.receiptBlock
  });
  const mint = await runRelayMint(mintConfig);

  const ackConfig = withExecutionBlockOverrides(config, {
    sourceAckReady: config.executionBlocks.sourceAckReady ?? mint.submission.receiptBlock
  });
  const ack = await runRelayAck(ackConfig);

  return {
    lock,
    mint,
    ack
  };
}
