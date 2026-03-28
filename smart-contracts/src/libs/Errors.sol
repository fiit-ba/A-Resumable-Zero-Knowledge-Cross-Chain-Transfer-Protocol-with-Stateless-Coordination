// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library Errors {
    /*//////////////////////////////////////////////////////////////
                              ADDRESS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error RiscZeroVerifierIsZeroAddress();
    error SnarkJsVerifierIsZeroAddress();
    error AllowedImageIdsRiscZeroIsZeroAddress();

    /*//////////////////////////////////////////////////////////////
                              ZK PROOF
    //////////////////////////////////////////////////////////////*/

    error InvalidSnarkProof();
    error InvalidRiscZeroProof();
    error ImageIdNotAllowed(bytes32 imageId);
    error EmptyAllowlist();
    error ImageIdRouteMismatch(uint8 route, bytes32 got, bytes32 expected);
    error InvalidProofType();
    error ProofAlreadyProcessed(bytes32 proofHash);
    error CommitmentMismatch(bytes32 got, bytes32 expected);
    error VerifierNotRegistered(uint8 proofType);

    /*//////////////////////////////////////////////////////////////
                           STATE MACHINE
    //////////////////////////////////////////////////////////////*/

    error InvalidStateTransition(uint8 currentStatus, uint8 requiredStatus);
    error TxAlreadyExists(bytes32 txId);
    error TxNotFound(bytes32 txId);
    error NotTxOriginator(bytes32 txId, address caller, address originator);
    error NotAdmin();

    /*//////////////////////////////////////////////////////////////
                        DEADLINES
    //////////////////////////////////////////////////////////////*/

    error DeadlineNotReached(uint64 deadline, uint64 currentTime);
    error AckWindowNotExpired(uint64 ackDeadline, uint64 currentTime);
    error AckWindowExpired(uint64 ackDeadline, uint64 currentTime);
    error ZeroAckWindow();

    /*//////////////////////////////////////////////////////////////
                             AMOUNTS
    //////////////////////////////////////////////////////////////*/

    error ZeroAmount();
}
