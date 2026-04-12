use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::sol;
use risc0_steel::ethereum::{
    EthChainSpec, EthEvmInput, ETH_HOLESKY_CHAIN_SPEC, ETH_MAINNET_CHAIN_SPEC,
    ETH_SEPOLIA_CHAIN_SPEC,
};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

// Solidity interface for destination-connector state reads.
// The guest calls `destinationLockAccepted(txId)` to confirm the transfer
// was never accepted on the destination chain.  The call is a pure view read
// backed by a Steel storage proof, so it cannot be forged by the prover.
sol! {
    interface IConnector {
        /// Returns true if submitLockProof was ever successfully processed
        /// for this txId on this (destination) connector.
        function destinationLockAccepted(bytes32 txId)
            external
            view
            returns (bool);
    }
}

// ABI-encoded public inputs committed to the RISC Zero journal.
// Matches the commitment expected by `submitNonAcceptanceProof` on the origin chain:
//   `abi.encode(txId, dstChainConnector, ackDeadline, sourceChainId, destinationChainId)`
sol! {
    #[sol(all_derives)]
    struct NonAcceptProofPublicInputs {
        bytes32 txId;
        address dstChainConnector;
        uint64  ackDeadline;
        uint256 sourceChainId;
        uint256 destinationChainId;
    }
}

/// All data the host prepares and serialises into the zkVM guest.
#[derive(Clone, Serialize, Deserialize)]
pub struct NonAcceptGuestInput {
    /// Steel EVM input for the **destination** chain at the chosen block.
    pub evm_input: EthEvmInput,
    /// Address of the destination connector (`dstChainConnector`).
    pub dst_connector: Address,
    /// Cross-chain transfer identifier.
    pub tx_id: B256,
    /// `ackDeadline` from the origin transfer record (u64 seconds).
    pub ack_deadline: u64,
    /// Origin chain ID (carried through to public inputs for cross-chain
    /// commitment binding).
    pub source_chain_id: U256,
    /// Destination chain ID (used to select the Steel chain spec in-guest
    /// and bound in the public inputs).
    pub dest_chain_id: u64,
}

/// Errors that can occur when validating the non-acceptance condition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NonAcceptValidationError {
    /// The destination connector accepted the lock — refund is not allowed
    /// via this path.
    LockAlreadyAccepted,
    /// The execution block timestamp is before `ackDeadline`, so finality
    /// of non-acceptance has not been reached yet.
    TooEarly { ack_deadline: u64, block_timestamp: u64 },
    /// The connector address supplied is the zero address.
    ZeroDstConnector,
}

/// Returns the chain spec for a known chain id, or `None` for unknown chains.
pub fn chain_spec_from_id(chain_id: u64) -> Option<&'static EthChainSpec> {
    static GNOSIS_CHAIN_SPEC: LazyLock<EthChainSpec> = LazyLock::new(|| {
        let mut spec = ETH_MAINNET_CHAIN_SPEC.clone();
        spec.chain_id = 100;
        spec
    });
    static CHIADO_CHAIN_SPEC: LazyLock<EthChainSpec> = LazyLock::new(|| {
        let mut spec = ETH_MAINNET_CHAIN_SPEC.clone();
        spec.chain_id = 10200;
        spec
    });
    static ANVIL_CHAIN_SPEC: LazyLock<EthChainSpec> = LazyLock::new(|| {
        let mut spec = ETH_MAINNET_CHAIN_SPEC.clone();
        spec.chain_id = 31337;
        spec
    });
    static HARDHAT_CHAIN_SPEC: LazyLock<EthChainSpec> = LazyLock::new(|| {
        let mut spec = ETH_MAINNET_CHAIN_SPEC.clone();
        spec.chain_id = 31338;
        spec
    });
    static HOODI_CHAIN_SPEC: LazyLock<EthChainSpec> = LazyLock::new(|| {
        let mut spec = ETH_MAINNET_CHAIN_SPEC.clone();
        spec.chain_id = 560048;
        spec
    });

    match chain_id {
        1 => Some(&ETH_MAINNET_CHAIN_SPEC),
        100 => Some(&GNOSIS_CHAIN_SPEC),
        10200 => Some(&CHIADO_CHAIN_SPEC),
        11155111 => Some(&ETH_SEPOLIA_CHAIN_SPEC),
        17000 => Some(&ETH_HOLESKY_CHAIN_SPEC),
        31337 => Some(&ANVIL_CHAIN_SPEC),
        31338 => Some(&HARDHAT_CHAIN_SPEC),
        560048 => Some(&HOODI_CHAIN_SPEC),
        _ => None,
    }
}

/// Core validation: assert the destination never accepted the lock and that
/// the proof is taken at or after the ack deadline.
///
/// `block_timestamp` is the `timestamp` field of the execution block header
/// inside `evm_env` — obtained via `evm_env.header().timestamp` in the guest.
pub fn validate_non_acceptance(
    lock_accepted: bool,
    block_timestamp: u64,
    ack_deadline: u64,
    dst_connector: Address,
) -> Result<(), NonAcceptValidationError> {
    if dst_connector.is_zero() {
        return Err(NonAcceptValidationError::ZeroDstConnector);
    }
    if lock_accepted {
        return Err(NonAcceptValidationError::LockAlreadyAccepted);
    }
    if block_timestamp < ack_deadline {
        return Err(NonAcceptValidationError::TooEarly {
            ack_deadline,
            block_timestamp,
        });
    }
    Ok(())
}

/// Build the public-input struct that will be ABI-encoded into the journal.
pub fn build_public_inputs(
    tx_id: B256,
    dst_connector: Address,
    ack_deadline: u64,
    source_chain_id: U256,
    dest_chain_id: u64,
) -> NonAcceptProofPublicInputs {
    NonAcceptProofPublicInputs {
        txId: tx_id,
        dstChainConnector: dst_connector,
        ackDeadline: ack_deadline,
        sourceChainId: source_chain_id,
        destinationChainId: U256::from(dest_chain_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::address;

    const CONNECTOR: Address = address!("0000000000000000000000000000000000000001");

    #[test]
    fn validate_ok() {
        assert!(validate_non_acceptance(false, 1000, 999, CONNECTOR).is_ok());
    }

    #[test]
    fn validate_ok_at_exact_deadline() {
        assert!(validate_non_acceptance(false, 1000, 1000, CONNECTOR).is_ok());
    }

    #[test]
    fn validate_too_early() {
        let err = validate_non_acceptance(false, 999, 1000, CONNECTOR).unwrap_err();
        assert_eq!(
            err,
            NonAcceptValidationError::TooEarly {
                ack_deadline: 1000,
                block_timestamp: 999,
            }
        );
    }

    #[test]
    fn validate_lock_accepted() {
        let err = validate_non_acceptance(true, 2000, 1000, CONNECTOR).unwrap_err();
        assert_eq!(err, NonAcceptValidationError::LockAlreadyAccepted);
    }

    #[test]
    fn validate_zero_connector() {
        let err = validate_non_acceptance(false, 2000, 1000, Address::ZERO).unwrap_err();
        assert_eq!(err, NonAcceptValidationError::ZeroDstConnector);
    }
}
