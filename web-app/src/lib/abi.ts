// Connector ABI used for depositAndLock (deposit flow), relay proof submissions, and refund flow.
export const CONNECTOR_ABI = [
  "function depositAndLock(address currencyFrom, address currencyTo, address to, uint256 amount, address dstChainConnector, uint256 destinationChainId) returns (bytes32 txId)",
  "event DepositLocked(bytes32 indexed txId, address indexed from, address indexed to, uint256 amount, address currencyFrom, address currencyTo, address srcChainConnector, address dstChainConnector, uint64 timestamp, uint256 nonce, uint256 sourceChainId, uint256 destinationChainId)",
  "event RefundClaimed(bytes32 indexed txId, address indexed from, uint256 amount, address srcChainConnector)",
  "event RefundExecuted(bytes32 indexed txId, address indexed to, uint256 indexed amount)",
  "function getTx(bytes32 txId) view returns ((bytes32 txId,uint256 amount,address currencyFrom,address currencyTo,address from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint64 finalizedAt,uint64 mintedAt,uint64 ackDeadline,uint8 status,uint256 nonce,uint256 sourceChainId,uint256 destinationChainId))",
  "function txStatus(bytes32 txId) view returns (uint8)",
  "function getExpectedRisc0ImageId(uint8 route) view returns (bytes32)",
  "function submitLockProof(uint8 proofType, bytes proofPayload, bytes32 txId, uint256 amount, address currencyFrom, address currencyTo, address from, address to, address srcChainConnector, uint64 originAckDeadline, uint256 nonce, uint256 sourceChainId)",
  "function submitMintProof(uint8 proofType, bytes proofPayload, bytes32 txId)",
  "function submitAckProof(uint8 proofType, bytes proofPayload, bytes32 txId)",
  "function initiateRefund(bytes32 txId)",
  "function submitRefundClaimProof(uint8 proofType, bytes proofPayload, bytes32 txId)",
  "function executeBurn(bytes32 txId)",
  "function submitBurnProof(uint8 proofType, bytes proofPayload, bytes32 txId)",
] as const;

// Minimal ERC-20 ABI – approve + allowance needed for the deposit flow.
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;
