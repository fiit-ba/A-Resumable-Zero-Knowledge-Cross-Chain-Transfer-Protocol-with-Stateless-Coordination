#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveRelayConfig, resolveVerificationConfig, type CliOptions } from "./config/config.js";
import type { HappyPathResult, RelayStageResult, ResumeResult, Stage } from "./core/types.js";
import { runAgentMain } from "./agent/main.js";
import {
  runRelayAck,
  runRelayHappyPath,
  runRelayLock,
  runRelayMint,
  runVerifyStageCommand,
} from "./relay/relay.js";
import { runRelayResume } from "./relay/resume.js";

const SUPPORTED_COMMANDS = new Set([
  "verify-stage",
  "relay-lock",
  "relay-mint",
  "relay-ack",
  "relay-happy-path",
  "relay-resume",
  "agent",
]);

function usage(): string {
  return [
    "Usage:",
    "  stateless-client verify-stage --stage <source-deposit|destination-funds-released|source-ack-ready> --tx-id <bytes32> --source-connector <address> --destination-connector <address> [network options]",
    "  stateless-client relay-lock --tx-id <bytes32> --private-key <hex> --proof-backend <local|docker> --source-connector <address> --destination-connector <address> [network and proof options]",
    "  stateless-client relay-mint --tx-id <bytes32> --private-key <hex> --proof-backend <local|docker> --source-connector <address> --destination-connector <address> [network and proof options]",
    "  stateless-client relay-ack --tx-id <bytes32> --private-key <hex> --proof-backend <local|docker> --source-connector <address> --destination-connector <address> [network and proof options]",
    "  stateless-client relay-happy-path --tx-id <bytes32> --private-key <hex> --proof-backend <local|docker> --source-connector <address> --destination-connector <address> [network and proof options]",
    "  stateless-client relay-resume --tx-id <bytes32> --private-key <hex> --proof-backend <local|docker> --source-connector <address> --destination-connector <address> [network and proof options]",
    "  stateless-client agent <command>",
    "",
    "Common network options:",
    "  --source-profile <local-anvil|local-hardhat|mainnet|sepolia|holesky|hoodi|gnosis|chiado>",
    "  --destination-profile <local-anvil|local-hardhat|mainnet|sepolia|holesky|hoodi|gnosis|chiado>",
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
    "  --lock-execution-block <tag|number|hex>",
    "  --mint-execution-block <tag|number|hex>",
    "  --ack-execution-block <tag|number|hex>",
    "",
    "Proof path/runtime options:",
    "  --repo-root <path>",
    "  --lock-workspace <path> --mint-workspace <path> --ack-workspace <path>",
    "  --lock-docker-script <path> --mint-docker-script <path> --ack-docker-script <path>",
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
    if (equalIndex !== -1) {
      const key = withoutPrefix.slice(0, equalIndex);
      const value = withoutPrefix.slice(equalIndex + 1);
      options[key] = value;
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      options[withoutPrefix] = true;
      continue;
    }

    options[withoutPrefix] = next;
    i += 1;
  }

  return { options, positionals };
}

function parseStage(value: string): Stage {
  if (
    value === "source-deposit" ||
    value === "destination-funds-released" ||
    value === "source-ack-ready"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported stage '${value}'. Expected source-deposit, destination-funds-released, or source-ack-ready.`,
  );
}

function printRelayResult(result: RelayStageResult, io: CliIo): void {
  io.log(`verificationMode: ${result.verification.mode}`);
  io.log(`verificationDegraded: ${result.verification.degraded}`);
  io.log(`proofBackend: ${result.proof.backend}`);
  io.log(`proofTxId: ${result.proof.txId}`);
  io.log(`proofMetadata: ${JSON.stringify(result.proof.metadata)}`);
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

function printHappyPathResult(result: HappyPathResult, io: CliIo): void {
  io.log("lock:");
  printRelayResult(result.lock, io);
  io.log("mint:");
  printRelayResult(result.mint, io);
  io.log("ack:");
  printRelayResult(result.ack, io);
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
    throw new Error(`Unsupported agent command '${subcommand}'. Run 'stateless-client agent --help'.`);
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

  switch (command) {
    case "verify-stage": {
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

    case "relay-lock": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayLock(config);
      printRelayResult(result, io);
      return;
    }

    case "relay-mint": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayMint(config);
      printRelayResult(result, io);
      return;
    }

    case "relay-ack": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayAck(config);
      printRelayResult(result, io);
      return;
    }

    case "relay-happy-path": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayHappyPath(config);
      printHappyPathResult(result, io);
      return;
    }

    case "relay-resume": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayResume(config);
      printResumeResult(result, io);
      return;
    }

    default:
      throw new Error(`Unhandled command: ${command}`);
  }
}

async function main(): Promise<void> {
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
    const message = error instanceof Error ? error.message : String(error);
    console.error(`stateless-client failed: ${message}`);
    process.exitCode = 1;
  });
}
