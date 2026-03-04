// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library Enums {
    
    enum ProofType {
        RISC0,
        SNARKJS
    }

    enum TxStatus {
        NONE,                   // 0  default / tx does not exist
        DEPOSIT_LOCKED,         // 1  origin: funds locked in vault
        MINT_PROOF_ACCEPTED,    // 2  origin: destination mint verified, AckReady emitted
        REFUND_INITIATED,       // 3  origin: refund claim active, awaiting burn proof
        MINTED_IN_HOLDING,      // 4  destination: wrapped assets
        REFUND_CLAIM_ACCEPTED   // 5  destination: refund-claim proof from origin verified
    }
}
