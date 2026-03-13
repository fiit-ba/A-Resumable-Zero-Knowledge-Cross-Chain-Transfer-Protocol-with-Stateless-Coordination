use alloy_primitives::{Address, B256};
use alloy_sol_types::{sol, SolEvent};
use risc0_steel::ethereum::{
    EthChainSpec, EthEvmInput, ETH_HOLESKY_CHAIN_SPEC, ETH_MAINNET_CHAIN_SPEC,
    ETH_SEPOLIA_CHAIN_SPEC,
};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

pub const MINT_PROOF_ACCEPTED_STATUS: u8 = 2;

sol! {
    interface IConnector {
        event AckReady(
            bytes32 indexed txId,
            uint256 amount,
            address currencyFrom,
            address currencyTo,
            address indexed from,
            address to,
            address srcChainConnector,
            address dstChainConnector,
            uint64 timestamp,
            uint8 proofType,
            bytes32 proofHash,
            bytes32 commitment,
            bytes proofPayload
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
                uint256 nonce
            );
    }
}

sol! {
    #[sol(all_derives)]
    struct AckProofPublicInputs {
        bytes32 txId;
        address srcChainConnector;
        address dstChainConnector;
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AckGuestInput {
    pub evm_input: EthEvmInput,
    pub connector: Address,
    pub tx_id: B256,
    pub source_chain_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedAckEvent {
    pub tx_id: B256,
    pub sender: Address,
    pub receiver: Address,
    pub src_chain_connector: Address,
    pub dst_chain_connector: Address,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedAckReady {
    pub emitter: Address,
    pub event: NormalizedAckEvent,
}

impl ObservedAckReady {
    pub fn from_log(log: &alloy_primitives::Log<IConnector::AckReady>) -> Self {
        Self {
            emitter: log.address,
            event: NormalizedAckEvent {
                tx_id: log.data.txId,
                sender: log.data.from,
                receiver: log.data.to,
                src_chain_connector: log.data.srcChainConnector,
                dst_chain_connector: log.data.dstChainConnector,
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
pub enum AckValidationError {
    ZeroAddress(&'static str),
    SrcConnectorMismatch { expected: Address, got: Address },
}

pub fn ack_ready_topic0() -> B256 {
    IConnector::AckReady::SIGNATURE_HASH
}

pub fn chain_spec_from_id(chain_id: u64) -> Option<&'static EthChainSpec> {
    // Local dev chains (Anvil/Hardhat) are not built into Steel's chain constants.
    // Reuse Ethereum mainnet fork rules but keep the local chain id in the chain spec.
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
        11155111 => Some(&ETH_SEPOLIA_CHAIN_SPEC),
        17000 => Some(&ETH_HOLESKY_CHAIN_SPEC),
        31337 => Some(&ANVIL_CHAIN_SPEC),
        31338 => Some(&HARDHAT_CHAIN_SPEC),
        _ => None,
    }
}

pub fn select_unique_event(
    events: &[ObservedAckReady],
    expected_connector: Address,
    expected_tx_id: B256,
) -> Result<NormalizedAckEvent, EventSelectionError> {
    if events.is_empty() {
        return Err(EventSelectionError::MissingLog);
    }
    if events.len() != 1 {
        return Err(EventSelectionError::AmbiguousLogs(events.len()));
    }

    let event = &events[0];
    if event.emitter != expected_connector {
        return Err(EventSelectionError::EmitterMismatch {
            expected: expected_connector,
            got: event.emitter,
        });
    }
    if event.event.tx_id != expected_tx_id {
        return Err(EventSelectionError::TxIdMismatch {
            expected: expected_tx_id,
            got: event.event.tx_id,
        });
    }

    Ok(event.event.clone())
}

pub fn validate_ack_event(
    event: &NormalizedAckEvent,
    expected_source_connector: Address,
) -> Result<(), AckValidationError> {
    if event.sender.is_zero() {
        return Err(AckValidationError::ZeroAddress("sender"));
    }
    if event.receiver.is_zero() {
        return Err(AckValidationError::ZeroAddress("receiver"));
    }
    if event.src_chain_connector.is_zero() {
        return Err(AckValidationError::ZeroAddress("srcChainConnector"));
    }
    if event.dst_chain_connector.is_zero() {
        return Err(AckValidationError::ZeroAddress("dstChainConnector"));
    }
    if event.src_chain_connector != expected_source_connector {
        return Err(AckValidationError::SrcConnectorMismatch {
            expected: expected_source_connector,
            got: event.src_chain_connector,
        });
    }

    Ok(())
}

pub fn build_public_inputs(event: &NormalizedAckEvent) -> AckProofPublicInputs {
    AckProofPublicInputs {
        txId: event.tx_id,
        srcChainConnector: event.src_chain_connector,
        dstChainConnector: event.dst_chain_connector,
    }
}

pub fn build_public_inputs_from_tx(
    tx_id: B256,
    src_chain_connector: Address,
    dst_chain_connector: Address,
) -> AckProofPublicInputs {
    AckProofPublicInputs {
        txId: tx_id,
        srcChainConnector: src_chain_connector,
        dstChainConnector: dst_chain_connector,
    }
}
