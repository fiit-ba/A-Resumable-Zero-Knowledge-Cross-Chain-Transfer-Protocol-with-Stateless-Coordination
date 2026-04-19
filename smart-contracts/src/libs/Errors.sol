// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title Errors
/// @author Trustless Universal Protocol Contributors
/// @notice Shared custom errors used across connector, verifier adapter, and token modules.
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
                        WRAPPED TOKEN FACTORY
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when submitLockProof is replayed for a txId that already completed
    ///         a destination lock lifecycle (even after _cleanupTx erased active storage).
    error DestinationLockAlreadyAccepted(bytes32 txId);

    /// @notice Emitted when the factory has no wrapped token registered for a route.
    error WrappedTokenNotRegistered(bytes32 routeKey);

    /// @notice Emitted when the supplied currency does not match the factory-registered wrapper.
    error WrappedTokenMismatch(address got, address expected);

    /// @notice Emitted when register() is called for a route that already has a wrapped token.
    error RouteAlreadyRegistered(bytes32 routeKey);

    /*//////////////////////////////////////////////////////////////
                        DEADLINES
    //////////////////////////////////////////////////////////////*/

    error DeadlineNotReached(uint64 deadline, uint64 currentTime);
    error AckWindowNotExpired(uint64 ackDeadline, uint64 currentTime);
    error AckWindowExpired(uint64 ackDeadline, uint64 currentTime);
    error ZeroAckWindow();
    error TimelockNotExpired(uint64 availableAt, uint64 currentTime);
    error TimelockExpired(uint64 availableAt, uint64 currentTime);
    error NoPendingVerifier(uint8 route, uint8 proofType);
    error NoPendingRoute(bytes32 routeKey);

    /*//////////////////////////////////////////////////////////////
                             AMOUNTS
    //////////////////////////////////////////////////////////////*/

    error ZeroAmount();
}
