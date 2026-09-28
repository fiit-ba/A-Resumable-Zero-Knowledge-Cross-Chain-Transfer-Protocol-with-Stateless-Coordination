import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../core/utils.js";

// ---------------------------------------------------------------------------
// URL scheme helpers
// ---------------------------------------------------------------------------

export interface SchemeParams {
  txId: string;
  sourceProfile: string;
  destinationProfile: string;
  sourceConnector: string;
  destinationConnector: string;
}

/**
 * Parses a trustless-client:// URL into its constituent query parameters.
 * Throws if required parameters are missing or the scheme is wrong.
 */
export function parseSchemeUrl(rawUrl: string): SchemeParams {
  let url: URL;
  try {
    // Node's URL class supports custom schemes
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "trustless-client:") {
    throw new Error(`Unexpected URL scheme '${url.protocol}'. Expected 'trustless-client:'.`);
  }

  if (url.hostname !== "start") {
    throw new Error(`Unexpected URL host '${url.hostname}'. Expected 'start'.`);
  }

  const q = url.searchParams;
  const required = [
    "txId",
    "sourceProfile",
    "destinationProfile",
    "sourceConnector",
    "destinationConnector",
  ] as const;

  for (const key of required) {
    if (!q.get(key)) {
      throw new Error(`Missing required query parameter '${key}' in scheme URL.`);
    }
  }

  return {
    txId: q.get("txId")!,
    sourceProfile: q.get("sourceProfile")!,
    destinationProfile: q.get("destinationProfile")!,
    sourceConnector: q.get("sourceConnector")!,
    destinationConnector: q.get("destinationConnector")!,
  };
}

/**
 * Builds the `trustless-client://start?...` URL for the web app to open.
 */
export function buildSchemeUrl(params: SchemeParams): string {
  const q = new URLSearchParams(params as unknown as Record<string, string>);
  return `trustless-client://start?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Platform registration (best-effort, no crash on failure)
// ---------------------------------------------------------------------------

/**
 * Registers the trustless-client:// custom URL scheme so the OS routes it
 * to the running agent server. Works on macOS only for now (via AppleScript
 * wrapper). On other platforms a warning is printed.
 *
 * @param agentPort The port on which the local HTTP server is listening.
 */
export function registerUrlScheme(agentPort: number): void {
  const osPlatform = platform();

  if (osPlatform !== "darwin") {
    console.warn(
      `[agent] Custom URL scheme registration is only supported on macOS. ` +
        `On this platform (${osPlatform}) you must open the tab manually.`,
    );
    return;
  }

  try {
    const dataDir = join(homedir(), ".trustless-agent");
    mkdirSync(dataDir, { recursive: true });

    // Write a tiny AppleScript app that forwards the URL to the agent server
    const appDir = join(dataDir, "TrustlessClientHandler.app");
    const scriptContent = `#!/usr/bin/env osascript
on open location theURL
  do shell script "curl -sf -X POST 'http://localhost:${agentPort}/scheme' --data-urlencode 'url=' & theURL & '' || true"
end open location
`;
    const scriptPath = join(dataDir, "open-url.applescript");
    writeFileSync(scriptPath, scriptContent, "utf8");

    // Compile the AppleScript application bundle
    execSync(`osacompile -o "${appDir}" "${scriptPath}"`, { stdio: "pipe" });

    // Register the scheme in LSHandlers via defaults write (macOS)
    const plistEntry = `<dict>
  <key>LSHandlerURLScheme</key><string>trustless-client</string>
  <key>LSHandlerRole</key><string>Viewer</string>
  <key>LSHandlerRoleAll</key><string>com.apple.script-editor2</string>
</dict>`;

    const defaultsCmdDomain = "com.apple.LaunchServices/com.apple.launchservices.secure";
    execSync(`defaults write ${defaultsCmdDomain} LSHandlers -array-add '${plistEntry}'`, {
      stdio: "pipe",
    });
    const lsregisterCandidates = [
      "/System/Library/Frameworks/CoreServices.framework/Versions/A/Support/lsregister",
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ];
    const lsregisterPath = lsregisterCandidates.find((candidate) => existsSync(candidate));
    if (!lsregisterPath) {
      throw new Error("lsregister not found in expected macOS system paths");
    }

    execSync(`"${lsregisterPath}" -f -R -trusted "${appDir}"`, {
      stdio: "pipe",
    });

    console.log(`[agent] Registered trustless-client:// URL scheme → ${agentPort}`);
  } catch (err) {
    console.warn(
      `[agent] URL scheme registration failed (non-fatal): ${errorMessage(err)}\n` +
        `The web app will fall back to showing a manual open-agent button.`,
    );
  }
}
