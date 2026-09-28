import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

function unquoteEnvValue(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) {
    return value;
  }

  const inner = value.slice(1, -1);
  if (quote === "'") {
    return inner;
  }

  return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
}

export function loadEnvFile(path: string, target: NodeJS.ProcessEnv = process.env): boolean {
  if (!existsSync(path)) {
    return false;
  }

  const body = readFileSync(path, "utf8");
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!ENV_KEY_REGEX.test(key) || target[key] !== undefined) {
      continue;
    }

    const value = withoutExport.slice(separatorIndex + 1).trim();
    target[key] = unquoteEnvValue(value);
  }

  return true;
}

export function loadDefaultEnv(): void {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  loadEnvFile(resolve(packageRoot, ".env"));
}
