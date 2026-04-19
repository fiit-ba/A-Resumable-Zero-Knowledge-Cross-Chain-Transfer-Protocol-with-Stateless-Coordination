// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title Enums
/// @author Trustless Universal Protocol Contributors
/// @notice Shared enum definitions used by connector contracts and relay integration.
library Enums {
    enum ProofType {
        RISC0,
        SNARKJS
    }

    enum VerifierRoute {
        ORIGIN_MINT, //       0  submitMintProof
        ORIGIN_BURN, //       1  submitBurnProof
        DEST_LOCK, //         2  submitLockProof
        DEST_ACK, //          3  submitAckProof
        DEST_REFUND_CLAIM, // 4  submitRefundClaimProof
        ORIGIN_NON_ACCEPT //  5  submitNonAcceptanceProof
    }

    enum TxStatus {
        NONE, //                0  default / tx does not exist
        DEPOSIT_LOCKED, //      1  origin: funds locked in vault
        REFUND_INITIATED, //    2  origin: refund claim active, awaiting burn proof
        MINTED_IN_HOLDING, //   3  destination: wrapped assets minted into holding
        REFUND_CLAIM_ACCEPTED // 4  destination: refund-claim proof from origin verified
    }
}
