import { Contract, Wallet, type ContractTransactionResponse, type JsonRpcProvider } from "ethers";
import { CONNECTOR_ABI, describeConnectorRevert } from "../contracts/abi.js";
import { runProof } from "./proof-runner.js";
import { RELAY_STAGE_REGISTRY, STAGE_DEFINITIONS, isProofRelayStage } from "./stages.js";
import { SIDES, connectorReaders, endpointFor, type ConnectorReader } from "./endpoints.js";
import { TxStatus } from "../core/types.js";
import type {
  AckVerificationVariant,
  BlockTagInput,
  HappyPathResult,
  ProofArtifact,
  ProofRelayStage,
  RelayConfig,
  RelayProofStage,
  RelayStageResult,
  Side,
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
import { assertSameAddress, normalizeAddress, normalizeBytes32 } from "../core/utils.js";
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

type ConnectorReaders = Record<Side, ConnectorReader>;

const EXECUTION_BLOCK_BY_STAGE: Record<Stage, keyof StageExecutionBlocks> = {
  "source-deposit": "sourceDeposit",
  "destination-funds-released": "destinationFundsReleased",
  "source-ack-ready": "sourceAckReady",
  "source-refund-initiated": "sourceRefundInitiated",
  "destination-burn-executed": "destinationBurnExecuted",
};

// ---------------------------------------------------------------------------
// Verification policy
// ---------------------------------------------------------------------------

async function verifyStageFromConfig(
  config: VerificationConfig,
  stage: Stage,
  verificationPolicy: StageVerificationPolicy,
): Promise<StageVerificationResult> {
  const { chain, connector } = endpointFor(config, STAGE_DEFINITIONS[stage].side);

  return verifyStage({
    stage,
    chain,
    connector,
    txId: config.txId,
    expectedSrcConnector: config.connectors.source,
    expectedDstConnector: config.connectors.destination,
    blockTag: config.executionBlocks[EXECUTION_BLOCK_BY_STAGE[stage]],
    verificationPolicy,
  });
}

/**
 * After submitMintProof the source record is deleted, so an ack must be proven
 * from the AckReady event alone rather than from `getTx` state.
 */
export function shouldUsePrunedAckVerification(
  sourceStatus: number,
  destinationStatus: number,
): boolean {
  return sourceStatus === TxStatus.NONE && destinationStatus === TxStatus.MINTED_IN_HOLDING;
}

function hasPriorDegradedNonLocalProofStage(config: StageSubmissionConfig): boolean {
  const prior = config.verificationHints?.priorProofStageVerifications ?? [];
  return prior.some(
    (entry) =>
      entry.degraded && !endpointFor(config, STAGE_DEFINITIONS[entry.stage].side).chain.isLocal,
  );
}

export function deriveVerificationPolicyForStage(
  config: StageSubmissionConfig,
  stage: Stage,
): StageVerificationPolicy {
  const { chain } = endpointFor(config, STAGE_DEFINITIONS[stage].side);
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

// ---------------------------------------------------------------------------
// On-chain reads and preflight checks
// ---------------------------------------------------------------------------

async function fetchTxSnapshot(
  contract: Contract,
  txId: string,
  blockTag?: BlockTagInput,
): Promise<ConnectorTxSnapshot> {
  const tx = await contract.getTx(txId, { blockTag });

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
  side: Side,
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

// ---------------------------------------------------------------------------
// Proof ↔ chain consistency checks
// ---------------------------------------------------------------------------

function assertArtifactAddress(label: string, expected: string, actual: string | undefined): void {
  if (!actual) {
    throw new Error(`${label} missing in proof artifact`);
  }
  assertSameAddress(label, expected, actual);
}

function assertArtifactValue<T>(label: string, expected: T, actual: T): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function assertArtifactTxId(
  label: string,
  config: StageSubmissionConfig,
  artifact: ProofArtifact,
): void {
  assertArtifactValue(`${label} txId`, normalizeBytes32(config.txId, "tx-id"), artifact.txId);
}

function assertLockProofConsistency(
  config: StageSubmissionConfig,
  sourceTx: ConnectorTxSnapshot,
  artifact: ProofArtifact,
): void {
  assertArtifactTxId("Lock proof", config, artifact);
  const { connectors } = config;
  assertArtifactAddress(
    "Lock proof srcChainConnector",
    connectors.source,
    artifact.srcChainConnector,
  );
  assertArtifactAddress(
    "Lock proof dstChainConnector",
    connectors.destination,
    artifact.dstChainConnector,
  );
  assertArtifactValue("Lock proof amount", sourceTx.amount, artifact.amount);
  assertArtifactAddress("Lock proof receiver", sourceTx.to, artifact.receiver);
  assertArtifactAddress("Lock proof sender", sourceTx.from, artifact.sender);
  assertArtifactAddress("Lock proof currencyFrom", sourceTx.currencyFrom, artifact.currencyFrom);
  assertArtifactAddress("Lock proof currencyTo", sourceTx.currencyTo, artifact.currencyTo);
  assertArtifactValue("Lock proof sourceChainId", config.source.chainId, artifact.sourceChainId);
  assertArtifactValue("Lock proof destChainId", config.destination.chainId, artifact.destChainId);
}

function assertMintProofConsistency(
  config: StageSubmissionConfig,
  destinationTx: ConnectorTxSnapshot,
  artifact: ProofArtifact,
): void {
  assertArtifactTxId("Mint proof", config, artifact);
  assertArtifactAddress(
    "Mint proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector,
  );
  assertArtifactValue("Mint proof amount", destinationTx.amount, artifact.amount);
  assertArtifactAddress("Mint proof receiver", destinationTx.to, artifact.receiver);
}

function assertAckProofConsistency(config: StageSubmissionConfig, artifact: ProofArtifact): void {
  assertArtifactTxId("Ack proof", config, artifact);
  assertArtifactAddress(
    "Ack proof srcChainConnector",
    config.connectors.source,
    artifact.srcChainConnector,
  );
  assertArtifactAddress(
    "Ack proof dstChainConnector",
    config.connectors.destination,
    artifact.dstChainConnector,
  );
}

// ---------------------------------------------------------------------------
// Per-stage behaviour tables
// ---------------------------------------------------------------------------

type StageHook = (config: StageSubmissionConfig, readers: ConnectorReaders) => Promise<void>;

/** Stages that require an ACK-window check before proof preparation. */
const TIMELOCK_PREFLIGHT: Partial<Record<ProofRelayStage, StageHook>> = {
  mint: async (config, { source }) => {
    const sourceTx = await fetchTxSnapshot(
      source.contract,
      config.txId,
      config.executionBlocks.sourceDeposit,
    );
    await assertAckWindowActive("mint", sourceTx, source.provider, "source");
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

/** RISC Zero is proof type 0 (`Enums.ProofType.RISC0`). */
const RISC0_PROOF_TYPE = 0;

const proofOnlyArgs: ContractArgsBuilder = (config, proof) => [
  RISC0_PROOF_TYPE,
  proof.proofPayload,
  config.txId,
];

/** Maps each proof stage to a function that builds the unsigned contract-call argument list. */
const CONTRACT_ARGS_BUILDER: Record<ProofRelayStage, ContractArgsBuilder> = {
  lock: (config, proof) => [
    RISC0_PROOF_TYPE,
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
  mint: proofOnlyArgs,
  ack: proofOnlyArgs,
  "refund-claim": proofOnlyArgs,
  "burn-proof": proofOnlyArgs,
  "non-accept-proof": proofOnlyArgs,
};

type ProofConsistencyChecker = (
  config: StageSubmissionConfig,
  proof: ProofArtifact,
  readers: ConnectorReaders,
) => Promise<void>;

/** Stages that have extra on-chain consistency checks after proof generation. */
const PROOF_CONSISTENCY_CHECKER: Partial<Record<ProofRelayStage, ProofConsistencyChecker>> = {
  lock: async (config, proof, { source }) => {
    const sourceTx = await fetchTxSnapshot(
      source.contract,
      config.txId,
      config.executionBlocks.sourceDeposit,
    );
    assertLockProofConsistency(config, sourceTx, proof);
  },
  mint: async (config, proof, { destination }) => {
    const destinationTx = await fetchTxSnapshot(
      destination.contract,
      config.txId,
      config.executionBlocks.destinationFundsReleased,
    );
    assertMintProofConsistency(config, destinationTx, proof);
  },
  ack: async (config, proof) => {
    assertAckProofConsistency(config, proof);
  },
  // refund-claim, burn-proof and non-accept-proof: no checks beyond the proof host output.
};

// ---------------------------------------------------------------------------
// Core shared preparation API (no private key / signing required)
// ---------------------------------------------------------------------------

export async function runVerifyStageCommand(
  config: VerificationConfig,
  stage: Stage,
): Promise<StageVerificationResult> {
  return verifyStageFromConfig(config, stage, { retryColibriFromScratch: false });
}

function unsignedPayload(
  config: Pick<StageSubmissionConfig, "source" | "destination" | "connectors">,
  stage: RelayProofStage,
  fields: Pick<StageReadyPayload, "actionKind" | "proofPayload" | "contractArgs">,
): StageReadyPayload {
  const spec = RELAY_STAGE_REGISTRY[stage];
  const target = endpointFor(config, spec.submissionSide);
  return {
    stage,
    ...fields,
    contractMethod: spec.submissionMethod,
    targetChainId: target.chain.chainId,
    targetConnector: target.connector,
  };
}

/**
 * Builds a wallet-ready payload for a direct-action stage (no proof required).
 * Direct stages are: refund-initiate (initiateRefund) and execute-burn (executeBurn).
 */
export function buildDirectActionPayload(
  config: Pick<StageSubmissionConfig, "source" | "destination" | "connectors" | "txId">,
  stage: "refund-initiate" | "execute-burn",
): StageReadyPayload {
  return unsignedPayload(config, stage, {
    actionKind: "direct",
    proofPayload: null,
    contractArgs: [config.txId],
  });
}

async function verifyForProofStage(
  config: StageSubmissionConfig,
  stage: ProofRelayStage,
  verifyStageKey: Stage,
): Promise<StageVerificationResult> {
  const verificationPolicy = deriveVerificationPolicyForStage(config, verifyStageKey);
  const ackVariant: AckVerificationVariant = config.verificationHints?.ackVariant ?? "standard";

  if (stage === "ack" && ackVariant === "pruned-source-origin") {
    return verifyAckEventOnly({
      stage: "source-ack-ready",
      chain: config.source,
      connector: config.connectors.source,
      txId: config.txId,
      expectedSrcConnector: config.connectors.source,
      expectedDstConnector: config.connectors.destination,
      blockTag: config.executionBlocks.sourceAckReady,
      verificationPolicy,
    });
  }
  return verifyStageFromConfig(config, verifyStageKey, verificationPolicy);
}

/**
 * Performs the full verified preparation sequence for one relay stage.
 *
 * For proof stages (lock/mint/ack/refund-claim/burn-proof/non-accept-proof):
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
  if (!isProofRelayStage(stage)) {
    return { payload: buildDirectActionPayload(config, stage) };
  }

  const spec = RELAY_STAGE_REGISTRY[stage];
  const verifyStageKey = spec.verifyStage as Stage;
  const readers = connectorReaders(config);

  // Timelock preflight: do not prepare stages that are already expired.
  await TIMELOCK_PREFLIGHT[stage]?.(config, readers);

  const verification = await verifyForProofStage(config, stage, verifyStageKey);

  const executionBlock = EXECUTION_BLOCK_RESOLVER[stage](
    config.executionBlocks,
    verification.eventBlockNumber,
  );

  // The proof host usually reads the same chain it verified; non-accept-proof
  // overrides this to read the destination.
  const proofHost = endpointFor(
    config,
    spec.proofHostSide ?? STAGE_DEFINITIONS[verifyStageKey].side,
  );

  // The non-accept guest checks block_timestamp >= ackDeadline, so it needs the
  // deadline from the source transfer record.
  const ackDeadline =
    stage === "non-accept-proof"
      ? (await fetchTxSnapshot(readers.source.contract, config.txId)).ackDeadline.toString()
      : undefined;

  const proof = await runProof({
    stage,
    backend: config.proofBackend,
    txId: config.txId,
    rpcUrl: proofHost.chain.rpcUrls[0],
    connector: proofHost.connector,
    sourceChainId: config.source.chainId,
    destinationChainId: config.destination.chainId,
    ackDeadline,
    executionBlock,
    repoRoot: config.repoRoot,
    proofPaths: config.proofPaths,
    risc0ProverMode: config.risc0ProverMode,
  });

  await PROOF_CONSISTENCY_CHECKER[stage]?.(config, proof, readers);

  const payload = unsignedPayload(config, stage, {
    actionKind: "proof",
    proofPayload: proof.proofPayload,
    contractArgs: CONTRACT_ARGS_BUILDER[stage](config, proof),
  });

  return { proof, payload, verification };
}

// ---------------------------------------------------------------------------
// CLI relay commands — prepare, sign and submit with a local private key
// ---------------------------------------------------------------------------

export async function runRelayStage(
  config: RelayConfig,
  stage: RelayProofStage,
): Promise<RelayStageResult> {
  const spec = RELAY_STAGE_REGISTRY[stage];

  const { proof, payload, verification } = await prepareStageSubmission(config, stage);

  if (isProofRelayStage(stage) && (!proof || !verification)) {
    throw new Error(`prepareStageSubmission(${stage}) returned an incomplete proof result.`);
  }

  const readers = connectorReaders(config);
  await Promise.all(
    SIDES.map((side) =>
      assertProviderChainId(readers[side].provider, endpointFor(config, side).chain.chainId, side),
    ),
  );

  const target = readers[spec.submissionSide];
  const signer = new Wallet(config.signerPrivateKey, target.provider);
  const writeContract = new Contract(payload.targetConnector, CONNECTOR_ABI, signer);
  const submit = writeContract[spec.submissionMethod] as (
    ...args: unknown[]
  ) => Promise<ContractTransactionResponse>;
  let submitTx: ContractTransactionResponse;
  try {
    submitTx = await submit(...payload.contractArgs);
  } catch (error) {
    const revert = describeConnectorRevert(error);
    if (revert) {
      throw new Error(`${spec.submissionMethod} reverted: ${revert}`, { cause: error });
    }
    throw error;
  }

  const receiptBlock = await waitForSubmission(submitTx, stage);
  const resultingStatus = Number(await target.contract.txStatus(config.txId));

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

/**
 * Runs lock → mint → ack, threading each stage's receipt block and verification
 * outcome into the next stage's config.
 */
export async function runRelayHappyPath(config: RelayConfig): Promise<HappyPathResult> {
  const history: StageVerificationHistoryEntry[] = [];
  const nextConfig = (overrides: Partial<StageExecutionBlocks>): RelayConfig => ({
    ...config,
    executionBlocks: { ...config.executionBlocks, ...overrides },
    verificationHints: { ...config.verificationHints, priorProofStageVerifications: [...history] },
  });
  const record = (result: RelayStageResult) => {
    if (result.verification) history.push(toVerificationHistoryEntry(result.verification));
    return result;
  };

  const lock = record(await runRelayLock(config));
  const mint = record(
    await runRelayMint(
      nextConfig({
        destinationFundsReleased:
          config.executionBlocks.destinationFundsReleased ?? lock.submission.receiptBlock,
      }),
    ),
  );
  const ack = await runRelayAck(
    nextConfig({
      sourceAckReady: config.executionBlocks.sourceAckReady ?? mint.submission.receiptBlock,
    }),
  );

  return { lock, mint, ack };
}
