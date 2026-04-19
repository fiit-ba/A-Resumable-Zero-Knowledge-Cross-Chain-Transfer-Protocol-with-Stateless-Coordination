// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Enums} from "../libs/Enums.sol";

/// @title IConnector
/// @author Trustless Universal Protocol Contributors
/// @notice Interface for verifier management and cross-chain transfer lifecycle actions.
interface IConnector {
    /// @notice Step 1: propose a new verifier. Becomes active after VERIFIER_TIMELOCK (48 h).
    /// @param route Verifier route for which to update the verifier.
    /// @param proofType Proof backend type for which to update the verifier.
    /// @param verifier Proposed verifier contract address.
    function proposeVerifier(Enums.VerifierRoute route, Enums.ProofType proofType, address verifier) external;

    /// @notice Step 2: activate the pending verifier once the timelock has expired.
    /// @param route Verifier route for which to apply the pending verifier.
    /// @param proofType Proof backend type for which to apply the pending verifier.
    function applyVerifier(Enums.VerifierRoute route, Enums.ProofType proofType) external;

    /*//////////////////////////////////////////////////////////////
                            ORIGIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Locks source funds and creates the origin-side transaction record.
    /// @param currencyFrom Source-chain token being locked.
    /// @param currencyTo Destination-side token expected to be minted/released.
    /// @param to Destination recipient address.
    /// @param amount Transfer amount.
    /// @param dstChainConnector Destination connector contract address.
    /// @param destinationChainId Destination chain ID.
    /// @return txId Unique transfer identifier.
    function depositAndLock(
        address currencyFrom,
        address currencyTo,
        address to,
        uint256 amount,
        address dstChainConnector,
        uint256 destinationChainId
    ) external returns (bytes32 txId);

    /// @notice Submits a destination mint proof to finalize the origin-side mint acknowledgement.
    /// @param proofType Proof backend used to verify the payload.
    /// @param proofPayload ABI-encoded proof payload.
    /// @param txId Transfer identifier.
    function submitMintProof(Enums.ProofType proofType, bytes calldata proofPayload, bytes32 txId) external;

    /// @notice Initiates refund flow for a transfer once destination acknowledgement is not received in time.
    /// @param txId Transfer identifier.
    function initiateRefund(bytes32 txId) external;

    /// @notice Submits a burn proof to complete refund flow on the origin chain.
    /// @param proofType Proof backend used to verify the payload.
    /// @param proofPayload ABI-encoded proof payload.
    /// @param txId Transfer identifier.
    function submitBurnProof(Enums.ProofType proofType, bytes calldata proofPayload, bytes32 txId) external;

    /// @notice Submits a ZK non-acceptance proof to recover origin funds when the destination never
    ///         accepted the lock.  The proof attests — via a verifiable storage proof of the
    ///         destination connector — that `destinationLockAccepted[txId]` was `false` at some
    ///         block whose timestamp is at or after `ackDeadline`.  Because the destination hard-
    ///         blocks `submitLockProof` once `block.timestamp >= ackDeadline`, a non-acceptance
    ///         attestation from that point is final: no mint can ever happen for this txId.
    ///
    /// @dev Assumption: the destination chain and its gateway are eventually available — i.e., the
    ///      relayer can always read destination state and generate the storage proof.  This is the
    ///      stated protocol compromise: a permanently unresponsive destination chain cannot be
    ///      handled without an additional on-chain timeout mechanism.
    ///
    ///      Public inputs committed to by the proof:
    ///        (txId, dstChainConnector, ackDeadline, sourceChainId, destinationChainId)
    ///
    ///      Callable only after `initiateRefund` (status == REFUND_INITIATED).
    /// @param proofType Proof backend used to verify the payload.
    /// @param proofPayload ABI-encoded proof payload.
    /// @param txId Transfer identifier.
    function submitNonAcceptanceProof(Enums.ProofType proofType, bytes calldata proofPayload, bytes32 txId) external;

    /*//////////////////////////////////////////////////////////////
                            DESTINATION FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Submits lock proof and transfer metadata to materialize destination-side state.
    /// @param proofType Proof backend used to verify the payload.
    /// @param proofPayload ABI-encoded proof payload.
    /// @param txId Transfer identifier.
    /// @param amount Transfer amount.
    /// @param currencyFrom Source-chain token address.
    /// @param currencyTo Destination-side token address.
    /// @param from Origin sender address.
    /// @param to Destination recipient address.
    /// @param srcChainConnector Source connector contract address.
    /// @param originAckDeadline Deadline timestamp used for origin acknowledgement window.
    /// @param nonce Source-chain transfer nonce.
    /// @param sourceChainId Source chain ID.
    function submitLockProof(
        Enums.ProofType proofType,
        bytes calldata proofPayload,
        bytes32 txId,
        uint256 amount,
        address currencyFrom,
        address currencyTo,
        address from,
        address to,
        address srcChainConnector,
        uint64 originAckDeadline,
        uint256 nonce,
        uint256 sourceChainId
    ) external;

    /// @notice Submits acknowledgement proof on destination side.
    /// @param proofType Proof backend used to verify the payload.
    /// @param proofPayload ABI-encoded proof payload.
    /// @param txId Transfer identifier.
    function submitAckProof(Enums.ProofType proofType, bytes calldata proofPayload, bytes32 txId) external;

    /// @notice Submits refund-claim proof on destination side.
    /// @param proofType Proof backend used to verify the payload.
    /// @param proofPayload ABI-encoded proof payload.
    /// @param txId Transfer identifier.
    function submitRefundClaimProof(Enums.ProofType proofType, bytes calldata proofPayload, bytes32 txId) external;

    /// @notice Executes destination-side burn for a completed transfer.
    /// @param txId Transfer identifier.
    function executeBurn(bytes32 txId) external;

    /*//////////////////////////////////////////////////////////////
                             VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Returns currently active verifier for a route and proof type.
    /// @param route Verifier route.
    /// @param proofType Proof backend type.
    function getVerifier(Enums.VerifierRoute route, Enums.ProofType proofType) external view returns (address);

    /// @notice Returns the pending verifier and the timestamp at which it can be applied.
    /// @param route Verifier route.
    /// @param proofType Proof backend type.
    /// @return verifier Pending verifier contract address.
    /// @return availableAt Earliest timestamp when pending verifier may be applied.
    function getPendingVerifier(Enums.VerifierRoute route, Enums.ProofType proofType)
        external
        view
        returns (address verifier, uint64 availableAt);

    /// @notice Returns the expected RISC Zero image ID for the given proof route.
    /// @param route Verifier route.
    function getExpectedRisc0ImageId(Enums.VerifierRoute route) external view returns (bytes32);
}
