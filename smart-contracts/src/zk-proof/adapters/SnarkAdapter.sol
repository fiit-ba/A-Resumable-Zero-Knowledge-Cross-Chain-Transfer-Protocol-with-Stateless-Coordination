// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISnarkVerifier} from "../ISnarkJsVerifier.sol";
import {IZKVerifier} from "../IZKVerifier.sol";
import {Errors} from "../../libs/Errors.sol";

/// @title SnarkAdapter
contract SnarkAdapter is IZKVerifier {
    ISnarkVerifier public immutable snarkVerifier;

    constructor(address _verifier) {
        if (_verifier == address(0)) revert Errors.ZeroAddress();
        snarkVerifier = ISnarkVerifier(_verifier);
    }

    /// @inheritdoc IZKVerifier
    function verify(bytes calldata proofPayload) external view override returns (bytes32 commitment) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory input) =
            abi.decode(proofPayload, (uint256[2], uint256[2][2], uint256[2], uint256[]));
        if (!snarkVerifier.verify(a, b, c, input)) revert Errors.InvalidSnarkProof();
        return keccak256(abi.encodePacked(input));
    }

    /// @inheritdoc IZKVerifier
    function computeCommitment(bytes calldata publicInputs) external pure override returns (bytes32) {
        return keccak256(publicInputs);
    }
}