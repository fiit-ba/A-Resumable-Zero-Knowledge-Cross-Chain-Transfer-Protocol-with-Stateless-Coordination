#!/usr/bin/env node
import { openDb } from "./db.js";
import { registerUrlScheme } from "./scheme.js";
import { createApp } from "./server.js";

const PORT = parseInt(process.env["AGENT_PORT"] ?? "7549", 10);
const ALLOWED_ORIGINS = process.env["AGENT_ALLOWED_ORIGINS"];

async function main(): Promise<void> {
  console.log("[agent] Starting Trustless Local Agent…");

  // Initialise database
  openDb();
  console.log("[agent] Database ready.");

  // Register the custom URL scheme (best-effort)
  registerUrlScheme(PORT);

  // Start HTTP server
  const app = createApp({ allowedOrigins: ALLOWED_ORIGINS });
  await new Promise<void>((resolve) => {
    app.listen(PORT, "127.0.0.1", () => {
      console.log(`[agent] Listening on http://localhost:${PORT}`);
      resolve();
    });
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[agent] Fatal error: ${message}`);
  process.exitCode = 1;
});
