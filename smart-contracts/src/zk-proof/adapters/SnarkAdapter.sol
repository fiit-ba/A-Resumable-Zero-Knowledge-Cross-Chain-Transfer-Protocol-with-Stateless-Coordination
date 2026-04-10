// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ISnarkVerifier} from "../ISnarkJsVerifier.sol";
import {IZKVerifier} from "../IZKVerifier.sol";
import {Errors} from "../../libs/Errors.sol";

/// @title SnarkAdapter
/// @author Trustless Universal Protocol Contributors
/// @notice Wraps a SnarkJS verifier behind the generic IZKVerifier interface.
contract SnarkAdapter is IZKVerifier {
    ISnarkVerifier private immutable _SNARK_VERIFIER;

    constructor(address _verifier) {
        if (_verifier == address(0)) revert Errors.ZeroAddress();
        _SNARK_VERIFIER = ISnarkVerifier(_verifier);
    }

    /// @notice Backwards-compatible getter for the wrapped verifier address.
    function snarkVerifier() external view returns (address) {
        return address(_SNARK_VERIFIER);
    }

    /// @inheritdoc IZKVerifier
    function verify(bytes calldata proofPayload) external view override returns (bytes32 commitment) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory input) =
            abi.decode(proofPayload, (uint256[2], uint256[2][2], uint256[2], uint256[]));
        if (!_SNARK_VERIFIER.verify(a, b, c, input)) revert Errors.InvalidSnarkProof();
        return keccak256(abi.encodePacked(input));
    }

    /// @inheritdoc IZKVerifier
    function computeCommitment(bytes calldata publicInputs) external pure override returns (bytes32) {
        return keccak256(publicInputs);
    }
}
