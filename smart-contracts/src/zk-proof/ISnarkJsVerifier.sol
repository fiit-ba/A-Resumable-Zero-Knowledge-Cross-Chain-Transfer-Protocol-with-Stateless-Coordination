// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title ISnarkVerifier
/// @author Trustless Universal Protocol Contributors
/// @notice Interface for Groth16 verifier contracts generated for SnarkJS proofs.
interface ISnarkVerifier {
    /// @notice Verifies a Groth16 proof against the provided public inputs.
    /// @param a Groth16 proof point A.
    /// @param b Groth16 proof point B.
    /// @param c Groth16 proof point C.
    /// @param input Public inputs for verification.
    /// @return True when the proof is valid for the given inputs.
    function verify(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[] calldata input)
        external
        view
        returns (bool);
}
