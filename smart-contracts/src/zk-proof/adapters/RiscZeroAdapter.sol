// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {IZKVerifier} from "../IZKVerifier.sol";
import {Errors} from "../../libs/Errors.sol";

/// @title RiscZeroAdapter
/// @notice Wraps IRiscZeroVerifier into the generic IZKVerifier interface.
/// Accepts a list of allowed image IDs so one adapter can serve all proof routes on a chain.
contract RiscZeroAdapter is IZKVerifier {
    IRiscZeroVerifier public immutable risc0Verifier;

    mapping(bytes32 => bool) internal _allowedImageIds;

    constructor(address _verifier, bytes32[] memory _imageIds) {
        if (_verifier == address(0)) revert Errors.ZeroAddress();
        if (_imageIds.length == 0) revert Errors.EmptyAllowlist();
        risc0Verifier = IRiscZeroVerifier(_verifier);
        for (uint256 i = 0; i < _imageIds.length; i++) {
            if (_imageIds[i] == bytes32(0)) revert Errors.AllowedImageIdsRiscZeroIsZeroAddress();
            _allowedImageIds[_imageIds[i]] = true;
        }
    }

    /// @notice Returns true if the given image ID is in the adapter allowlist.
    function isImageIdAllowed(bytes32 imageId) external view returns (bool) {
        return _allowedImageIds[imageId];
    }

    /// @inheritdoc IZKVerifier
    function verify(bytes calldata proofPayload) external view override returns (bytes32 commitment) {
        (bytes memory seal, bytes32 imageId, bytes32 journalDigest) =
            abi.decode(proofPayload, (bytes, bytes32, bytes32));
        if (!_allowedImageIds[imageId]) revert Errors.ImageIdNotAllowed(imageId);
        risc0Verifier.verify(seal, imageId, journalDigest);
        return journalDigest;
    }

    /// @inheritdoc IZKVerifier
    function computeCommitment(bytes calldata publicInputs) external pure override returns (bytes32) {
        return sha256(publicInputs);
    }
}
