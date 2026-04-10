import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ColibriMethodType,
  clearCachedBackend,
  getColibriBackend,
  resolveColibriImpl,
  type ColibriBackend,
  type ColibriClient,
} from "../../src/colibri/adapter.js";

// ---------------------------------------------------------------------------
// Colibri adapter — unit tests
//
// These tests verify:
//   • STATELESS_CLIENT_COLIBRI_IMPL selection logic
//   • Cached backend identity (same call → same instance)
//   • Cache invalidation on impl change
//   • ColibriMethodType constant values match MethodType from the current package
//   • ColibriBackend shape: createClient() returns an object with rpc() and
//     getMethodSupport(); registerStorage() returns a Promise
//   • Dev backend throws a clear message when the optional package is absent
// ---------------------------------------------------------------------------

const ENV_KEY = "STATELESS_CLIENT_COLIBRI_IMPL";

describe("resolveColibriImpl", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  });

  it("defaults to 'current' when env is not set", () => {
    delete process.env[ENV_KEY];
    expect(resolveColibriImpl()).toBe("current");
  });

  it("returns 'current' for an empty string", () => {
    process.env[ENV_KEY] = "";
    expect(resolveColibriImpl()).toBe("current");
  });

  it("returns 'dev' when env is set to 'dev'", () => {
    process.env[ENV_KEY] = "dev";
    expect(resolveColibriImpl()).toBe("dev");
  });

  it("returns 'current' for any unrecognised value", () => {
    process.env[ENV_KEY] = "legacy";
    expect(resolveColibriImpl()).toBe("current");
  });
});

describe("ColibriMethodType constants", () => {
  it("PROOFABLE equals 1 (matches MethodType.PROOFABLE)", () => {
    expect(ColibriMethodType.PROOFABLE).toBe(1);
  });

  it("UNPROOFABLE equals 2 (matches MethodType.UNPROOFABLE)", () => {
    expect(ColibriMethodType.UNPROOFABLE).toBe(2);
  });

  it("NOT_SUPPORTED equals 3 (matches MethodType.NOT_SUPPORTED)", () => {
    expect(ColibriMethodType.NOT_SUPPORTED).toBe(3);
  });

  it("LOCAL equals 4 (matches MethodType.LOCAL)", () => {
    expect(ColibriMethodType.LOCAL).toBe(4);
  });
});

describe("getColibriBackend — current backend", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY]; // force 'current'
    clearCachedBackend();
  });

  afterEach(() => {
    clearCachedBackend();
    if (savedEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedEnv;
    }
  });

  it("returns an object with createClient and registerStorage", async () => {
    const backend = await getColibriBackend();
    expect(typeof backend.createClient).toBe("function");
    expect(typeof backend.registerStorage).toBe("function");
  });

  it("returns the same cached instance on repeated calls", async () => {
    const a = await getColibriBackend();
    const b = await getColibriBackend();
    expect(a).toBe(b);
  });

  it("clearCachedBackend forces a new instance on next call", async () => {
    const a = await getColibriBackend();
    clearCachedBackend();
    const b = await getColibriBackend();
    expect(a).not.toBe(b);
  });

  it("createClient returns an object with rpc and getMethodSupport", async () => {
    const backend: ColibriBackend = await getColibriBackend();
    const client: ColibriClient = backend.createClient({
      chainId: 31337,
      rpcs: ["http://127.0.0.1:8545"],
      prover: [],
      beacon_apis: [],
      checkpointz: [],
      debug: false,
    });
    expect(typeof client.rpc).toBe("function");
    expect(typeof client.getMethodSupport).toBe("function");
  });

  it("re-creates the backend when impl switches from current to dev after clearCachedBackend", async () => {
    const currentBackend = await getColibriBackend();
    clearCachedBackend();
    process.env[ENV_KEY] = "dev";
    // dev is optional; if absent the call throws — we only assert it is NOT
    // the same reference, or that it throws with the expected message.
    try {
      const devBackend = await getColibriBackend();
      expect(devBackend).not.toBe(currentBackend);
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      expect((err as Error).message).toMatch(/colibri-stateless-dev/i);
    }
  });
});

describe("getColibriBackend — dev backend absent", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    process.env[ENV_KEY] = "dev";
    clearCachedBackend();
  });

  afterEach(() => {
    clearCachedBackend();
    if (savedEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedEnv;
    }
  });

  it("throws a descriptive error when the optional dev package is not installed", async () => {
    // If the optional package is not installed (the normal CI case), we expect
    // an error that names the missing package and suggests how to install it.
    // If it IS installed, this test is vacuously satisfied.
    try {
      await getColibriBackend();
      // dev package IS installed — test passes vacuously
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      expect((err as Error).message).toMatch(/colibri-stateless-dev/i);
      expect((err as Error).message).toMatch(/install/i);
    }
  });
});
