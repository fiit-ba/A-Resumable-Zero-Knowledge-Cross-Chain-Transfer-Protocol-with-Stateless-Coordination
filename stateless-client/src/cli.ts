#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXECUTION_BLOCK_OPTIONS,
  PROOF_PATH_OPTIONS,
  resolveRelayConfig,
  resolveVerificationConfig,
  type CliOptions,
} from "./config/config.js";
import { loadDefaultEnv } from "./config/env.js";
import { NETWORK_PROFILES } from "./config/profiles.js";
import type {
  RelayConfig,
  RelayProofStage,
  RelayStageResult,
  ResumeResult,
  Stage,
} from "./core/types.js";
import { errorMessage } from "./core/utils.js";
import { runAgentMain } from "./agent/main.js";
import { runRelayHappyPath, runRelayStage, runVerifyStageCommand } from "./relay/relay.js";
import { runRelayResume } from "./relay/resume.js";
import { VERIFY_STAGES, isVerifyStage } from "./relay/stages.js";

/** Commands that prepare, sign and submit exactly one relay stage. */
const SINGLE_STAGE_COMMANDS: Record<string, RelayProofStage> = {
  "relay-lock": "lock",
  "relay-mint": "mint",
  "relay-ack": "ack",
  "relay-non-accept-proof": "non-accept-proof",
};

/** Commands that take a signer and run one or more relay stages. */
const RELAY_COMMANDS: Record<string, (config: RelayConfig, io: CliIo) => Promise<void>> = {
  ...Object.fromEntries(
    Object.entries(SINGLE_STAGE_COMMANDS).map(([command, stage]) => [
      command,
      async (config: RelayConfig, io: CliIo) =>
        printRelayResult(await runRelayStage(config, stage), io),
    ]),
  ),
  "relay-happy-path": async (config, io) => {
    const result = await runRelayHappyPath(config);
    for (const [stage, stageResult] of Object.entries(result)) {
      io.log(`${stage}:`);
      printRelayResult(stageResult, io);
    }
  },
  "relay-resume": async (config, io) => printResumeResult(await runRelayResume(config), io),
};

const SUPPORTED_COMMANDS = new Set(["verify-stage", "agent", ...Object.keys(RELAY_COMMANDS)]);

/** `--source-network` / `--destination-network` are accepted as aliases for the profile options. */
const OPTION_ALIASES: Record<string, string> = {
  "source-network": "source-profile",
  "destination-network": "destination-profile",
};

function usage(): string {
  const relayArgs =
    "--tx-id <bytes32> --private-key <hex> --proof-backend <local|docker> " +
    "--source-connector <address> --destination-connector <address> [network and proof options]";
  const profiles = Object.keys(NETWORK_PROFILES).join("|");
  return [
    "Usage:",
    `  stateless-client verify-stage --stage <${VERIFY_STAGES.join("|")}> --tx-id <bytes32> --source-connector <address> --destination-connector <address> [network options]`,
    ...Object.keys(RELAY_COMMANDS).map((command) => `  stateless-client ${command} ${relayArgs}`),
    "  stateless-client agent <command>",
    "",
    "Common network options:",
    `  --source-profile <${profiles}>  (--source-network is an alias)`,
    `  --destination-profile <${profiles}>  (--destination-network is an alias)`,
    "  --source-chain-id <id> --destination-chain-id <id>",
    "  --source-rpc-url <url> --destination-rpc-url <url>",
    "  --source-rpc-urls <csv> --destination-rpc-urls <csv>",
    "  --source-prover-urls <csv> --destination-prover-urls <csv>",
    "  --source-beacon-urls <csv> --destination-beacon-urls <csv>",
    "  --source-checkpointz-urls <csv> --destination-checkpointz-urls <csv>",
    "  --prover-urls <csv> --beacon-urls <csv> --checkpointz-urls <csv>",
    "",
    "Execution block options:",
    "  --execution-block <tag|number|hex>",
    ...Object.values(EXECUTION_BLOCK_OPTIONS).map((option) => `  --${option} <tag|number|hex>`),
    "",
    "Proof path/runtime options:",
    "  --repo-root <path>",
    ...Object.values(PROOF_PATH_OPTIONS).map((option) => `  --${option} <path>`),
    "  --risc0-prover-mode <local|bonsai>",
    "",
    "Examples:",
    "  stateless-client verify-stage --stage source-deposit --tx-id 0x... --source-connector 0x... --destination-connector 0x... --source-profile local-anvil --destination-profile local-hardhat",
    "  stateless-client relay-lock --tx-id 0x... --private-key 0x... --proof-backend local --source-connector 0x... --destination-connector 0x... --source-profile local-anvil --destination-profile local-hardhat",
    "  stateless-client agent start",
  ].join("\n");
}

function agentUsage(): string {
  return [
    "Usage:",
    "  stateless-client agent start",
    "",
    "Environment:",
    "  AGENT_PORT: override the listening port (default: 7549)",
    "  AGENT_ALLOWED_ORIGINS: comma-separated list of additional allowed origins",
  ].join("\n");
}

interface ParsedCli {
  options: CliOptions;
  positionals: string[];
}

export interface CliIo {
  error(message: string): void;
  log(message: string): void;
}

export interface CliDeps {
  startAgentServer(): Promise<void>;
}

const defaultIo: CliIo = {
  error(message) {
    console.error(message);
  },
  log(message) {
    console.log(message);
  },
};

const defaultDeps: CliDeps = {
  async startAgentServer() {
    await runAgentMain();
  },
};

export function parseCliArgs(argv: string[]): ParsedCli {
  const options: CliOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    if (withoutPrefix.length === 0) {
      throw new Error("Invalid empty option token '--'.");
    }

    const equalIndex = withoutPrefix.indexOf("=");
    const rawKey = equalIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, equalIndex);
    // Resolve aliases before storing so downstream config sees canonical keys.
    const key = OPTION_ALIASES[rawKey] ?? rawKey;

    if (equalIndex !== -1) {
      options[key] = withoutPrefix.slice(equalIndex + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return { options, positionals };
}

function parseStage(value: string): Stage {
  if (isVerifyStage(value)) {
    return value;
  }
  throw new Error(`Unsupported stage '${value}'. Expected one of: ${VERIFY_STAGES.join(", ")}.`);
}

function printRelayResult(result: RelayStageResult, io: CliIo): void {
  if (result.verification) {
    io.log(`verificationMode: ${result.verification.mode}`);
    io.log(`verificationDegraded: ${result.verification.degraded}`);
  }
  if (result.proof) {
    io.log(`proofBackend: ${result.proof.backend}`);
    io.log(`proofTxId: ${result.proof.txId}`);
    io.log(`proofMetadata: ${JSON.stringify(result.proof.metadata)}`);
  }
  io.log(`submissionTxHash: ${result.submission.txHash}`);
  io.log(`submissionBlock: ${result.submission.receiptBlock}`);
  io.log(`resultingStatus: ${result.submission.resultingStatus}`);
}

function printResumeResult(result: ResumeResult, io: CliIo): void {
  io.log(`plannedAction: ${result.decision.action}`);
  io.log(`sourceStatus: ${result.decision.sourceStatus}`);
  io.log(`destinationStatus: ${result.decision.destinationStatus}`);
  io.log(`decisionReason: ${result.decision.reason}`);
  if (result.executed) {
    printRelayResult(result.executed, io);
  }
}

async function handleAgentCommand(
  subcommand: string | undefined,
  extraPositionals: string[],
  parsed: ParsedCli,
  deps: CliDeps,
  io: CliIo,
): Promise<void> {
  if (parsed.options.help || !subcommand) {
    io.log(agentUsage());
    return;
  }

  if (subcommand !== "start") {
    throw new Error(
      `Unsupported agent command '${subcommand}'. Run 'stateless-client agent --help'.`,
    );
  }

  if (extraPositionals.length > 0) {
    throw new Error(`Unexpected positional argument: ${extraPositionals[0]}`);
  }

  await deps.startAgentServer();
}

export async function runCli(
  argv: string[],
  deps: CliDeps = defaultDeps,
  io: CliIo = defaultIo,
): Promise<void> {
  const parsed = parseCliArgs(argv);
  const [command, subcommand, ...extraPositionals] = parsed.positionals;

  if (parsed.options.help || !command) {
    io.log(usage());
    return;
  }

  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error(`Unsupported command '${command}'. Run with --help for usage.`);
  }

  if (command === "agent") {
    await handleAgentCommand(subcommand, extraPositionals, parsed, deps, io);
    return;
  }

  if (subcommand) {
    throw new Error(`Unexpected positional argument: ${subcommand}`);
  }

  if (command === "verify-stage") {
    const stageValue = parsed.options["stage"];
    if (typeof stageValue !== "string") {
      throw new Error("Missing required option --stage for verify-stage.");
    }
    const stage = parseStage(stageValue);
    const config = resolveVerificationConfig(parsed.options);
    const result = await runVerifyStageCommand(config, stage);
    io.log(`stage: ${result.stage}`);
    io.log(`verificationMode: ${result.mode}`);
    io.log(`verificationDegraded: ${result.degraded}`);
    io.log(`txId: ${result.txId}`);
    io.log(`status: ${result.status}`);
    return;
  }

  await RELAY_COMMANDS[command](resolveRelayConfig(parsed.options), io);
}

async function main(): Promise<void> {
  loadDefaultEnv();
  await runCli(process.argv.slice(2));
}

export function isCliEntrypoint(
  argvPath: string | undefined,
  moduleUrl: string = import.meta.url,
): boolean {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isCliEntrypoint(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`stateless-client failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
