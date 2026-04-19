// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ProofOutputs} from "../../src/libs/ProofOutputs.sol";

/// @notice Certora helper that mirrors proof payload construction in Connector.t.sol.
contract ProofPayloadBuilder {
    function buildRisc0Proof(bytes memory publicInputs, bytes32 imageId) external pure returns (bytes memory) {
        bytes32 journalDigest = sha256(publicInputs);
        bytes memory seal = hex"cafe";
        return abi.encode(seal, imageId, journalDigest);
    }

    /// @dev Builds a SNARK proof payload from ABI-encoded public inputs.
    ///      The outer loop is fully unrolled (up to 12 words, covering all proof types)
    ///      and _wordAt uses a single mload instead of a 32-byte byte-shift loop.
    ///      This prevents Certora from truncating either loop at loop_iter: 2, which
    ///      would produce incorrect `input` values and cause spurious commitment mismatches
    ///      in every proof-submission rule.
    function buildSnarkProof(bytes memory publicInputs) external pure returns (bytes memory) {
        uint256 words = publicInputs.length / 32;
        uint256[] memory input = new uint256[](words);

        // Manually unrolled – no loop for Certora to truncate.
        // Handles up to 12 words (LockProof has 12 fields; all others have 5 or 6).
        if (words > 0)  input[0]  = _wordAt(publicInputs, 0);
        if (words > 1)  input[1]  = _wordAt(publicInputs, 1);
        if (words > 2)  input[2]  = _wordAt(publicInputs, 2);
        if (words > 3)  input[3]  = _wordAt(publicInputs, 3);
        if (words > 4)  input[4]  = _wordAt(publicInputs, 4);
        if (words > 5)  input[5]  = _wordAt(publicInputs, 5);
        if (words > 6)  input[6]  = _wordAt(publicInputs, 6);
        if (words > 7)  input[7]  = _wordAt(publicInputs, 7);
        if (words > 8)  input[8]  = _wordAt(publicInputs, 8);
        if (words > 9)  input[9]  = _wordAt(publicInputs, 9);
        if (words > 10) input[10] = _wordAt(publicInputs, 10);
        if (words > 11) input[11] = _wordAt(publicInputs, 11);

        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];
        return abi.encode(a, b, c, input);
    }

    function buildLockProofInputs(
        bytes32 txId,
        uint256 amount,
        address sender,
        address receiver,
        address currencyFrom,
        address currencyTo,
        address srcChainConnector,
        address dstChainConnector,
        uint64 originAckDeadline,
        uint256 nonce,
        uint256 sourceChainId,
        uint256 destinationChainId
    ) external pure returns (bytes memory) {
        return ProofOutputs.encodeLockProof(
            ProofOutputs.LockProofPublicInputs({
                txId: txId,
                amount: amount,
                sender: sender,
                receiver: receiver,
                currencyFrom: currencyFrom,
                currencyTo: currencyTo,
                srcChainConnector: srcChainConnector,
                dstChainConnector: dstChainConnector,
                originAckDeadline: originAckDeadline,
                nonce: nonce,
                sourceChainId: sourceChainId,
                destinationChainId: destinationChainId
            })
        );
    }

    /// @dev Loads the i-th 32-byte word from a `bytes memory` array using a single
    ///      mload. The original byte-shift loop ran 32 iterations — far beyond the
    ///      Certora loop_iter: 2 bound — so the prover produced symbolic/partial values
    ///      that broke commitment equality. One mload is loop-free and fully precise.
    function _wordAt(bytes memory data, uint256 wordIndex) private pure returns (uint256 out) {
        // Memory layout of `bytes memory data`:
        //   data[ptr+0 .. ptr+31]  : length (32-byte prefix)
        //   data[ptr+32 .. ptr+63] : byte 0..31  (word 0)
        //   data[ptr+64 .. ptr+95] : byte 32..63 (word 1)
        //   ...
        // So word i starts at ptr + 32 + i*32 = ptr + (i+1)*32.
        assembly {
            out := mload(add(data, mul(add(wordIndex, 1), 32)))
        }
    }
}
