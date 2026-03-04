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
    error InvalidProofType();
    error ProofAlreadyProcessed(bytes32 proofHash);
    error CommitmentMismatch(bytes32 got, bytes32 expected);

    /*//////////////////////////////////////////////////////////////
                           STATE MACHINE
    //////////////////////////////////////////////////////////////*/

    error InvalidStateTransition(uint8 currentStatus, uint8 requiredStatus);
    error TxAlreadyExists(bytes32 txId);
    error TxNotFound(bytes32 txId);

    /*//////////////////////////////////////////////////////////////
                        DEADLINES
    //////////////////////////////////////////////////////////////*/

    error DeadlineNotReached(uint64 deadline, uint64 currentTime);
    error AckWindowNotExpired(uint64 ackDeadline, uint64 currentTime);

    /*//////////////////////////////////////////////////////////////
                             AMOUNTS
    //////////////////////////////////////////////////////////////*/

    error ZeroAmount();
}
