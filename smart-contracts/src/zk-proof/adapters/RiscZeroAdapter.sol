// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {IZKVerifier} from "../IZKVerifier.sol";
import {Errors} from "../../libs/Errors.sol";

/// @title RiscZeroAdapter
/// @notice Wraps IRiscZeroVerifier into the generic IZKVerifier interface.
/// Encapsulates image-id validation and RISC Zero-specific proof decoding.
contract RiscZeroAdapter is IZKVerifier {
    IRiscZeroVerifier public immutable risc0Verifier;
    bytes32 public immutable allowedImageId;

    constructor(address _verifier, bytes32 _imageId) {
        if (_verifier == address(0)) revert Errors.ZeroAddress();
        if (_imageId == bytes32(0)) revert Errors.AllowedImageIdsRiscZeroIsZeroAddress();
        risc0Verifier = IRiscZeroVerifier(_verifier);
        allowedImageId = _imageId;
    }

    /// @inheritdoc IZKVerifier
    function verify(bytes calldata proofPayload) external view override returns (bytes32 commitment) {
        (bytes memory seal, bytes32 imageId, bytes32 journalDigest) =
            abi.decode(proofPayload, (bytes, bytes32, bytes32));
        if (allowedImageId != imageId) revert Errors.ImageIdNotAllowed(imageId);
        risc0Verifier.verify(seal, imageId, journalDigest);
        return journalDigest;
    }

    /// @inheritdoc IZKVerifier
    function computeCommitment(bytes calldata publicInputs) external pure override returns (bytes32) {
        return sha256(publicInputs);
    }
}
