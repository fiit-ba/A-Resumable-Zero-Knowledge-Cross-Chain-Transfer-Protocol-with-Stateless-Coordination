import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RELAY_STAGE_REGISTRY } from "./stages.js";
import type { ProofArtifact, ProofRelayStage, ProofRunnerInput } from "../core/types.js";
import {
  assert,
  normalizeAddress,
  normalizeBlockTag,
  normalizeBytes32,
  readPositiveIntEnv,
  toRpcBlockTag,
} from "../core/utils.js";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const PROOF_LINE_REGEX = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/;
const DEFAULT_PROOF_TIMEOUT_SEC = 30 * 60;

// ---------------------------------------------------------------------------
// Per-stage proof host inputs
// ---------------------------------------------------------------------------

type HostInput = "sourceChainId" | "destinationChainId" | "ackDeadline";

/** How one input is passed to the proof host: as a cargo CLI flag or a Docker env var. */
interface HostInputBinding {
  input: HostInput;
  flag: string;
  env: string;
}

const SOURCE_CHAIN: HostInputBinding = {
  input: "sourceChainId",
  flag: "--source-chain-id",
  env: "SOURCE_CHAIN_ID",
};
const DEST_CHAIN: HostInputBinding = {
  input: "destinationChainId",
  flag: "--destination-chain-id",
  env: "DEST_CHAIN_ID",
};
const DEST_CHAIN_SHORT_FLAG: HostInputBinding = { ...DEST_CHAIN, flag: "--dest-chain-id" };
const ACK_DEADLINE: HostInputBinding = {
  input: "ackDeadline",
  flag: "--ack-deadline",
  env: "ACK_DEADLINE",
};

/**
 * Inputs each proof host consumes. Flag and env names intentionally differ
 * between hosts; they must match the host CLIs and the Docker wrapper scripts
 * under zk-proofs/risc_zero/*_event.
 */
const PROOF_HOST_INPUTS: Record<
  ProofRelayStage,
  { bindings: HostInputBinding[]; extraRequired?: HostInput[] }
> = {
  lock: { bindings: [SOURCE_CHAIN, DEST_CHAIN] },
  mint: { bindings: [{ ...DEST_CHAIN, env: "DESTINATION_CHAIN_ID" }] },
  ack: { bindings: [SOURCE_CHAIN, DEST_CHAIN] },
  "refund-claim": { bindings: [SOURCE_CHAIN], extraRequired: ["destinationChainId"] },
  "burn-proof": { bindings: [SOURCE_CHAIN, DEST_CHAIN_SHORT_FLAG] },
  "non-accept-proof": { bindings: [ACK_DEADLINE, SOURCE_CHAIN, DEST_CHAIN_SHORT_FLAG] },
};

// ---------------------------------------------------------------------------
// Per-stage proof output fields
// ---------------------------------------------------------------------------

type AddressField =
  | "sender"
  | "receiver"
  | "currencyFrom"
  | "currencyTo"
  | "srcChainConnector"
  | "dstChainConnector";
type BigIntField = "amount" | "originAckDeadline" | "nonce";
type NumberField = "sourceChainId" | "destChainId";

/** Maps a `key: value` line of proof host output onto a typed ProofArtifact field. */
type ArtifactField =
  | { kind: "address"; key: string; target: AddressField }
  | { kind: "bigint"; key: string; target: BigIntField }
  | { kind: "number"; key: string; target: NumberField };

const address = (target: AddressField, key: string = target): ArtifactField => ({
  kind: "address",
  key,
  target,
});
const bigint = (target: BigIntField, key: string = target): ArtifactField => ({
  kind: "bigint",
  key,
  target,
});
const number = (target: NumberField, key: string = target): ArtifactField => ({
  kind: "number",
  key,
  target,
});

/** Fields each proof host must print besides `proofPayload` and `txId`. */
const ARTIFACT_FIELDS: Record<ProofRelayStage, ArtifactField[]> = {
  lock: [
    bigint("amount"),
    address("sender"),
    address("receiver"),
    address("currencyFrom"),
    address("currencyTo"),
    address("srcChainConnector"),
    address("dstChainConnector"),
    bigint("originAckDeadline"),
    bigint("nonce"),
    number("sourceChainId"),
    number("destChainId"),
  ],
  mint: [bigint("amount"), address("receiver"), address("dstChainConnector")],
  ack: [address("srcChainConnector"), address("dstChainConnector")],
  "refund-claim": [],
  "burn-proof": [],
  "non-accept-proof": [
    address("dstChainConnector"),
    // The non-accept host prints the deadline as `ackDeadline`.
    bigint("originAckDeadline", "ackDeadline"),
    number("sourceChainId"),
    number("destChainId", "destinationChainId"),
  ],
};

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
  return (
    (readPositiveIntEnv("STATELESS_CLIENT_PROOF_TIMEOUT_SEC") ?? DEFAULT_PROOF_TIMEOUT_SEC) * 1000
  );
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

  for (const field of ARTIFACT_FIELDS[stage]) {
    const raw = requireMetadataField(metadata, field.key, stage);
    switch (field.kind) {
      case "address":
        artifact[field.target] = normalizeAddress(raw, field.key);
        break;
      case "bigint":
        artifact[field.target] = parseBigIntField(raw, field.key);
        break;
      case "number":
        artifact[field.target] = parseNumberField(raw, field.key);
        break;
    }
  }

  return artifact;
}

function ensureStageChainInputs(input: ProofRunnerInput): void {
  const { bindings, extraRequired = [] } = PROOF_HOST_INPUTS[input.stage];
  for (const required of [...bindings.map((binding) => binding.input), ...extraRequired]) {
    assert(input[required] !== undefined, `${input.stage} proof requires ${required}`);
  }
}

export async function runProof(input: ProofRunnerInput): Promise<ProofArtifact> {
  ensureStageChainInputs(input);

  const hostConfig = RELAY_STAGE_REGISTRY[input.stage].proofHost;
  assert(hostConfig, `No proof host configured for stage '${input.stage}'`);
  const { bindings } = PROOF_HOST_INPUTS[input.stage];
  const executionBlock = toRpcBlockTag(normalizeBlockTag(input.executionBlock, "latest"));
  const timeoutMs = resolveProofTimeoutMs();
  console.error(
    `[proof-runner] stage=${input.stage} backend=${input.backend} proverMode=${input.risc0ProverMode} timeoutSec=${timeoutMs / 1000} rpc=${redactRpcUrl(input.rpcUrl)}`,
  );

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

    for (const binding of bindings) {
      args.push(binding.flag, String(input[binding.input]));
    }

    result = await runCommand("cargo", args, {
      cwd: input.proofPaths[hostConfig.workspaceKey],
      env,
      timeoutMs,
    });
  } else {
    const scriptPath = input.proofPaths[hostConfig.dockerScriptKey];

    env.PROVER_ACTION = "prove";
    for (const binding of bindings) {
      env[binding.env] = String(input[binding.input]);
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
