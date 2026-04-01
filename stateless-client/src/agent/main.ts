import type { Server } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { registerUrlScheme } from "./scheme.js";
import { createApp } from "./server.js";

export interface AgentRuntimeOptions {
  allowedOrigins?: string;
  dbPath?: string;
  host?: string;
  port?: number;
  registerScheme?: boolean;
}

export function resolveAgentRuntimeOptions(options: AgentRuntimeOptions = {}): Required<AgentRuntimeOptions> {
  return {
    allowedOrigins: options.allowedOrigins ?? process.env["AGENT_ALLOWED_ORIGINS"] ?? "",
    dbPath: options.dbPath ?? "",
    host: options.host ?? "127.0.0.1",
    port: options.port ?? parseInt(process.env["AGENT_PORT"] ?? "7549", 10),
    registerScheme: options.registerScheme ?? true,
  };
}

export async function startAgentServer(options: AgentRuntimeOptions = {}): Promise<Server> {
  const runtime = resolveAgentRuntimeOptions(options);

  console.log("[agent] Starting Trustless Local Agent…");

  // Initialise database
  openDb(runtime.dbPath || undefined);
  console.log("[agent] Database ready.");

  // Register the custom URL scheme (best-effort)
  if (runtime.registerScheme) {
    registerUrlScheme(runtime.port);
  }

  // Start HTTP server
  const app = createApp({ allowedOrigins: runtime.allowedOrigins || undefined });
  return await new Promise<Server>((resolve, reject) => {
    const server = app.listen(runtime.port, runtime.host, () => {
      console.log(`[agent] Listening on http://localhost:${runtime.port}`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

export async function runAgentMain(options: AgentRuntimeOptions = {}): Promise<void> {
  await startAgentServer(options);
}

function isAgentEntrypoint(argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isAgentEntrypoint(process.argv[1])) {
  runAgentMain().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Fatal error: ${message}`);
    process.exitCode = 1;
  });
}
