use alloy_primitives::{Address, B256, U256, keccak256};
use alloy_sol_types::{SolEvent, SolValue, sol};
use risc0_steel::ethereum::{
    ETH_HOLESKY_CHAIN_SPEC, ETH_MAINNET_CHAIN_SPEC, ETH_SEPOLIA_CHAIN_SPEC, EthChainSpec,
    EthEvmInput,
};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

sol! {
    interface IConnector {
        event DepositLocked(
            bytes32 indexed txId,
            address indexed from,
            address to,
            uint256 amount,
            address currencyFrom,
            address currencyTo,
            address srcChainConnector,
            address dstChainConnector,
            uint64 timestamp,
            uint256 nonce,
            uint256 sourceChainId
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
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LockGuestInput {
    pub evm_input: EthEvmInput,
    pub connector: Address,
    pub tx_id: B256,
    pub source_chain_id: u64,
    pub destination_chain_id: U256,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedLockEvent {
    pub tx_id: B256,
    pub sender: Address,
    pub receiver: Address,
    pub amount: U256,
    pub currency_from: Address,
    pub currency_to: Address,
    pub src_chain_connector: Address,
    pub dst_chain_connector: Address,
    pub timestamp: u64,
    pub nonce: U256,
    pub source_chain_id: U256,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedDepositLocked {
    pub emitter: Address,
    pub event: NormalizedLockEvent,
}

impl ObservedDepositLocked {
    pub fn from_log(log: &alloy_primitives::Log<IConnector::DepositLocked>) -> Self {
        Self {
            emitter: log.address,
            event: NormalizedLockEvent {
                tx_id: log.data.txId,
                sender: log.data.from,
                receiver: log.data.to,
                amount: log.data.amount,
                currency_from: log.data.currencyFrom,
                currency_to: log.data.currencyTo,
                src_chain_connector: log.data.srcChainConnector,
                dst_chain_connector: log.data.dstChainConnector,
                timestamp: log.data.timestamp,
                nonce: log.data.nonce,
                source_chain_id: log.data.sourceChainId,
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
pub enum LockValidationError {
    ZeroAmount,
    ZeroAddress(&'static str),
    ZeroSourceChainId,
    SourceChainMismatch { expected: u64, got: U256 },
    SameSourceAndDestinationChain,
    TxIdMismatch { expected: B256, got: B256 },
}

pub fn deposit_locked_topic0() -> B256 {
    IConnector::DepositLocked::SIGNATURE_HASH
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

pub fn compute_tx_id(event: &NormalizedLockEvent) -> B256 {
    let encoded = (
        event.sender,
        event.receiver,
        event.amount,
        event.currency_from,
        event.currency_to,
        event.src_chain_connector,
        event.dst_chain_connector,
        event.nonce,
    )
    .abi_encode();

    keccak256(encoded)
}

pub fn select_unique_event(
    events: &[ObservedDepositLocked],
    expected_connector: Address,
    expected_tx_id: B256,
) -> Result<NormalizedLockEvent, EventSelectionError> {
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

pub fn validate_lock_event(
    event: &NormalizedLockEvent,
    expected_source_chain_id: u64,
    destination_chain_id: U256,
) -> Result<(), LockValidationError> {
    if event.amount == U256::ZERO {
        return Err(LockValidationError::ZeroAmount);
    }
    if event.sender.is_zero() {
        return Err(LockValidationError::ZeroAddress("sender"));
    }
    if event.receiver.is_zero() {
        return Err(LockValidationError::ZeroAddress("receiver"));
    }
    if event.currency_from.is_zero() {
        return Err(LockValidationError::ZeroAddress("currencyFrom"));
    }
    if event.currency_to.is_zero() {
        return Err(LockValidationError::ZeroAddress("currencyTo"));
    }
    if event.src_chain_connector.is_zero() {
        return Err(LockValidationError::ZeroAddress("srcChainConnector"));
    }
    if event.dst_chain_connector.is_zero() {
        return Err(LockValidationError::ZeroAddress("dstChainConnector"));
    }
    if event.source_chain_id == U256::ZERO {
        return Err(LockValidationError::ZeroSourceChainId);
    }

    let expected_source_chain_u256 = U256::from(expected_source_chain_id);
    if event.source_chain_id != expected_source_chain_u256 {
        return Err(LockValidationError::SourceChainMismatch {
            expected: expected_source_chain_id,
            got: event.source_chain_id,
        });
    }

    if event.source_chain_id == destination_chain_id {
        return Err(LockValidationError::SameSourceAndDestinationChain);
    }

    let computed_tx_id = compute_tx_id(event);
    if computed_tx_id != event.tx_id {
        return Err(LockValidationError::TxIdMismatch {
            expected: computed_tx_id,
            got: event.tx_id,
        });
    }

    Ok(())
}

pub fn build_public_inputs(
    event: &NormalizedLockEvent,
    destination_chain_id: U256,
    origin_ack_deadline: u64,
) -> LockProofPublicInputs {
    LockProofPublicInputs {
        txId: event.tx_id,
        amount: event.amount,
        sender: event.sender,
        receiver: event.receiver,
        currencyFrom: event.currency_from,
        currencyTo: event.currency_to,
        srcChainConnector: event.src_chain_connector,
        dstChainConnector: event.dst_chain_connector,
        originAckDeadline: origin_ack_deadline,
        nonce: event.nonce,
        sourceChainId: event.source_chain_id,
        destinationChainId: destination_chain_id,
    }
}
