// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISnarkVerifier} from "../ISnarkJsVerifier.sol";
import {IZKVerifier} from "../IZKVerifier.sol";
import {Errors} from "../../libs/Errors.sol";

/// @title SnarkAdapter
contract SnarkAdapter is IZKVerifier {
    ISnarkVerifier private immutable SNARK_VERIFIER;

    constructor(address _verifier) {
        if (_verifier == address(0)) revert Errors.ZeroAddress();
        SNARK_VERIFIER = ISnarkVerifier(_verifier);
    }

    /// @notice Backwards-compatible getter for the wrapped verifier address.
    function snarkVerifier() external view returns (address) {
        return address(SNARK_VERIFIER);
    }

    /// @inheritdoc IZKVerifier
    function verify(bytes calldata proofPayload) external view override returns (bytes32 commitment) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory input) =
            abi.decode(proofPayload, (uint256[2], uint256[2][2], uint256[2], uint256[]));
        if (!SNARK_VERIFIER.verify(a, b, c, input)) revert Errors.InvalidSnarkProof();

        // input is a uint256[]; abi.encodePacked(input) is the contiguous words payload.
        assembly ("memory-safe") {
            commitment := keccak256(add(input, 0x20), mul(mload(input), 0x20))
        }
        return commitment;
    }

    /// @inheritdoc IZKVerifier
    function computeCommitment(bytes calldata publicInputs) external pure override returns (bytes32) {
        bytes memory data = publicInputs;
        bytes32 commitment;
        assembly ("memory-safe") {
            commitment := keccak256(add(data, 0x20), mload(data))
        }
        return commitment;
    }
}
