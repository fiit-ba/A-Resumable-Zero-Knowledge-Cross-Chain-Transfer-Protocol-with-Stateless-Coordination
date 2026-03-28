// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ProofOutputs
library ProofOutputs {
    struct LockProofPublicInputs {
        bytes32 txId;
        uint256 amount;
        address sender;
        address receiver;
        address currencyFrom;
        address currencyTo;
        address srcChainConnector;
        address dstChainConnector;
        uint64 originAckDeadline;
        uint256 nonce;
        uint256 sourceChainId;
        uint256 destinationChainId;
    }

    function encodeLockProof(LockProofPublicInputs memory o) internal pure returns (bytes memory) {
        return abi.encode(
            o.txId,
            o.amount,
            o.sender,
            o.receiver,
            o.currencyFrom,
            o.currencyTo,
            o.srcChainConnector,
            o.dstChainConnector,
            o.originAckDeadline,
            o.nonce,
            o.sourceChainId,
            o.destinationChainId
        );
    }
}
