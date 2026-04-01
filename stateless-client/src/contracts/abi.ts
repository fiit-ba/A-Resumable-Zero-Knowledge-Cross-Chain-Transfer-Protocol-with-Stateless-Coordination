import { Interface } from "ethers";

export const CONNECTOR_ABI = [
  "event DepositLocked(bytes32 indexed txId,address indexed from,address to,uint256 amount,address currencyFrom,address currencyTo,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint256 nonce,uint256 sourceChainId)",
  "event FundsReleased(bytes32 indexed txId,uint256 amount,address currencyFrom,address currencyTo,address indexed from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint8 proofType,bytes32 proofHash,bytes32 commitment,bytes proofPayload)",
  "event AckReady(bytes32 indexed txId,uint256 amount,address currencyFrom,address currencyTo,address indexed from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint8 proofType,bytes32 proofHash,bytes32 commitment,bytes proofPayload)",
  "event RefundInitiated(bytes32 indexed txId,address indexed from,uint64 timestamp)",
  "event BurnExecuted(bytes32 indexed txId,uint64 timestamp)",
  "function getTx(bytes32 _txId) view returns ((bytes32 txId,uint256 amount,address currencyFrom,address currencyTo,address from,address to,address srcChainConnector,address dstChainConnector,uint64 timestamp,uint64 finalizedAt,uint64 mintedAt,uint64 ackDeadline,uint8 status,uint256 nonce))",
  "function txStatus(bytes32 _txId) view returns (uint8)",
  "function submitLockProof(uint8 proofType,bytes proofPayload,bytes32 txId,uint256 amount,address currencyFrom,address currencyTo,address from,address to,address srcChainConnector,uint64 originAckDeadline,uint256 nonce,uint256 sourceChainId)",
  "function submitMintProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  "function submitAckProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  "function initiateRefund(bytes32 txId)",
  "function submitRefundClaimProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
  "function executeBurn(bytes32 txId)",
  "function submitBurnProof(uint8 proofType,bytes proofPayload,bytes32 txId)",
] as const;

export const connectorInterface = new Interface(CONNECTOR_ABI);
