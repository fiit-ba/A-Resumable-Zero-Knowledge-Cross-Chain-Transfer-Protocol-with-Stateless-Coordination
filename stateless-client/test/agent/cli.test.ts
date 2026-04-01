import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isCliEntrypoint, runCli } from "../../src/cli.js";

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
