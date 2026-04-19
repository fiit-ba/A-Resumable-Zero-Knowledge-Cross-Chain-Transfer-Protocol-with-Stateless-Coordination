import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RELAY_STAGE_TO_PROOF_HOST } from "./stages.js";
import type { ProofArtifact, ProofRelayStage, ProofRunnerInput } from "../core/types.js";
import {
  assert,
  normalizeAddress,
  normalizeBlockTag,
  normalizeBytes32,
  toRpcBlockTag,
} from "../core/utils.js";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const PROOF_LINE_REGEX = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/;

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
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
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let killHandle: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        stderr += `\n[proof-runner] proof process timed out after ${options.timeoutMs} ms`;
        child.kill("SIGTERM");
        killHandle = setTimeout(() => {
          child.kill("SIGKILL");
        }, 5000);
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      // Stream host progress markers (e.g. "Starting Groth16 proving...") immediately.
      process.stderr.write(chunk);
    });

    child.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
      });
    });
  });
}

function resolveProofTimeoutMs(): number {
  const raw = process.env["STATELESS_CLIENT_PROOF_TIMEOUT_SEC"];
  if (!raw || !/^\d+$/.test(raw)) {
    return 30 * 60 * 1000; // 30 minutes
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return 30 * 60 * 1000;
  }
  return seconds * 1000;
}

function detectR0vmBinary(): string | undefined {
  const risc0Home = process.env["RISC0_HOME"] ?? join(homedir(), ".risc0");
  const extDir = join(risc0Home, "extensions");
  if (!existsSync(extDir)) {
    return undefined;
  }
  const candidates: string[] = [];
  for (const entry of readdirSync(extDir)) {
    if (!entry.includes("-cargo-risczero-")) continue;
    const candidate = join(extDir, entry, "r0vm");
    if (existsSync(candidate)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort();
  return candidates[candidates.length - 1];
}

function redactRpcUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw;
  }
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
  stage: ProofRelayStage,
): string {
  const value = metadata[key];
  if (!value) {
    throw new Error(`Missing required proof field '${key}' in ${stage} proof output.`);
  }
  return value;
}

function ensureHex(value: string, fieldName: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: expected hex string, got '${value}'`);
  }
  return value;
}

function parseBigIntField(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: expected unsigned integer, got '${value}'`);
  }
  return BigInt(value);
}

function parseNumberField(value: string, fieldName: string): number {
  const asBigInt = parseBigIntField(value, fieldName);
  const asNumber = Number(asBigInt);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`Invalid ${fieldName}: value too large for number '${value}'`);
  }
  return asNumber;
}

export function parseProofArtifact(
  stage: ProofRelayStage,
  backend: ProofRunnerInput["backend"],
  output: string,
): ProofArtifact {
  const metadata = parseKeyValueOutput(output);
  const proofPayload = ensureHex(
    requireMetadataField(metadata, "proofPayload", stage),
    "proofPayload",
  );

  const txId = normalizeBytes32(requireMetadataField(metadata, "txId", stage), "txId");

  const artifact: ProofArtifact = {
    stage,
    backend,
    proofPayload,
    txId,
    metadata,
    rawOutput: output,
  };

  if (stage === "lock") {
    artifact.amount = parseBigIntField(requireMetadataField(metadata, "amount", stage), "amount");
    artifact.sender = normalizeAddress(requireMetadataField(metadata, "sender", stage), "sender");
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
    artifact.nonce = parseBigIntField(requireMetadataField(metadata, "nonce", stage), "nonce");
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
    artifact.amount = parseBigIntField(requireMetadataField(metadata, "amount", stage), "amount");
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

  if (stage === "non-accept-proof") {
    artifact.dstChainConnector = normalizeAddress(
      requireMetadataField(metadata, "dstChainConnector", stage),
      "dstChainConnector",
    );
    // ackDeadline is a u64 in the proof output — parse as bigint, store as originAckDeadline.
    artifact.originAckDeadline = parseBigIntField(
      requireMetadataField(metadata, "ackDeadline", stage),
      "ackDeadline",
    );
    artifact.sourceChainId = parseNumberField(
      requireMetadataField(metadata, "sourceChainId", stage),
      "sourceChainId",
    );
    artifact.destChainId = parseNumberField(
      requireMetadataField(metadata, "destinationChainId", stage),
      "destinationChainId",
    );
  }

  return artifact;
}

function ensureStageChainInputs(input: ProofRunnerInput): void {
  if (input.stage === "lock") {
    assert(input.sourceChainId !== undefined, "lock proof requires sourceChainId");
    assert(input.destinationChainId !== undefined, "lock proof requires destinationChainId");
  }

  if (input.stage === "mint") {
    assert(input.destinationChainId !== undefined, "mint proof requires destinationChainId");
  }

  if (input.stage === "ack") {
    assert(input.sourceChainId !== undefined, "ack proof requires sourceChainId");
  }

  if (input.stage === "non-accept-proof") {
    assert(input.sourceChainId !== undefined, "non-accept-proof requires sourceChainId");
    assert(input.destinationChainId !== undefined, "non-accept-proof requires destinationChainId");
    assert(input.ackDeadline !== undefined, "non-accept-proof requires ackDeadline");
  }
}

export async function runProof(input: ProofRunnerInput): Promise<ProofArtifact> {
  ensureStageChainInputs(input);

  console.error(
    `[proof-runner] stage=${input.stage} backend=${input.backend} proverMode=${input.risc0ProverMode} rpc=${redactRpcUrl(input.rpcUrl)}`,
  );

  const hostConfig = RELAY_STAGE_TO_PROOF_HOST[input.stage];
  const executionBlock = toRpcBlockTag(normalizeBlockTag(input.executionBlock, "latest"));
  const timeoutMs = resolveProofTimeoutMs();
  const proofStartMs = Date.now();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RPC_URL: input.rpcUrl,
    EXECUTION_BLOCK: executionBlock,
    CONNECTOR: input.connector,
    TX_ID: input.txId,
    RISC0_PROVER_MODE: input.risc0ProverMode,
    RISC0_PROVER: input.risc0ProverMode,
  };
  if (env.RISC0_VM && !existsSync(env.RISC0_VM)) {
    console.warn(`[proof-runner] ignoring non-existent RISC0_VM='${env.RISC0_VM}'`);
    delete env.RISC0_VM;
  }
  if (!env.RISC0_VM) {
    const detectedR0vm = detectR0vmBinary();
    if (detectedR0vm) {
      env.RISC0_VM = detectedR0vm;
      console.error(`[proof-runner] detected RISC0_VM=${detectedR0vm}`);
    }
  }

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

    if (input.stage === "non-accept-proof") {
      args.push(
        "--ack-deadline",
        String(input.ackDeadline),
        "--source-chain-id",
        String(input.sourceChainId),
        "--dest-chain-id",
        String(input.destinationChainId),
      );
    }

    result = await runCommand("cargo", args, {
      cwd: input.proofPaths[hostConfig.workspaceKey],
      env,
      timeoutMs,
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

    if (input.stage === "non-accept-proof") {
      env.PROVER_ACTION = "prove";
      env.ACK_DEADLINE = String(input.ackDeadline);
      env.SOURCE_CHAIN_ID = String(input.sourceChainId);
      env.DEST_CHAIN_ID = String(input.destinationChainId);
    }

    result = await runCommand("bash", [scriptPath], {
      cwd: input.repoRoot,
      env,
      timeoutMs,
    });
  }

  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter((chunk) => chunk.length > 0)
    .join("\n");

  if (result.exitCode !== 0) {
    if (result.timedOut) {
      throw new Error(
        `Proof host timed out for stage '${input.stage}' after ${timeoutMs / 1000}s.\n` +
          `Set STATELESS_CLIENT_PROOF_TIMEOUT_SEC to increase the limit, or switch prover mode/backend.\n${output}`,
      );
    }
    throw new Error(
      `Proof host failed for stage '${input.stage}' with exit code ${result.exitCode}.\n${output}`,
    );
  }

  const artifact = parseProofArtifact(input.stage, input.backend, output);
  const proveTimeMs = artifact.metadata["proveTimeMs"];
  const elapsedMs = Date.now() - proofStartMs;
  if (proveTimeMs) {
    console.error(
      `[proof-runner] stage=${input.stage} proveTimeMs=${proveTimeMs} totalElapsedMs=${elapsedMs}`,
    );
  } else {
    console.error(`[proof-runner] stage=${input.stage} totalElapsedMs=${elapsedMs}`);
  }
  return artifact;
}
