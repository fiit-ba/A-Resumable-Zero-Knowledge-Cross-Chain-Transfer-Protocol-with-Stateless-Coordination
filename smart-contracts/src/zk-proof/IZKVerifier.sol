// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IZKVerifier
/// @author Trustless Universal Protocol Contributors
/// @notice Generic verifier interface for supported zero-knowledge proof backends.
interface IZKVerifier {
    /// @notice Verify a proof and extract the commitment (public outputs digest).
    /// @param proofPayload Backend-specific ABI-encoded proof data.
    /// @return commitment The commitment derived from the verified public outputs.
    function verify(bytes calldata proofPayload) external view returns (bytes32 commitment);

    /// @notice Compute the expected commitment from raw ABI-encoded public inputs.
    /// @dev The hashing algorithm is backend-specific (sha256 for RISC Zero, keccak256 for SnarkJS, etc.).
    /// @param publicInputs ABI-encoded public inputs.
    /// @return The commitment hash that a valid proof for these inputs would produce.
    function computeCommitment(bytes calldata publicInputs) external pure returns (bytes32);
}
