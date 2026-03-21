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
import { STAGE_DEFINITIONS } from "./stages.js";
import type {
  BlockTagInput,
  HappyPathResult,
  RelayConfig,
  RelayStageResult,
  Stage,
  StageExecutionBlocks,
  StageVerificationResult,
  VerificationConfig
} from "../core/types.js";
import { normalizeAddress, normalizeBytes32 } from "../core/utils.js";
import { verifyStage } from "./verification.js";

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
  config: RelayConfig,
  sourceTx: ConnectorTxSnapshot,
  artifact: RelayStageResult["proof"]
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(
      `Lock proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`
    );
  }
  if (artifact.srcChainConnector !== config.connectors.source) {
    throw new Error(
      `Lock proof srcChainConnector mismatch: expected ${config.connectors.source}, got ${artifact.srcChainConnector}`
    );
  }
  if (artifact.dstChainConnector !== config.connectors.destination) {
    throw new Error(
      `Lock proof dstChainConnector mismatch: expected ${config.connectors.destination}, got ${artifact.dstChainConnector}`
    );
  }
  if (artifact.amount !== sourceTx.amount) {
    throw new Error(
      `Lock proof amount mismatch: expected ${sourceTx.amount}, got ${artifact.amount}`
    );
  }
  if (artifact.receiver !== sourceTx.to) {
    throw new Error(
      `Lock proof receiver mismatch: expected ${sourceTx.to}, got ${artifact.receiver}`
    );
  }
  if (artifact.sender !== sourceTx.from) {
    throw new Error(
      `Lock proof sender mismatch: expected ${sourceTx.from}, got ${artifact.sender}`
    );
  }
  if (artifact.currencyFrom !== sourceTx.currencyFrom) {
    throw new Error(
      `Lock proof currencyFrom mismatch: expected ${sourceTx.currencyFrom}, got ${artifact.currencyFrom}`
    );
  }
  if (artifact.currencyTo !== sourceTx.currencyTo) {
    throw new Error(
      `Lock proof currencyTo mismatch: expected ${sourceTx.currencyTo}, got ${artifact.currencyTo}`
    );
  }
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
  config: RelayConfig,
  destinationTx: ConnectorTxSnapshot,
  artifact: RelayStageResult["proof"]
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(
      `Mint proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`
    );
  }
  if (artifact.dstChainConnector !== config.connectors.destination) {
    throw new Error(
      `Mint proof dstChainConnector mismatch: expected ${config.connectors.destination}, got ${artifact.dstChainConnector}`
    );
  }
  if (artifact.amount !== destinationTx.amount) {
    throw new Error(
      `Mint proof amount mismatch: expected ${destinationTx.amount}, got ${artifact.amount}`
    );
  }
  if (artifact.receiver !== destinationTx.to) {
    throw new Error(
      `Mint proof receiver mismatch: expected ${destinationTx.to}, got ${artifact.receiver}`
    );
  }
}

function assertAckProofConsistency(
  config: RelayConfig,
  artifact: RelayStageResult["proof"]
): void {
  const expectedTxId = normalizeBytes32(config.txId, "tx-id");
  if (artifact.txId !== expectedTxId) {
    throw new Error(
      `Ack proof txId mismatch: expected ${expectedTxId}, got ${artifact.txId}`
    );
  }
  if (artifact.srcChainConnector !== config.connectors.source) {
    throw new Error(
      `Ack proof srcChainConnector mismatch: expected ${config.connectors.source}, got ${artifact.srcChainConnector}`
    );
  }
  if (artifact.dstChainConnector !== config.connectors.destination) {
    throw new Error(
      `Ack proof dstChainConnector mismatch: expected ${config.connectors.destination}, got ${artifact.dstChainConnector}`
    );
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

export async function runRelayLock(config: RelayConfig): Promise<RelayStageResult> {
  const handles = await createChainHandles(config);
  const verification = await verifyStageFromConfig(config, "source-deposit");

  const sourceTx = await fetchTxSnapshot(
    handles.sourceReadContract,
    config.txId,
    config.executionBlocks.sourceDeposit
  );

  const proof = await runProof({
    stage: "lock",
    backend: config.proofBackend,
    txId: config.txId,
    rpcUrl: config.source.rpcUrls[0],
    connector: config.connectors.source,
    sourceChainId: config.source.chainId,
    destinationChainId: config.destination.chainId,
    executionBlock: config.executionBlocks.sourceDeposit ?? "latest",
    repoRoot: config.repoRoot,
    proofPaths: config.proofPaths,
    risc0ProverMode: config.risc0ProverMode
  });

  assertLockProofConsistency(config, sourceTx, proof);

  const submitTx = await handles.destinationWriteContract.submitLockProof(
    0,
    proof.proofPayload,
    config.txId,
    proof.amount,
    proof.currencyFrom,
    proof.currencyTo,
    proof.sender,
    proof.receiver,
    proof.srcChainConnector,
    proof.originAckDeadline,
    proof.nonce,
    proof.sourceChainId
  );

  const receiptBlock = await waitForSubmission(submitTx, "lock");
  const resultingStatus = await getStatus(
    handles.destinationReadContract,
    config.txId
  );

  if (resultingStatus !== 4) {
    throw new Error(
      `Destination status mismatch after relay-lock: expected 4, got ${resultingStatus}`
    );
  }

  return {
    verification,
    proof,
    submission: {
      stage: "lock",
      txHash: submitTx.hash,
      receiptBlock,
      resultingStatus
    }
  };
}

export async function runRelayMint(config: RelayConfig): Promise<RelayStageResult> {
  const handles = await createChainHandles(config);
  const verification = await verifyStageFromConfig(
    config,
    "destination-funds-released"
  );

  const destinationTx = await fetchTxSnapshot(
    handles.destinationReadContract,
    config.txId,
    config.executionBlocks.destinationFundsReleased
  );

  const proof = await runProof({
    stage: "mint",
    backend: config.proofBackend,
    txId: config.txId,
    rpcUrl: config.destination.rpcUrls[0],
    connector: config.connectors.destination,
    destinationChainId: config.destination.chainId,
    executionBlock: config.executionBlocks.destinationFundsReleased ?? "latest",
    repoRoot: config.repoRoot,
    proofPaths: config.proofPaths,
    risc0ProverMode: config.risc0ProverMode
  });

  assertMintProofConsistency(config, destinationTx, proof);

  const submitTx = await handles.sourceWriteContract.submitMintProof(
    0,
    proof.proofPayload,
    config.txId
  );

  const receiptBlock = await waitForSubmission(submitTx, "mint");
  const resultingStatus = await getStatus(handles.sourceReadContract, config.txId);

  if (resultingStatus !== 2) {
    throw new Error(
      `Source status mismatch after relay-mint: expected 2, got ${resultingStatus}`
    );
  }

  return {
    verification,
    proof,
    submission: {
      stage: "mint",
      txHash: submitTx.hash,
      receiptBlock,
      resultingStatus
    }
  };
}

export async function runRelayAck(config: RelayConfig): Promise<RelayStageResult> {
  const handles = await createChainHandles(config);
  const verification = await verifyStageFromConfig(config, "source-ack-ready");

  const proof = await runProof({
    stage: "ack",
    backend: config.proofBackend,
    txId: config.txId,
    rpcUrl: config.source.rpcUrls[0],
    connector: config.connectors.source,
    sourceChainId: config.source.chainId,
    executionBlock: config.executionBlocks.sourceAckReady ?? "latest",
    repoRoot: config.repoRoot,
    proofPaths: config.proofPaths,
    risc0ProverMode: config.risc0ProverMode
  });

  assertAckProofConsistency(config, proof);

  const submitTx = await handles.destinationWriteContract.submitAckProof(
    0,
    proof.proofPayload,
    config.txId
  );

  const receiptBlock = await waitForSubmission(submitTx, "ack");
  const resultingStatus = await getStatus(
    handles.destinationReadContract,
    config.txId
  );

  if (resultingStatus !== 0) {
    throw new Error(
      `Destination status mismatch after relay-ack: expected 0, got ${resultingStatus}`
    );
  }

  return {
    verification,
    proof,
    submission: {
      stage: "ack",
      txHash: submitTx.hash,
      receiptBlock,
      resultingStatus
    }
  };
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
