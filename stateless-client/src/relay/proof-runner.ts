import { spawn } from "node:child_process";
import { RELAY_STAGE_TO_PROOF_HOST } from "./stages.js";
import type {
  ProofArtifact,
  ProofRunnerInput,
  RelayProofStage,
} from "../core/types.js";
import { assert, normalizeAddress, normalizeBytes32 } from "../core/utils.js";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const PROOF_LINE_REGEX = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/;

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

function parseKeyValueOutput(output: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(PROOF_LINE_REGEX);
    if (!match) {
      continue;
    }
    metadata[match[1]] = match[2].trim();
  }
  return metadata;
}

function requireMetadataField(
  metadata: Record<string, string>,
  key: string,
  stage: RelayProofStage,
): string {
  const value = metadata[key];
  if (!value) {
    throw new Error(
      `Missing required proof field '${key}' in ${stage} proof output.`,
    );
  }
  return value;
}

function ensureHex(value: string, fieldName: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ${fieldName}: expected hex string, got '${value}'`,
    );
  }
  return value;
}

function parseBigIntField(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Invalid ${fieldName}: expected unsigned integer, got '${value}'`,
    );
  }
  return BigInt(value);
}

function parseNumberField(value: string, fieldName: string): number {
  const asBigInt = parseBigIntField(value, fieldName);
  const asNumber = Number(asBigInt);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(
      `Invalid ${fieldName}: value too large for number '${value}'`,
    );
  }
  return asNumber;
}

export function parseProofArtifact(
  stage: RelayProofStage,
  backend: ProofRunnerInput["backend"],
  output: string,
): ProofArtifact {
  const metadata = parseKeyValueOutput(output);
  const proofPayload = ensureHex(
    requireMetadataField(metadata, "proofPayload", stage),
    "proofPayload",
  );

  const txId = normalizeBytes32(
    requireMetadataField(metadata, "txId", stage),
    "txId",
  );

  const artifact: ProofArtifact = {
    stage,
    backend,
    proofPayload,
    txId,
    metadata,
    rawOutput: output,
  };

  if (stage === "lock") {
    artifact.amount = parseBigIntField(
      requireMetadataField(metadata, "amount", stage),
      "amount",
    );
    artifact.sender = normalizeAddress(
      requireMetadataField(metadata, "sender", stage),
      "sender",
    );
    artifact.receiver = normalizeAddress(
      requireMetadataField(metadata, "receiver", stage),
      "receiver",
    );
    artifact.currencyFrom = normalizeAddress(
      requireMetadataField(metadata, "currencyFrom", stage),
      "currencyFrom",
    );
    artifact.currencyTo = normalizeAddress(
      requireMetadataField(metadata, "currencyTo", stage),
      "currencyTo",
    );
    artifact.srcChainConnector = normalizeAddress(
      requireMetadataField(metadata, "srcChainConnector", stage),
      "srcChainConnector",
    );
    artifact.dstChainConnector = normalizeAddress(
      requireMetadataField(metadata, "dstChainConnector", stage),
      "dstChainConnector",
    );
    artifact.originAckDeadline = parseBigIntField(
      requireMetadataField(metadata, "originAckDeadline", stage),
      "originAckDeadline",
    );
    artifact.nonce = parseBigIntField(
      requireMetadataField(metadata, "nonce", stage),
      "nonce",
    );
    artifact.sourceChainId = parseNumberField(
      requireMetadataField(metadata, "sourceChainId", stage),
      "sourceChainId",
    );
    artifact.destChainId = parseNumberField(
      requireMetadataField(metadata, "destChainId", stage),
      "destChainId",
    );
  }

  if (stage === "mint") {
    artifact.amount = parseBigIntField(
      requireMetadataField(metadata, "amount", stage),
      "amount",
    );
    artifact.receiver = normalizeAddress(
      requireMetadataField(metadata, "receiver", stage),
      "receiver",
    );
    artifact.dstChainConnector = normalizeAddress(
      requireMetadataField(metadata, "dstChainConnector", stage),
      "dstChainConnector",
    );
  }

  if (stage === "ack") {
    artifact.srcChainConnector = normalizeAddress(
      requireMetadataField(metadata, "srcChainConnector", stage),
      "srcChainConnector",
    );
    artifact.dstChainConnector = normalizeAddress(
      requireMetadataField(metadata, "dstChainConnector", stage),
      "dstChainConnector",
    );
  }

  return artifact;
}

function ensureStageChainInputs(input: ProofRunnerInput): void {
  if (input.stage === "lock") {
    assert(
      input.sourceChainId !== undefined,
      "lock proof requires sourceChainId",
    );
    assert(
      input.destinationChainId !== undefined,
      "lock proof requires destinationChainId",
    );
  }

  if (input.stage === "mint") {
    assert(
      input.destinationChainId !== undefined,
      "mint proof requires destinationChainId",
    );
  }

  if (input.stage === "ack") {
    assert(
      input.sourceChainId !== undefined,
      "ack proof requires sourceChainId",
    );
  }
}

export async function runProof(
  input: ProofRunnerInput,
): Promise<ProofArtifact> {
  ensureStageChainInputs(input);

  const hostConfig = RELAY_STAGE_TO_PROOF_HOST[input.stage];
  const executionBlock = String(input.executionBlock);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RPC_URL: input.rpcUrl,
    EXECUTION_BLOCK: executionBlock,
    CONNECTOR: input.connector,
    TX_ID: input.txId,
    RISC0_PROVER_MODE: input.risc0ProverMode,
    RISC0_PROVER: input.risc0ProverMode,
  };

  let result: CommandResult;
  if (input.backend === "local") {
    const args = [
      "run",
      "-p",
      hostConfig.localPackage,
      "--bin",
      hostConfig.localBin,
      "--",
      "--connector",
      input.connector,
      "--tx-id",
      input.txId,
    ];

    if (input.stage === "lock") {
      args.push(
        "--source-chain-id",
        String(input.sourceChainId),
        "--destination-chain-id",
        String(input.destinationChainId),
      );
    }

    if (input.stage === "mint") {
      args.push("--destination-chain-id", String(input.destinationChainId));
    }

    if (input.stage === "ack") {
      args.push("--source-chain-id", String(input.sourceChainId));
    }

    result = await runCommand("cargo", args, {
      cwd: input.proofPaths[hostConfig.workspaceKey],
      env,
    });
  } else {
    const scriptPath = input.proofPaths[hostConfig.dockerScriptKey];

    if (input.stage === "lock") {
      env.PROVER_ACTION = "prove";
      env.SOURCE_CHAIN_ID = String(input.sourceChainId);
      env.DEST_CHAIN_ID = String(input.destinationChainId);
    }

    if (input.stage === "mint") {
      env.PROVER_ACTION = "prove";
      env.DESTINATION_CHAIN_ID = String(input.destinationChainId);
    }

    if (input.stage === "ack") {
      env.PROVER_ACTION = "prove";
      env.SOURCE_CHAIN_ID = String(input.sourceChainId);
    }

    result = await runCommand("bash", [scriptPath], {
      cwd: input.repoRoot,
      env,
    });
  }

  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter((chunk) => chunk.length > 0)
    .join("\n");

  if (result.exitCode !== 0) {
    throw new Error(
      `Proof host failed for stage '${input.stage}' with exit code ${result.exitCode}.\n${output}`,
    );
  }

  return parseProofArtifact(input.stage, input.backend, output);
}
