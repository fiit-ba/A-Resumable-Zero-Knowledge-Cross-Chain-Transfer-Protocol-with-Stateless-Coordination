import { Interface } from "ethers";

/**
 * Custom errors from smart-contracts/src/libs/Errors.sol, so reverts decode by name instead of
 * "unknown custom error". Regenerate with `forge inspect src/libs/Errors.sol:Errors abi`.
 */
const CONNECTOR_ERRORS = [
  "error AckWindowExpired(uint64 ackDeadline, uint64 currentTime)",
  "error AckWindowNotExpired(uint64 ackDeadline, uint64 currentTime)",
  "error AllowedImageIdsRiscZeroIsZeroAddress()",
  "error CommitmentMismatch(bytes32 got, bytes32 expected)",
  "error DeadlineNotReached(uint64 deadline, uint64 currentTime)",
  "error DestinationLockAlreadyAccepted(bytes32 txId)",
  "error EmptyAllowlist()",
  "error FinalityNotReached(uint256 chainId, uint64 earliestAllowedAt, uint64 currentTime)",
  "error ImageIdNotAllowed(bytes32 imageId)",
  "error ImageIdRouteMismatch(uint8 route, bytes32 got, bytes32 expected)",
  "error InvalidProofType()",
  "error InvalidRiscZeroProof()",
  "error InvalidSnarkProof()",
  "error InvalidStateTransition(uint8 currentStatus, uint8 requiredStatus)",
  "error NoPendingFinalityDelay(uint256 chainId)",
  "error NoPendingRoute(bytes32 routeKey)",
  "error NoPendingVerifier(uint8 route, uint8 proofType)",
  "error NotAdmin()",
  "error RiscZeroVerifierIsZeroAddress()",
  "error RouteAlreadyRegistered(bytes32 routeKey)",
  "error SnarkJsVerifierIsZeroAddress()",
  "error TimelockExpired(uint64 availableAt, uint64 currentTime)",
  "error TimelockNotExpired(uint64 availableAt, uint64 currentTime)",
  "error TxAlreadyExists(bytes32 txId)",
  "error TxNotFound(bytes32 txId)",
  "error VerifierNotRegistered(uint8 proofType)",
  "error WrappedTokenMismatch(address got, address expected)",
  "error WrappedTokenNotRegistered(bytes32 routeKey)",
  "error ZeroAckWindow()",
  "error ZeroAddress()",
  "error ZeroAmount()",
] as const;

export const CONNECTOR_ABI = [
  "event DepositLocked(bytes32 indexed txId,address indexed from,address indexed to,uint256 amount,address currencyFrom,address currencyTo,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint64 ackDeadline,uint256 nonce,uint256 sourceChainId,uint256 destinationChainId)",
  "event FundsReleased(bytes32 indexed txId,uint256 amount,address currencyFrom,address currencyTo,address indexed from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint8 proofType,bytes32 proofHash,bytes32 commitment,bytes proofPayload)",
  "event AckReady(bytes32 indexed txId,uint256 amount,address currencyFrom,address currencyTo,address indexed from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint8 proofType,bytes32 proofHash,bytes32 commitment)",
  "event RefundClaimed(bytes32 indexed txId,address indexed from,uint256 amount,address indexed srcChainConnector)",
  "event RefundExecuted(bytes32 indexed txId,address indexed to,uint256 indexed amount)",
  "event DestTxClosed(bytes32 indexed txId,uint256 amount,address currencyFrom,address currencyTo,address indexed from,address indexed to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint64 finalizedAt)",
  "function getTx(bytes32 _txId) view returns ((bytes32 txId,uint256 amount,address currencyFrom,address currencyTo,address from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint64 finalizedAt,uint64 mintedAt,uint64 ackDeadline,uint8 status,uint256 nonce,uint256 sourceChainId,uint256 destinationChainId))",
  "function txStatus(bytes32 _txId) view returns (uint8)",
  "function submitLockProof(uint8 proofType,bytes proofPayload,bytes32 txId,uint256 amount,address currencyFrom,address currencyTo,address from,address to,address srcChainConnector,uint64 originAckDeadline,uint256 nonce,uint256 sourceChainId)",
  "function submitMintProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  "function submitAckProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  "function initiateRefund(bytes32 txId)",
  "function submitRefundClaimProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  "function executeBurn(bytes32 txId)",
  "function submitBurnProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  "function submitNonAcceptanceProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  ...CONNECTOR_ERRORS,
] as const;

export const connectorInterface = new Interface(CONNECTOR_ABI);

/** Returns the topic0 hash of a connector event, failing loudly if the ABI lacks it. */
export function eventTopic(eventName: string): string {
  const event = connectorInterface.getEvent(eventName);
  if (!event) {
    throw new Error(`Missing ABI event fragment for ${eventName}`);
  }
  return event.topicHash;
}

/**
 * Returns `ErrorName(arg, …)` when `error` carries revert data for a known connector error.
 * Transaction sends fail inside the signer's gas estimation, which does not know the
 * connector ABI, so ethers alone reports these reverts as "unknown custom error".
 */
export function describeConnectorRevert(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data !== "string" || !data.startsWith("0x")) {
    return undefined;
  }
  try {
    const parsed = connectorInterface.parseError(data);
    return parsed ? `${parsed.name}(${parsed.args.map(String).join(", ")})` : undefined;
  } catch {
    return undefined;
  }
}
