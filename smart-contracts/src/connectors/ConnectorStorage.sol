// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Enums} from "../libs/Enums.sol";

/// @title ConnectorStorage
/// @author Trustless Universal Protocol Contributors
/// @notice Shared storage and events for cross-chain transfer state and verifier management.
abstract contract ConnectorStorage {
    /*//////////////////////////////////////////////////////////////
                            STRUCTS
    //////////////////////////////////////////////////////////////*/

    struct CrossChainTx {
        bytes32 txId;
        uint256 amount;
        address currencyFrom;
        address currencyTo;
        address from;
        address to;
        address srcChainConnector;
        address dstChainConnector;
        uint64 timestamp;
        uint64 finalizedAt;
        uint64 mintedAt;
        uint64 ackDeadline;
        Enums.TxStatus status;
        uint256 nonce;
        /// @dev Chain ID of the chain where the origin depositAndLock happened.
        uint256 sourceChainId;
        /// @dev Chain ID of the chain where the destination mint happened.
        uint256 destinationChainId;
    }

    /*//////////////////////////////////////////////////////////////
                            ZK
    //////////////////////////////////////////////////////////////*/

    // _verifiers[route][proofType] => adapter address
    mapping(uint8 route => mapping(uint8 proofType => address verifier)) internal _verifiers;

    // Two-step timelock: pending verifier per route+proofType
    mapping(uint8 route => mapping(uint8 proofType => address verifier)) internal _pendingVerifiers;
    mapping(uint8 route => mapping(uint8 proofType => uint64 availableAt)) internal _pendingVerifierAvailableAt;

    /*//////////////////////////////////////////////////////////////
                            TRANSACTION
    //////////////////////////////////////////////////////////////*/

    mapping(bytes32 txId => CrossChainTx txData) internal _txs;

    /// @notice Current lifecycle status for each cross-chain transaction ID.
    mapping(bytes32 txId => Enums.TxStatus status) public txStatus;

    /// @notice Permanent tombstone for destination lock acceptance per transaction ID.
    /// @dev Set to true on first successful submitLockProof for a txId and never cleared by
    ///      _cleanupTx. Provides cross-lifecycle replay protection: a txId whose destination
    ///      lock has completed cannot re-enter the lock flow even after active storage is wiped
    ///      by submitAckProof or executeBurn.
    mapping(bytes32 txId => bool accepted) public destinationLockAccepted;

    /*//////////////////////////////////////////////////////////////
                            GLOBAL CONFIG VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Monotonic nonce for newly created origin transactions.
    uint256 public txNonce;

    /// @dev Expected RISC Zero image ID per VerifierRoute (index == uint8(VerifierRoute)).
    ///      Enforced by Connector before calling the adapter so a single multi-image adapter
    ///      can serve all routes while each route still binds to exactly one guest ELF.
    bytes32[5] internal _risc0RouteImageIds;

    /*//////////////////////////////////////////////////////////////
                            EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when funds are locked on the origin chain and transfer metadata is created.
    /// @param txId Transfer identifier.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param amount Transfer amount.
    /// @param currencyFrom Origin token address.
    /// @param currencyTo Destination token address.
    /// @param srcChainConnector Source connector contract address.
    /// @param dstChainConnector Destination connector contract address.
    /// @param timestamp Origin lock timestamp.
    /// @param ackDeadline Acknowledgement deadline on origin chain.
    /// @param nonce Origin transfer nonce.
    /// @param sourceChainId Source chain ID.
    /// @param destinationChainId Destination chain ID.
    event DepositLocked(
        bytes32 indexed txId,
        address indexed from,
        address indexed to,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        uint64 ackDeadline,
        uint256 nonce,
        uint256 sourceChainId,
        uint256 destinationChainId
    );

    /// @notice Emitted when mint proof is accepted and origin transaction becomes ack-ready.
    /// @param txId Transfer identifier.
    /// @param amount Transfer amount.
    /// @param currencyFrom Origin token address.
    /// @param currencyTo Destination token address.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param srcChainConnector Source connector contract address.
    /// @param dstChainConnector Destination connector contract address.
    /// @param timestamp Event timestamp.
    /// @param proofType Proof backend used for verification.
    /// @param proofHash Hash of submitted proof payload.
    /// @param commitment Commitment derived from proof public inputs.
    /// @param proofPayload ABI-encoded proof payload.
    event AckReady(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        Enums.ProofType proofType,
        bytes32 proofHash,
        bytes32 commitment,
        bytes proofPayload
    );

    /// @notice Emitted when refund is claimed on origin chain.
    /// @param txId Transfer identifier.
    /// @param from Origin sender address claiming refund.
    /// @param amount Refunded amount.
    /// @param srcChainConnector Source connector contract address.
    event RefundClaimed(bytes32 indexed txId, address indexed from, uint256 amount, address indexed srcChainConnector);

    /// @notice Emitted when refund is executed on origin chain.
    /// @param txId Transfer identifier.
    /// @param to Refund recipient address.
    /// @param amount Refunded amount.
    event RefundExecuted(bytes32 indexed txId, address indexed to, uint256 indexed amount);

    /// @notice Emitted when origin-side transfer lifecycle is finalized.
    /// @param txId Transfer identifier.
    /// @param amount Transfer amount.
    /// @param currencyFrom Origin token address.
    /// @param currencyTo Destination token address.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param srcChainConnector Source connector contract address.
    /// @param dstChainConnector Destination connector contract address.
    /// @param timestamp Origin lock timestamp.
    /// @param finalizedAt Finalization timestamp.
    event OriginTxClosed(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address indexed to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        uint64 finalizedAt
    );

    // DESTINATION

    /// @notice Emitted when destination-side funds are released based on a valid lock proof.
    /// @param txId Transfer identifier.
    /// @param amount Transfer amount.
    /// @param currencyFrom Origin token address.
    /// @param currencyTo Destination token address.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param srcChainConnector Source connector contract address.
    /// @param dstChainConnector Destination connector contract address.
    /// @param timestamp Event timestamp.
    /// @param proofType Proof backend used for verification.
    /// @param proofHash Hash of submitted proof payload.
    /// @param commitment Commitment derived from proof public inputs.
    /// @param proofPayload ABI-encoded proof payload.
    event FundsReleased(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        Enums.ProofType proofType,
        bytes32 proofHash,
        bytes32 commitment,
        bytes proofPayload
    );

    /// @notice Emitted when destination-side acknowledgement proof is accepted.
    /// @param txId Transfer identifier.
    /// @param amount Transfer amount.
    /// @param currencyFrom Origin token address.
    /// @param currencyTo Destination token address.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param srcChainConnector Source connector contract address.
    /// @param dstChainConnector Destination connector contract address.
    /// @param timestamp Event timestamp.
    /// @param proofType Proof backend used for verification.
    /// @param proofHash Hash of submitted proof payload.
    /// @param commitment Commitment derived from proof public inputs.
    /// @param proofPayload ABI-encoded proof payload.
    /// @param finalizedAt Finalization timestamp.
    event AckAccepted(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        Enums.ProofType proofType,
        bytes32 proofHash,
        bytes32 commitment,
        bytes proofPayload,
        uint64 finalizedAt
    );

    /// @notice Emitted when destination-side refund-claim proof is accepted.
    /// @param txId Transfer identifier.
    /// @param amount Transfer amount.
    /// @param currencyFrom Origin token address.
    /// @param currencyTo Destination token address.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param srcChainConnector Source connector contract address.
    /// @param dstChainConnector Destination connector contract address.
    /// @param timestamp Event timestamp.
    /// @param proofType Proof backend used for verification.
    /// @param proofHash Hash of submitted proof payload.
    /// @param commitment Commitment derived from proof public inputs.
    /// @param proofPayload ABI-encoded proof payload.
    event RefundClaimAccepted(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        Enums.ProofType proofType,
        bytes32 proofHash,
        bytes32 commitment,
        bytes proofPayload
    );

    /// @notice Emitted when destination-side transfer lifecycle is finalized.
    /// @param txId Transfer identifier.
    /// @param amount Transfer amount.
    /// @param currencyFrom Origin token address.
    /// @param currencyTo Destination token address.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param srcChainConnector Source connector contract address.
    /// @param dstChainConnector Destination connector contract address.
    /// @param timestamp Destination-side timestamp.
    /// @param finalizedAt Finalization timestamp.
    event DestTxClosed(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address indexed to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        uint64 finalizedAt
    );

    /// @notice Emitted when a proof payload is verified successfully.
    /// @param txId Transfer identifier.
    /// @param proofType Proof backend used for verification.
    /// @param proofHash Hash of submitted proof payload.
    /// @param commitment Commitment derived from proof public inputs.
    /// @param proofPayload ABI-encoded proof payload.
    event ProofVerified(
        bytes32 indexed txId,
        Enums.ProofType indexed proofType,
        bytes32 proofHash,
        bytes32 commitment,
        bytes proofPayload
    );

    /// @notice Emitted when active verifier is updated for a route and proof backend.
    /// @param route Verifier route.
    /// @param proofType Proof backend type.
    /// @param verifier Active verifier contract address.
    event VerifierUpdated(Enums.VerifierRoute indexed route, Enums.ProofType indexed proofType, address verifier);

    /// @notice Emitted when a new verifier is proposed and scheduled for timelock activation.
    /// @param route Verifier route.
    /// @param proofType Proof backend type.
    /// @param verifier Pending verifier contract address.
    /// @param availableAt Earliest activation timestamp after timelock.
    event VerifierProposed(
        Enums.VerifierRoute indexed route, Enums.ProofType indexed proofType, address verifier, uint64 availableAt
    );
}
