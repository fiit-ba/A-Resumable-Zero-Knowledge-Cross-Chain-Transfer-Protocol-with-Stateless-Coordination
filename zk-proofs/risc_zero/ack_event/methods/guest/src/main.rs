#![allow(unused_doc_comments)]
#![no_main]

use ack_proof_core::{
    AckGuestInput, IConnector, MINT_PROOF_ACCEPTED_STATUS, ObservedAckReady,
    build_public_inputs_from_tx, chain_spec_from_id, select_unique_event, validate_ack_event,
};
use alloy_sol_types::SolValue;
use risc0_steel::{Contract, Event};
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: AckGuestInput = env::read();

    let chain_spec = chain_spec_from_id(input.source_chain_id)
        .expect("unsupported source chain id for Steel chain spec");

    let evm_env = input.evm_input.into_env(chain_spec);

    let logs = Event::new::<IConnector::AckReady>(&evm_env)
        .address(input.connector)
        .topic1(input.tx_id)
        .query();

    let observed: Vec<ObservedAckReady> = logs.iter().map(ObservedAckReady::from_log).collect();

    let event =
        select_unique_event(&observed, input.connector, input.tx_id).expect("failed to select AckReady event");

    validate_ack_event(&event, input.connector).expect("AckReady validation failed");

    let contract = Contract::new(input.connector, &evm_env);
    let tx_snapshot = contract
        .call_builder(&IConnector::getTxCall { _txId: input.tx_id })
        .call();

    assert_eq!(tx_snapshot.txId, input.tx_id, "txId mismatch in getTx");
    assert_eq!(
        tx_snapshot.status, MINT_PROOF_ACCEPTED_STATUS,
        "source tx must be MINT_PROOF_ACCEPTED"
    );
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

    let public_inputs = build_public_inputs_from_tx(
        tx_snapshot.txId,
        tx_snapshot.srcChainConnector,
        tx_snapshot.dstChainConnector,
    );

    env::commit_slice(&public_inputs.abi_encode());
}
