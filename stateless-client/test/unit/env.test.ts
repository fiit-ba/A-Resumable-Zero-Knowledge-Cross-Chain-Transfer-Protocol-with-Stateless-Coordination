import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvFile } from "../../src/config/env.js";

describe("env loading", () => {
  it("loads .env values without overriding existing environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "stateless-client-env-"));
    const path = join(dir, ".env");
    const target: NodeJS.ProcessEnv = {
      EXISTING_VALUE: "shell",
    };

    writeFileSync(
      path,
      [
        "# comment",
        "STATELESS_CLIENT_PROOF_TIMEOUT_SEC=2100",
        "export STATELESS_CLIENT_RISC0_PROVER_MODE=bonsai",
        "QUOTED_VALUE=\"hello world\"",
        "EXISTING_VALUE=file",
      ].join("\n"),
      "utf8",
    );

    expect(loadEnvFile(path, target)).toBe(true);
    expect(target.STATELESS_CLIENT_PROOF_TIMEOUT_SEC).toBe("2100");
    expect(target.STATELESS_CLIENT_RISC0_PROVER_MODE).toBe("bonsai");
    expect(target.QUOTED_VALUE).toBe("hello world");
    expect(target.EXISTING_VALUE).toBe("shell");

    rmSync(dir, { recursive: true, force: true });
  });
});
