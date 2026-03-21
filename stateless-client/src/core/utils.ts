import { getAddress } from "ethers";
import type { BlockTagInput } from "./types.js";

const BYTES32_REGEX = /^0x[0-9a-fA-F]{64}$/;
const HEX_REGEX = /^0x[0-9a-fA-F]+$/;
const DECIMAL_REGEX = /^\d+$/;
const NAMED_BLOCK_TAGS = new Set(["latest", "pending", "earliest", "safe", "finalized"]);

export function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function normalizeAddress(value: string, fieldName: string): string {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
}

export function normalizeBytes32(value: string, fieldName: string): string {
  const text = value.trim();
  if (!BYTES32_REGEX.test(text)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return text.toLowerCase();
}

export function parseChainId(value: string, fieldName: string): number {
  const text = value.trim();
  if (text.length === 0) {
    throw new Error(`Invalid ${fieldName}: must not be empty`);
  }

  let id: number;
  if (HEX_REGEX.test(text)) {
    id = Number(BigInt(text));
  } else if (DECIMAL_REGEX.test(text)) {
    id = Number(text);
  } else {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  return id;
}

export function normalizeBlockTag(value: BlockTagInput | undefined, fallback: BlockTagInput = "latest"): BlockTagInput {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid block number: ${value}`);
    }
    return value;
  }

  const text = String(value).trim();
  if (text.length === 0) {
    return fallback;
  }

  const lowered = text.toLowerCase();
  if (NAMED_BLOCK_TAGS.has(lowered)) {
    return lowered;
  }

  if (HEX_REGEX.test(text)) {
    return lowered;
  }

  if (DECIMAL_REGEX.test(text)) {
    const asNumber = Number(text);
    if (Number.isSafeInteger(asNumber)) {
      return asNumber;
    }
    return `0x${BigInt(text).toString(16)}`;
  }

  throw new Error(`Invalid block tag: ${value}`);
}

export function toRpcBlockTag(value: BlockTagInput): string {
  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }

  const text = String(value).trim();
  if (NAMED_BLOCK_TAGS.has(text.toLowerCase())) {
    return text.toLowerCase();
  }

  if (HEX_REGEX.test(text)) {
    return text.toLowerCase();
  }

  if (DECIMAL_REGEX.test(text)) {
    return `0x${BigInt(text).toString(16)}`;
  }

  throw new Error(`Invalid RPC block tag: ${value}`);
}

export function toNumberStatus(value: string | number | bigint): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (HEX_REGEX.test(value)) {
    return Number(BigInt(value));
  }

  if (DECIMAL_REGEX.test(value)) {
    return Number(value);
  }

  throw new Error(`Unsupported status value: ${value}`);
}

export function isLikelyLocalRpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
