import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resetLocalColibriStateFiles } from "../../src/relay/verification.js";

// ---------------------------------------------------------------------------
// Chiado pre-run state reset
//
// verifyStage() calls resetLocalColibriStateFiles(10200) unconditionally before
// creating any Colibri instance when chainId === 10200.  These unit tests verify
// that the underlying helper:
//   • removes all files matching states_<chainId> and sync_<chainId>_* from the
//     configured cache directory;
//   • does not touch files belonging to a different chain.
// ---------------------------------------------------------------------------

const ENV_KEY = "STATELESS_CLIENT_COLIBRI_CACHE_DIR";

function makeTmpDir(): string {
  const dir = resolve(tmpdir(), `colibri-reset-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("resetLocalColibriStateFiles — Chiado pre-run reset", () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    tmpDir = makeTmpDir();
    process.env[ENV_KEY] = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (savedEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedEnv;
    }
  });

  it("removes states_10200 from the configured cache directory", () => {
    const stateFile = resolve(tmpDir, "states_10200");
    writeFileSync(stateFile, "fake-state");

    const removed = resetLocalColibriStateFiles(10200);

    expect(removed.some((p) => p.endsWith("states_10200"))).toBe(true);
    expect(existsSync(stateFile)).toBe(false);
  });

  it("removes sync_10200_* files from the configured cache directory", () => {
    const syncA = resolve(tmpDir, "sync_10200_512");
    const syncB = resolve(tmpDir, "sync_10200_513");
    writeFileSync(syncA, "fake-sync-a");
    writeFileSync(syncB, "fake-sync-b");

    const removed = resetLocalColibriStateFiles(10200);

    expect(removed.length).toBeGreaterThanOrEqual(2);
    expect(existsSync(syncA)).toBe(false);
    expect(existsSync(syncB)).toBe(false);
  });

  it("returns the list of removed file paths", () => {
    writeFileSync(resolve(tmpDir, "states_10200"), "s");
    writeFileSync(resolve(tmpDir, "sync_10200_1"), "s");

    const removed = resetLocalColibriStateFiles(10200);

    expect(Array.isArray(removed)).toBe(true);
    expect(removed.length).toBeGreaterThanOrEqual(2);
    for (const p of removed) {
      expect(typeof p).toBe("string");
    }
  });

  it("does not remove state files belonging to another chain", () => {
    const chiadoState  = resolve(tmpDir, "states_10200");
    const sepoliaState = resolve(tmpDir, "states_11155111");
    writeFileSync(chiadoState, "chiado");
    writeFileSync(sepoliaState, "sepolia");

    resetLocalColibriStateFiles(10200);

    // Chiado file gone, Sepolia file untouched
    expect(existsSync(chiadoState)).toBe(false);
    expect(existsSync(sepoliaState)).toBe(true);
  });

  it("returns an empty array when no state files exist", () => {
    const removed = resetLocalColibriStateFiles(10200);
    expect(removed).toEqual([]);
  });
});
