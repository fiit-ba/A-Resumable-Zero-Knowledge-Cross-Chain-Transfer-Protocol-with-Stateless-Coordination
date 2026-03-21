import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const shouldRun = process.env.RUN_LOCAL_INTEGRATION === "1";
const integrationDescribe = shouldRun ? describe : describe.skip;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required integration env var: ${name}`);
  }
  return value;
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(currentDir, "..", "..");
  const tsxBin = path.join(packageRoot, "node_modules", ".bin", "tsx");
  const result = spawnSync(tsxBin, ["src/cli.ts", ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: process.env
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function commonArgs(txId: string): string[] {
  return [
    "--tx-id",
    txId,
    "--source-profile",
    process.env.INTEGRATION_SOURCE_PROFILE ?? "local-anvil",
    "--destination-profile",
    process.env.INTEGRATION_DEST_PROFILE ?? "local-hardhat",
    "--source-connector",
    requiredEnv("INTEGRATION_SOURCE_CONNECTOR"),
    "--destination-connector",
    requiredEnv("INTEGRATION_DEST_CONNECTOR"),
    "--private-key",
    requiredEnv("INTEGRATION_PRIVATE_KEY"),
    "--proof-backend",
    process.env.INTEGRATION_PROOF_BACKEND ?? "local"
  ];
}

integrationDescribe("local relay integration", () => {
  it("runs command-by-command relay flow", () => {
    const txId = requiredEnv("INTEGRATION_TX_ID_COMMAND_FLOW");

    const lock = runCli(["relay-lock", ...commonArgs(txId)]);
    expect(lock.status, lock.stderr).toBe(0);

    const mint = runCli(["relay-mint", ...commonArgs(txId)]);
    expect(mint.status, mint.stderr).toBe(0);

    const ack = runCli(["relay-ack", ...commonArgs(txId)]);
    expect(ack.status, ack.stderr).toBe(0);
  });

  it("runs full relay-happy-path and reaches terminal destination status", () => {
    const txId = requiredEnv("INTEGRATION_TX_ID_HAPPY_PATH");
    const result = runCli(["relay-happy-path", ...commonArgs(txId)]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("resultingStatus: 0");
  });
});
