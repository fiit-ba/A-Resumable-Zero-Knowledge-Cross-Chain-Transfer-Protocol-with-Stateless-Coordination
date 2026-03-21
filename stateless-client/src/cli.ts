#!/usr/bin/env node

import {
  resolveRelayConfig,
  resolveVerificationConfig,
  type CliOptions
} from "./config/config.js";
import {
  runRelayAck,
  runRelayHappyPath,
  runRelayLock,
  runRelayMint,
  runVerifyStageCommand
} from "./relay/relay.js";
import { runRelayResume } from "./relay/resume.js";
import type {
  HappyPathResult,
  RelayStageResult,
  ResumeResult,
  Stage
} from "./core/types.js";

const SUPPORTED_COMMANDS = new Set([
  "verify-stage",
  "relay-lock",
  "relay-mint",
  "relay-ack",
  "relay-happy-path",
  "relay-resume"
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
    "  stateless-client relay-lock --tx-id 0x... --private-key 0x... --proof-backend local --source-connector 0x... --destination-connector 0x... --source-profile local-anvil --destination-profile local-hardhat"
  ].join("\n");
}

interface ParsedCli {
  command?: string;
  options: CliOptions;
}

function parseCliArgs(argv: string[]): ParsedCli {
  const options: CliOptions = {};
  let command: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (!token.startsWith("--")) {
      if (!command) {
        command = token;
        continue;
      }
      throw new Error(`Unexpected positional argument: ${token}`);
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

  return { command, options };
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
    `Unsupported stage '${value}'. Expected source-deposit, destination-funds-released, or source-ack-ready.`
  );
}

function printRelayResult(result: RelayStageResult): void {
  console.log(`verificationMode: ${result.verification.mode}`);
  console.log(`verificationDegraded: ${result.verification.degraded}`);
  console.log(`proofBackend: ${result.proof.backend}`);
  console.log(`proofTxId: ${result.proof.txId}`);
  console.log(`proofMetadata: ${JSON.stringify(result.proof.metadata)}`);
  console.log(`submissionTxHash: ${result.submission.txHash}`);
  console.log(`submissionBlock: ${result.submission.receiptBlock}`);
  console.log(`resultingStatus: ${result.submission.resultingStatus}`);
}

function printResumeResult(result: ResumeResult): void {
  console.log(`plannedAction: ${result.decision.action}`);
  console.log(`sourceStatus: ${result.decision.sourceStatus}`);
  console.log(`destinationStatus: ${result.decision.destinationStatus}`);
  console.log(`decisionReason: ${result.decision.reason}`);
  if (result.executed) {
    printRelayResult(result.executed);
  }
}

function printHappyPathResult(result: HappyPathResult): void {
  console.log("lock:");
  printRelayResult(result.lock);
  console.log("mint:");
  printRelayResult(result.mint);
  console.log("ack:");
  printRelayResult(result.ack);
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.options.help || !parsed.command) {
    console.log(usage());
    return;
  }

  if (!SUPPORTED_COMMANDS.has(parsed.command)) {
    throw new Error(
      `Unsupported command '${parsed.command}'. Run with --help for usage.`
    );
  }

  switch (parsed.command) {
    case "verify-stage": {
      const stageValue = parsed.options["stage"];
      if (typeof stageValue !== "string") {
        throw new Error("Missing required option --stage for verify-stage.");
      }
      const stage = parseStage(stageValue);
      const config = resolveVerificationConfig(parsed.options);
      const result = await runVerifyStageCommand(config, stage);
      console.log(`stage: ${result.stage}`);
      console.log(`verificationMode: ${result.mode}`);
      console.log(`verificationDegraded: ${result.degraded}`);
      console.log(`txId: ${result.txId}`);
      console.log(`status: ${result.status}`);
      return;
    }

    case "relay-lock": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayLock(config);
      printRelayResult(result);
      return;
    }

    case "relay-mint": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayMint(config);
      printRelayResult(result);
      return;
    }

    case "relay-ack": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayAck(config);
      printRelayResult(result);
      return;
    }

    case "relay-happy-path": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayHappyPath(config);
      printHappyPathResult(result);
      return;
    }

    case "relay-resume": {
      const config = resolveRelayConfig(parsed.options);
      const result = await runRelayResume(config);
      printResumeResult(result);
      return;
    }

    default:
      throw new Error(`Unhandled command: ${parsed.command}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`stateless-client failed: ${message}`);
  process.exitCode = 1;
});
