use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::{SolEvent, SolValue, sol};
use risc0_steel::ethereum::{
    EthChainSpec, EthEvmInput, ETH_HOLESKY_CHAIN_SPEC, ETH_MAINNET_CHAIN_SPEC,
    ETH_SEPOLIA_CHAIN_SPEC,
};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

sol! {
    interface IConnector {
        /// Emitted on the destination chain when executeBurn is called after a
        /// refund claim is accepted.
        event DestTxClosed(
            bytes32 indexed txId,
            uint256 amount,
            address currencyFrom,
            address currencyTo,
            address indexed from,
            address to,
            address srcChainConnector,
            address dstChainConnector,
            uint64 timestamp
        );
    }
}

/// ABI-encoded public inputs committed to the RISC Zero journal.
/// Matches the commitment expected by `submitBurnProof` on the origin chain:
///   `abi.encode(txId, dstChainConnector, amount)`
sol! {
    #[sol(all_derives)]
    struct BurnProofPublicInputs {
        bytes32 txId;
        address dstChainConnector;
        uint256 amount;
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BurnGuestInput {
    pub evm_input: EthEvmInput,
    /// Destination-chain connector address (emitter of `DestTxClosed`).
    pub connector: Address,
    pub tx_id: B256,
    pub dest_chain_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedDestTxClosedEvent {
    pub tx_id: B256,
    pub amount: U256,
    pub currency_from: Address,
    pub currency_to: Address,
    pub from: Address,
    pub to: Address,
    pub src_chain_connector: Address,
    pub dst_chain_connector: Address,
    pub timestamp: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedDestTxClosed {
    pub emitter: Address,
    pub event: NormalizedDestTxClosedEvent,
}

impl ObservedDestTxClosed {
    pub fn from_log(log: &alloy_primitives::Log<IConnector::DestTxClosed>) -> Self {
        Self {
            emitter: log.address,
            event: NormalizedDestTxClosedEvent {
                tx_id: log.data.txId,
                amount: log.data.amount,
                currency_from: log.data.currencyFrom,
                currency_to: log.data.currencyTo,
                from: log.data.from,
                to: log.data.to,
                src_chain_connector: log.data.srcChainConnector,
                dst_chain_connector: log.data.dstChainConnector,
                timestamp: log.data.timestamp,
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
pub enum BurnValidationError {
    ZeroAmount,
    ZeroAddress(&'static str),
    ConnectorMismatch { expected: Address, got: Address },
}

pub fn dest_tx_closed_topic0() -> B256 {
    IConnector::DestTxClosed::SIGNATURE_HASH
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
    events: &[ObservedDestTxClosed],
    expected_connector: Address,
    expected_tx_id: B256,
) -> Result<NormalizedDestTxClosedEvent, EventSelectionError> {
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

pub fn validate_burn_event(
    event: &NormalizedDestTxClosedEvent,
    expected_connector: Address,
) -> Result<(), BurnValidationError> {
    if event.amount == U256::ZERO {
        return Err(BurnValidationError::ZeroAmount);
    }
    if event.dst_chain_connector.is_zero() {
        return Err(BurnValidationError::ZeroAddress("dstChainConnector"));
    }
    if event.dst_chain_connector != expected_connector {
        return Err(BurnValidationError::ConnectorMismatch {
            expected: expected_connector,
            got: event.dst_chain_connector,
        });
    }
    Ok(())
}

pub fn build_public_inputs(event: &NormalizedDestTxClosedEvent) -> BurnProofPublicInputs {
    BurnProofPublicInputs {
        txId: event.tx_id,
        dstChainConnector: event.dst_chain_connector,
        amount: event.amount,
    }
}
