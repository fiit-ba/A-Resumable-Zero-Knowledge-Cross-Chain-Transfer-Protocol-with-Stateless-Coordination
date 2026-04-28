use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::{sol, SolEvent};
use risc0_steel::ethereum::{
    EthChainSpec, EthEvmInput, ETH_HOLESKY_CHAIN_SPEC, ETH_MAINNET_CHAIN_SPEC,
    ETH_SEPOLIA_CHAIN_SPEC,
};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

pub const MINTED_IN_HOLDING_STATUS: u8 = 3;

sol! {
    interface IConnector {
        event FundsReleased(
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
                uint256 nonce,
                uint256 sourceChainId,
                uint256 destinationChainId
            );
    }
}

sol! {
    #[sol(all_derives)]
    struct MintProofPublicInputs {
        bytes32 txId;
        address dstChainConnector;
        uint256 amount;
        address receiver;
        uint256 sourceChainId;
        uint256 destinationChainId;
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct MintGuestInput {
    pub evm_input: EthEvmInput,
    pub connector: Address,
    pub tx_id: B256,
    pub destination_chain_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedMintEvent {
    pub tx_id: B256,
    pub amount: U256,
    pub currency_from: Address,
    pub currency_to: Address,
    pub sender: Address,
    pub receiver: Address,
    pub src_chain_connector: Address,
    pub dst_chain_connector: Address,
    pub timestamp: u64,
    pub proof_type: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedFundsReleased {
    pub emitter: Address,
    pub event: NormalizedMintEvent,
}

impl ObservedFundsReleased {
    pub fn from_log(log: &alloy_primitives::Log<IConnector::FundsReleased>) -> Self {
        Self {
            emitter: log.address,
            event: NormalizedMintEvent {
                tx_id: log.data.txId,
                amount: log.data.amount,
                currency_from: log.data.currencyFrom,
                currency_to: log.data.currencyTo,
                sender: log.data.from,
                receiver: log.data.to,
                src_chain_connector: log.data.srcChainConnector,
                dst_chain_connector: log.data.dstChainConnector,
                timestamp: log.data.timestamp,
                proof_type: log.data.proofType,
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
pub enum MintValidationError {
    ZeroAmount,
    ZeroAddress(&'static str),
    DstConnectorMismatch { expected: Address, got: Address },
}

pub fn funds_released_topic0() -> B256 {
    IConnector::FundsReleased::SIGNATURE_HASH
}

pub fn chain_spec_from_id(chain_id: u64) -> Option<&'static EthChainSpec> {
    // Additional chains (Gnosis/Chiado/local) are not built into Steel's chain constants.
    // Reuse Ethereum mainnet fork rules but keep the chain id in the chain spec.
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
    events: &[ObservedFundsReleased],
    expected_connector: Address,
    expected_tx_id: B256,
) -> Result<NormalizedMintEvent, EventSelectionError> {
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

pub fn validate_mint_event(
    event: &NormalizedMintEvent,
    expected_connector: Address,
) -> Result<(), MintValidationError> {
    if event.amount == U256::ZERO {
        return Err(MintValidationError::ZeroAmount);
    }
    if event.sender.is_zero() {
        return Err(MintValidationError::ZeroAddress("sender"));
    }
    if event.receiver.is_zero() {
        return Err(MintValidationError::ZeroAddress("receiver"));
    }
    if event.currency_from.is_zero() {
        return Err(MintValidationError::ZeroAddress("currencyFrom"));
    }
    if event.currency_to.is_zero() {
        return Err(MintValidationError::ZeroAddress("currencyTo"));
    }
    if event.src_chain_connector.is_zero() {
        return Err(MintValidationError::ZeroAddress("srcChainConnector"));
    }
    if event.dst_chain_connector.is_zero() {
        return Err(MintValidationError::ZeroAddress("dstChainConnector"));
    }
    if event.dst_chain_connector != expected_connector {
        return Err(MintValidationError::DstConnectorMismatch {
            expected: expected_connector,
            got: event.dst_chain_connector,
        });
    }

    Ok(())
}

pub fn build_public_inputs_from_tx(
    tx_id: B256,
    dst_chain_connector: Address,
    amount: U256,
    receiver: Address,
    source_chain_id: U256,
    destination_chain_id: U256,
) -> MintProofPublicInputs {
    MintProofPublicInputs {
        txId: tx_id,
        dstChainConnector: dst_chain_connector,
        amount,
        receiver,
        sourceChainId: source_chain_id,
        destinationChainId: destination_chain_id,
    }
}
