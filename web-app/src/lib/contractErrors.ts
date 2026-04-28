import { AbiCoder } from "ethers";

const abiCoder = AbiCoder.defaultAbiCoder();

const SELECTORS = {
  ackWindowExpired: "0x116563d8",
  ackWindowNotExpired: "0xc9eb0a4a",
  deadlineNotReached: "0xf17232e8",
  destinationLockAlreadyAccepted: "0xb554dffa",
  notAdmin: "0x7bfa4b9f",
  noPendingRoute: "0xc8373679",
  timelockNotExpired: "0x20454a40",
  txAlreadyExists: "0xb128c51c",
  wrappedTokenMismatch: "0xd70f91f1",
  wrappedTokenNotRegistered: "0xc1c2aa5c",
  zeroAddress: "0xd92e233d",
  zeroAmount: "0x1f2a2005",
} as const;

function isRevertData(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{8}([0-9a-fA-F]{64})*$/.test(value);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function findRevertData(error: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (isRevertData(error)) return error;

  const raw = objectRecord(error);
  if (!raw) return null;

  if (isRevertData(raw.data)) return raw.data;

  for (const key of ["error", "info", "cause"]) {
    const nested = findRevertData(raw[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

function decodeBytes32(payload: string): string | null {
  try {
    const decoded = abiCoder.decode(["bytes32"], `0x${payload}`);
    return String(decoded[0]);
  } catch {
    return null;
  }
}

function decodeAddressPair(payload: string): [string, string] | null {
  try {
    const decoded = abiCoder.decode(["address", "address"], `0x${payload}`);
    return [String(decoded[0]), String(decoded[1])];
  } catch {
    return null;
  }
}

function decodeUint64Pair(payload: string): [bigint, bigint] | null {
  try {
    const decoded = abiCoder.decode(["uint64", "uint64"], `0x${payload}`);
    return [BigInt(decoded[0].toString()), BigInt(decoded[1].toString())];
  } catch {
    return null;
  }
}

/**
 * Decodes known connector/factory custom errors from ethers revert objects so
 * the UI can show a route-specific fix instead of "unknown custom error".
 */
export function decodeContractError(error: unknown): string | null {
  const data = findRevertData(error);
  if (!data) return null;

  const selector = data.slice(0, 10).toLowerCase();
  const payload = data.slice(10);

  if (selector === SELECTORS.wrappedTokenNotRegistered) {
    const routeKey = decodeBytes32(payload);
    return [
      `Wrapped-token route is not registered${routeKey ? ` for route key ${routeKey}` : ""}.`,
      "Register and apply the route on the destination WrappedTokenFactory for this source token, source connector, and destination connector before depositing.",
      "For local setup, run `make bootstrap` from `smart-contracts`; on live networks run `make propose-routes`, wait the timelock, then run `make apply-routes`.",
    ].join(" ");
  }

  if (selector === SELECTORS.wrappedTokenMismatch) {
    const decoded = decodeAddressPair(payload);
    if (!decoded) return "Destination token does not match the registered wrapped token.";
    const [got, expected] = decoded;
    return `Destination token does not match the registered wrapped token. tokenTo=${got}, expected DEST_WRAPPED_TOKEN=${expected}.`;
  }

  if (selector === SELECTORS.ackWindowExpired) {
    const decoded = decodeUint64Pair(payload);
    if (!decoded) return "ACK window expired. Refund flow is required.";
    const [deadline, currentTime] = decoded;
    const expiredSec = currentTime > deadline ? currentTime - deadline : 0n;
    return (
      `ACK window expired; the relay deadline passed ${expiredSec.toString()}s ago ` +
      `(deadline=${deadline.toString()}, now=${currentTime.toString()}). Refund flow is required.`
    );
  }

  if (selector === SELECTORS.ackWindowNotExpired) {
    const decoded = decodeUint64Pair(payload);
    if (!decoded) return "ACK window has not expired yet.";
    const [deadline, currentTime] = decoded;
    return `ACK window has not expired yet (deadline=${deadline.toString()}, now=${currentTime.toString()}).`;
  }

  if (selector === SELECTORS.deadlineNotReached) {
    const decoded = decodeUint64Pair(payload);
    if (!decoded) return "Deadline has not been reached yet.";
    const [deadline, currentTime] = decoded;
    return `Deadline has not been reached yet (deadline=${deadline.toString()}, now=${currentTime.toString()}).`;
  }

  if (selector === SELECTORS.timelockNotExpired) {
    const decoded = decodeUint64Pair(payload);
    if (!decoded) return "Timelock has not expired yet.";
    const [availableAt, currentTime] = decoded;
    return `Timelock has not expired yet (availableAt=${availableAt.toString()}, now=${currentTime.toString()}).`;
  }

  if (selector === SELECTORS.txAlreadyExists) {
    const txId = decodeBytes32(payload);
    return `Transaction already exists${txId ? `: ${txId}` : ""}.`;
  }

  if (selector === SELECTORS.destinationLockAlreadyAccepted) {
    const txId = decodeBytes32(payload);
    return `Destination lock was already accepted${txId ? ` for ${txId}` : ""}.`;
  }

  if (selector === SELECTORS.noPendingRoute) {
    const routeKey = decodeBytes32(payload);
    return `No pending wrapped-token route${routeKey ? ` for route key ${routeKey}` : ""}. Run propose-routes first.`;
  }

  if (selector === SELECTORS.notAdmin) {
    return [
      "Caller is not authorized for a connector/admin-only operation.",
      "If this happened during submitLockProof, the registered destination wrapped token is probably bound to a different Connector.",
      "Deploy a BridgeWrappedToken for the current DEST_CONNECTOR and register that route before retrying.",
    ].join(" ");
  }

  if (selector === SELECTORS.zeroAddress) return "One of the submitted addresses is zero.";
  if (selector === SELECTORS.zeroAmount) return "Amount must be greater than zero.";

  return null;
}
