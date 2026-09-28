import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isCliEntrypoint, parseCliArgs, runCli } from "../../src/cli.js";

describe("stateless-client agent CLI", () => {
  it("prints agent usage for bare agent command", async () => {
    const io = {
      error: vi.fn(),
      log: vi.fn(),
    };
    const deps = {
      startAgentServer: vi.fn(),
    };

    await runCli(["agent"], deps, io);

    expect(deps.startAgentServer).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("stateless-client agent start"));
  });

  it("dispatches agent start explicitly", async () => {
    const io = {
      error: vi.fn(),
      log: vi.fn(),
    };
    const deps = {
      startAgentServer: vi.fn().mockResolvedValue(undefined),
    };

    await runCli(["agent", "start"], deps, io);

    expect(deps.startAgentServer).toHaveBeenCalledTimes(1);
  });

  it("treats symlinked bin paths as direct CLI entrypoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "stateless-client-cli-"));
    const target = join(dir, "cli.js");
    const link = join(dir, "bin");
    writeFileSync(target, "export {};\n", "utf8");
    symlinkSync(target, link);

    const isEntrypoint = isCliEntrypoint(link, pathToFileURL(target).href);
    rmSync(dir, { recursive: true, force: true });

    expect(isEntrypoint).toBe(true);
  });
});

describe("parseCliArgs", () => {
  it("resolves network aliases in both --key value and --key=value forms", () => {
    const { options } = parseCliArgs([
      "--source-network",
      "sepolia",
      "--destination-network=chiado",
    ]);
    expect(options["source-profile"]).toBe("sepolia");
    expect(options["destination-profile"]).toBe("chiado");
    expect(options["source-network"]).toBeUndefined();
    expect(options["destination-network"]).toBeUndefined();
  });

  it("treats an option followed by another option as a boolean flag", () => {
    const { options, positionals } = parseCliArgs(["relay-resume", "--debug", "--tx-id", "0x1"]);
    expect(positionals).toEqual(["relay-resume"]);
    expect(options).toMatchObject({ debug: true, "tx-id": "0x1" });
  });

  it("rejects unknown stages for verify-stage", async () => {
    const io = { error: vi.fn(), log: vi.fn() };
    await expect(
      runCli(["verify-stage", "--stage", "lock"], { startAgentServer: vi.fn() }, io),
    ).rejects.toThrow(/Unsupported stage 'lock'/);
  });
});
