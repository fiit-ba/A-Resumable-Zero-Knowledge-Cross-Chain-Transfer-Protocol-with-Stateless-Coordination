use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::{SolEvent, sol};
use risc0_steel::ethereum::{
    EthChainSpec, EthEvmInput, ETH_HOLESKY_CHAIN_SPEC, ETH_MAINNET_CHAIN_SPEC,
    ETH_SEPOLIA_CHAIN_SPEC,
};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// TxStatus::REFUND_INITIATED = 2
pub const REFUND_INITIATED_STATUS: u8 = 2;

sol! {
    interface IConnector {
        /// Emitted on the origin chain when a refund is initiated.
        event RefundClaimed(
            bytes32 indexed txId,
            address indexed from,
            uint256 amount,
            address indexed srcChainConnector
        );

        function getTx(bytes32 _txId)
            external
            view
            returns (
                bytes32 txId,
                uint256 amount,
                address currencyFrom,
                address currencyTo,
                address from,
                address to,
                address srcChainConnector,
                address dstChainConnector,
                uint64 timestamp,
                uint64 finalizedAt,
                uint64 mintedAt,
                uint64 ackDeadline,
                uint8 status,
                uint256 nonce,
                uint256 sourceChainId,
                uint256 destinationChainId
            );
    }
}

// ABI-encoded public inputs committed to the RISC Zero journal.
// Matches the commitment expected by `submitRefundClaimProof` on the destination:
//   `abi.encode(txId, srcChainConnector, amount, sourceChainId, destinationChainId)`
sol! {
    #[sol(all_derives)]
    struct RefundClaimProofPublicInputs {
        bytes32 txId;
        address srcChainConnector;
        uint256 amount;
        uint256 sourceChainId;
        uint256 destinationChainId;
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RefundClaimGuestInput {
    /// EVM input anchored to the event block — used only for the RefundClaimed log query.
    pub event_evm_input: EthEvmInput,
    /// EVM input anchored to a recent block — used only for the getTx() state read.
    pub state_evm_input: EthEvmInput,
    /// Origin-chain connector address (emitter of `RefundClaimed`).
    pub connector: Address,
    pub tx_id: B256,
    pub source_chain_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedRefundClaimedEvent {
    pub tx_id: B256,
    pub from: Address,
    pub amount: U256,
    pub src_chain_connector: Address,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedRefundClaimed {
    pub emitter: Address,
    pub event: NormalizedRefundClaimedEvent,
}

impl ObservedRefundClaimed {
    pub fn from_log(log: &alloy_primitives::Log<IConnector::RefundClaimed>) -> Self {
        Self {
            emitter: log.address,
            event: NormalizedRefundClaimedEvent {
                tx_id: log.data.txId,
                from: log.data.from,
                amount: log.data.amount,
                src_chain_connector: log.data.srcChainConnector,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EventSelectionError {
    MissingLog,
    AmbiguousLogs(usize),
    EmitterMismatch { expected: Address, got: Address },
    TxIdMismatch { expected: B256, got: B256 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RefundClaimValidationError {
    ZeroAmount,
    ZeroAddress(&'static str),
    ConnectorMismatch { expected: Address, got: Address },
    WrongStatus { expected: u8, got: u8 },
}

pub fn refund_claimed_topic0() -> B256 {
    IConnector::RefundClaimed::SIGNATURE_HASH
}

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

    match chain_id {
        1 => Some(&ETH_MAINNET_CHAIN_SPEC),
        100 => Some(&GNOSIS_CHAIN_SPEC),
        10200 => Some(&CHIADO_CHAIN_SPEC),
        11155111 => Some(&ETH_SEPOLIA_CHAIN_SPEC),
        17000 => Some(&ETH_HOLESKY_CHAIN_SPEC),
        31337 => Some(&ANVIL_CHAIN_SPEC),
        31338 => Some(&HARDHAT_CHAIN_SPEC),
        _ => None,
    }
}

pub fn select_unique_event(
    events: &[ObservedRefundClaimed],
    expected_connector: Address,
    expected_tx_id: B256,
) -> Result<NormalizedRefundClaimedEvent, EventSelectionError> {
    if events.is_empty() {
        return Err(EventSelectionError::MissingLog);
    }
    if events.len() != 1 {
        return Err(EventSelectionError::AmbiguousLogs(events.len()));
    }

    let obs = &events[0];
    if obs.emitter != expected_connector {
        return Err(EventSelectionError::EmitterMismatch {
            expected: expected_connector,
            got: obs.emitter,
        });
    }
    if obs.event.tx_id != expected_tx_id {
        return Err(EventSelectionError::TxIdMismatch {
            expected: expected_tx_id,
            got: obs.event.tx_id,
        });
    }

    Ok(obs.event.clone())
}

pub fn validate_refund_claim_event(
    event: &NormalizedRefundClaimedEvent,
    expected_connector: Address,
) -> Result<(), RefundClaimValidationError> {
    if event.amount == U256::ZERO {
        return Err(RefundClaimValidationError::ZeroAmount);
    }
    if event.from.is_zero() {
        return Err(RefundClaimValidationError::ZeroAddress("from"));
    }
    if event.src_chain_connector.is_zero() {
        return Err(RefundClaimValidationError::ZeroAddress("srcChainConnector"));
    }
    if event.src_chain_connector != expected_connector {
        return Err(RefundClaimValidationError::ConnectorMismatch {
            expected: expected_connector,
            got: event.src_chain_connector,
        });
    }
    Ok(())
}

pub fn validate_tx_status(status: u8) -> Result<(), RefundClaimValidationError> {
    if status != REFUND_INITIATED_STATUS {
        return Err(RefundClaimValidationError::WrongStatus {
            expected: REFUND_INITIATED_STATUS,
            got: status,
        });
    }
    Ok(())
}

pub fn build_public_inputs(
    event: &NormalizedRefundClaimedEvent,
    source_chain_id: U256,
    destination_chain_id: U256,
) -> RefundClaimProofPublicInputs {
    RefundClaimProofPublicInputs {
        txId: event.tx_id,
        srcChainConnector: event.src_chain_connector,
        amount: event.amount,
        sourceChainId: source_chain_id,
        destinationChainId: destination_chain_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::Log;

    #[test]
    fn refund_claimed_decodes_indexed_src_chain_connector() {
        let connector = Address::repeat_byte(0x10);
        let tx_id = B256::repeat_byte(0x11);
        let from = Address::repeat_byte(0x22);
        let amount = U256::from(1_000u64);
        let src_chain_connector = connector;

        let typed_log = Log::new_from_event_unchecked(
            connector,
            IConnector::RefundClaimed {
                txId: tx_id,
                from,
                amount,
                srcChainConnector: src_chain_connector,
            },
        );
        let raw_log = typed_log.reserialize();

        assert_eq!(raw_log.data.topics().len(), 4);
        assert_eq!(raw_log.data.data.len(), 32);

        let decoded = IConnector::RefundClaimed::decode_log(&raw_log).unwrap();
        assert_eq!(decoded.address, connector);
        assert_eq!(decoded.data.txId, tx_id);
        assert_eq!(decoded.data.from, from);
        assert_eq!(decoded.data.amount, amount);
        assert_eq!(decoded.data.srcChainConnector, src_chain_connector);
    }
}
