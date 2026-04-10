import Colibri, { MethodType } from "@corpus-core/colibri-stateless";

/**
 * Numeric constants mirroring MethodType from @corpus-core/colibri-stateless.
 * Using plain numbers instead of the enum avoids import coupling — callers that
 * only compare against these values (e.g. decideVerificationMode) do not need
 * to import the upstream package directly.
 */
export const ColibriMethodType = {
  PROOFABLE: 1 as typeof MethodType.PROOFABLE,
  UNPROOFABLE: 2 as typeof MethodType.UNPROOFABLE,
  NOT_SUPPORTED: 3 as typeof MethodType.NOT_SUPPORTED,
  LOCAL: 4 as typeof MethodType.LOCAL,
} as const;

export type ColibriMethodTypeValue = (typeof ColibriMethodType)[keyof typeof ColibriMethodType];

/** Minimal Colibri client interface shared by all backend implementations. */
export interface ColibriClient {
  rpc(method: string, params: unknown, method_type?: number): Promise<unknown>;
  getMethodSupport(method: string, args?: unknown): Promise<number>;
}

/** Storage object that Colibri uses to persist sync state on disk. */
export interface ColibriStorage {
  get(key: string): Uint8Array | null;
  set(key: string, value: Uint8Array): void;
  del(key: string): void;
}

/** Per-client configuration passed to createClient(). */
export interface ColibriClientConfig {
  chainId: number;
  rpcs: string[];
  prover: string[];
  beacon_apis: string[];
  checkpointz: string[];
  debug: boolean;
}

/**
 * Backend abstraction over a concrete Colibri library implementation.
 * Implementations wrap either the current npm release or an optional
 * upstream dev build selected via STATELESS_CLIENT_COLIBRI_IMPL.
 */
export interface ColibriBackend {
  createClient(config: ColibriClientConfig): ColibriClient;
  registerStorage(storage: ColibriStorage): Promise<void>;
}

export type ColibriImplName = "current" | "dev";

/** Reads STATELESS_CLIENT_COLIBRI_IMPL and returns the selected impl name. */
export function resolveColibriImpl(): ColibriImplName {
  const raw = process.env["STATELESS_CLIENT_COLIBRI_IMPL"];
  if (raw === "dev") return "dev";
  return "current";
}

function buildCurrentBackend(): ColibriBackend {
  return {
    createClient(config: ColibriClientConfig): ColibriClient {
      return new Colibri({
        chainId: config.chainId,
        rpcs: config.rpcs,
        prover: config.prover,
        beacon_apis: config.beacon_apis,
        checkpointz: config.checkpointz,
        debug: config.debug,
      }) as unknown as ColibriClient;
    },
    async registerStorage(storage: ColibriStorage): Promise<void> {
      await Colibri.register_storage(storage);
    },
  };
}

async function buildDevBackend(): Promise<ColibriBackend> {
  // Dynamic import keeps the optional dep from breaking the build when absent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let devModule: any;
  try {
    // @ts-expect-error — optional peer dep; not installed in most environments
    devModule = await import("@corpus-core/colibri-stateless-dev");
  } catch {
    throw new Error(
      "STATELESS_CLIENT_COLIBRI_IMPL=dev requires the optional package " +
        "@corpus-core/colibri-stateless-dev to be installed. " +
        "Run: npm install --save-optional @corpus-core/colibri-stateless-dev",
    );
  }
  // Support both default export and named export shapes
  const DevColibri = devModule.default ?? devModule.Colibri ?? devModule;
  return {
    createClient(config: ColibriClientConfig): ColibriClient {
      return new DevColibri({
        chainId: config.chainId,
        rpcs: config.rpcs,
        prover: config.prover,
        beacon_apis: config.beacon_apis,
        checkpointz: config.checkpointz,
        debug: config.debug,
      }) as unknown as ColibriClient;
    },
    async registerStorage(storage: ColibriStorage): Promise<void> {
      await DevColibri.register_storage(storage);
    },
  };
}

let _cachedBackend: ColibriBackend | undefined;
let _cachedImpl: ColibriImplName | undefined;

/**
 * Returns the cached ColibriBackend for the currently configured impl.
 * Re-creates the backend if the impl selection has changed since last call.
 */
export async function getColibriBackend(): Promise<ColibriBackend> {
  const impl = resolveColibriImpl();
  if (_cachedBackend !== undefined && _cachedImpl === impl) {
    return _cachedBackend;
  }
  const backend = impl === "dev" ? await buildDevBackend() : buildCurrentBackend();
  _cachedBackend = backend;
  _cachedImpl = impl;
  return backend;
}

/** Clears the cached backend instance — for use in tests only. */
export function clearCachedBackend(): void {
  _cachedBackend = undefined;
  _cachedImpl = undefined;
}
