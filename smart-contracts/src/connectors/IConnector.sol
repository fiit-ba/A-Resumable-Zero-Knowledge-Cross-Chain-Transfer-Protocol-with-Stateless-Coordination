// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Enums} from "../libs/Enums.sol";

interface IConnector {

    /*//////////////////////////////////////////////////////////////
                            ORIGIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function depositAndLock(
        address currencyFrom,
        address currencyTo,
        address to,
        uint256 amount,
        address dstChainConnector
    ) external returns (bytes32 txId);

    function submitMintProof(
        Enums.ProofType proofType,
        bytes calldata  proofPayload,
        bytes32         txId
    ) external;

    function initiateRefund(bytes32 txId) external;

    function submitBurnProof(
        Enums.ProofType proofType,
        bytes calldata  proofPayload,
        bytes32         txId
    ) external;

    function closeTx(bytes32 txId) external;

    /*//////////////////////////////////////////////////////////////
                            DESTINATION FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function submitDepositProof(
        Enums.ProofType proofType,
        bytes calldata  proofPayload,
        bytes32 txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address from,
        address to,
        address srcChainConnector,
        uint64  originAckDeadline
    ) external;

    function submitAckProof(
        Enums.ProofType proofType,
        bytes calldata  proofPayload,
        bytes32         txId
    ) external;

    function submitRefundClaimProof(
        Enums.ProofType proofType,
        bytes calldata  proofPayload,
        bytes32         txId
    ) external;

    function executeBurn(bytes32 txId) external;
}
