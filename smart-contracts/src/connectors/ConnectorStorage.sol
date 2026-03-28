// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Enums} from "../libs/Enums.sol";

/// @title ConnectorStorage
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
                            EVENTS
    //////////////////////////////////////////////////////////////*/

    event DepositLocked(
        bytes32 indexed txId,
        address indexed from,
        address to,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp,
        uint256 nonce,
        uint256 sourceChainId,
        uint256 destinationChainId
    );

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

    event RefundClaimed(bytes32 indexed txId, address indexed from, uint256 amount, address srcChainConnector);

    event RefundExecuted(bytes32 indexed txId, address indexed to, uint256 amount);

    event OriginTxClosed(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp
    );

    // DESTINATION

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
        bytes proofPayload
    );

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

    event DestTxClosed(
        bytes32 indexed txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address indexed from,
        address to,
        address srcChainConnector,
        address dstChainConnector,
        uint64 timestamp
    );

    event ProofVerified(
        bytes32 indexed txId,
        Enums.ProofType indexed proofType,
        bytes32 proofHash,
        bytes32 commitment,
        bytes proofPayload
    );

    event VerifierUpdated(Enums.VerifierRoute indexed route, Enums.ProofType indexed proofType, address verifier);

    /*//////////////////////////////////////////////////////////////
                            ZK
    //////////////////////////////////////////////////////////////*/

    // _verifiers[route][proofType] => adapter address
    mapping(uint8 => mapping(uint8 => address)) internal _verifiers;

    mapping(bytes32 => mapping(bytes32 => bool)) public txProofUsed;

    mapping(bytes32 => bytes32[]) internal txProofHashes;

    /*//////////////////////////////////////////////////////////////
                            TRANSACTION
    //////////////////////////////////////////////////////////////*/

    mapping(bytes32 => CrossChainTx) internal _txs;

    mapping(bytes32 => Enums.TxStatus) public txStatus;

    /*//////////////////////////////////////////////////////////////
                            GLOBAL CONFIG VARIABLES
    //////////////////////////////////////////////////////////////*/

    uint256 public txNonce;

    /// @dev Expected RISC Zero image ID per VerifierRoute (index == uint8(VerifierRoute)).
    /// Enforced by Connector before calling the adapter so a single multi-image adapter
    /// can serve all routes while each route still binds to exactly one guest ELF.
    bytes32[5] internal _risc0RouteImageIds;
}
