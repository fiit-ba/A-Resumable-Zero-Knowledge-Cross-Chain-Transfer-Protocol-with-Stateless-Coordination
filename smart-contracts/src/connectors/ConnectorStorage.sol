// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {ISnarkVerifier} from "../zk-proof/ISnarkJsVerifier.sol";
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
        uint64 timestamp
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

    /*//////////////////////////////////////////////////////////////
                            ZK
    //////////////////////////////////////////////////////////////*/

    IRiscZeroVerifier public risc0;

    ISnarkVerifier public snark;

    bytes32 public imageIdRiscZero;

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

    uint64 public ackWindowSeconds;
}
