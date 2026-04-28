#![allow(unused_doc_comments)]
#![no_main]

use alloy_sol_types::SolValue;
use lock_proof_core::{
    IConnector, LockGuestInput, ObservedDepositLocked, build_public_inputs, chain_spec_from_id,
    select_unique_event, validate_lock_event,
};
use risc0_steel::{Contract, Event};
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: LockGuestInput = env::read();

    let chain_spec = chain_spec_from_id(input.source_chain_id)
        .expect("unsupported source chain id for Steel chain spec");

    // Event environment: anchored to the block where DepositLocked was emitted.
    let event_env = input.event_evm_input.into_env(chain_spec);

    let logs = Event::new::<IConnector::DepositLocked>(&event_env)
        .address(input.connector)
        .topic1(input.tx_id)
        .query();

    let observed: Vec<ObservedDepositLocked> =
        logs.iter().map(ObservedDepositLocked::from_log).collect();

    let event = select_unique_event(&observed, input.connector, input.tx_id)
        .expect("failed to select a unique DepositLocked event");

    validate_lock_event(&event, input.source_chain_id, input.destination_chain_id)
        .expect("DepositLocked validation failed");

    // State environment: anchored to a recent block for the getTx() storage read.
    // Connector storage for this txId is unchanged between the event block and the state block
    // because storage is only deleted after submitMintProof succeeds.
    let state_env = input.state_evm_input.into_env(chain_spec);

    let contract = Contract::new(input.connector, &state_env);
    let tx_snapshot = contract
        .call_builder(&IConnector::getTxCall { _txId: input.tx_id })
        .call();

    assert_eq!(tx_snapshot.txId, event.tx_id, "txId mismatch in getTx");
    assert_eq!(tx_snapshot.amount, event.amount, "amount mismatch in getTx");
    assert_eq!(tx_snapshot.currencyFrom, event.currency_from, "currencyFrom mismatch in getTx");
    assert_eq!(tx_snapshot.currencyTo, event.currency_to, "currencyTo mismatch in getTx");
    assert_eq!(tx_snapshot.from, event.sender, "from mismatch in getTx");
    assert_eq!(tx_snapshot.to, event.receiver, "to mismatch in getTx");
    assert_eq!(
        tx_snapshot.srcChainConnector, event.src_chain_connector,
        "srcChainConnector mismatch in getTx"
    );
    assert_eq!(
        tx_snapshot.dstChainConnector, event.dst_chain_connector,
        "dstChainConnector mismatch in getTx"
    );
    assert_eq!(tx_snapshot.nonce, event.nonce, "nonce mismatch in getTx");
    assert_eq!(tx_snapshot.ackDeadline, event.ack_deadline, "ackDeadline mismatch in getTx");

    let public_inputs = build_public_inputs(&event);

    env::commit_slice(&public_inputs.abi_encode());
}
