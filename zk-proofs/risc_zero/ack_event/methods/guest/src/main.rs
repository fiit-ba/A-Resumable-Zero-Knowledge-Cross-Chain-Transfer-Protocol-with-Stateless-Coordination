#![allow(unused_doc_comments)]
#![no_main]

use ack_proof_core::{
    AckGuestInput, IConnector, ObservedAckReady,
    build_public_inputs, chain_spec_from_id, select_unique_event, validate_ack_event,
};
use alloy_primitives::U256;
use alloy_sol_types::SolValue;
use risc0_steel::Event;
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: AckGuestInput = env::read();

    let chain_spec = chain_spec_from_id(input.source_chain_id)
        .expect("unsupported source chain id for Steel chain spec");

    // Event environment: anchored to the block where AckReady was emitted.
    // submitMintProof deletes the source tx record via _cleanupTx, so there is
    // no storage to read — all public inputs come from the event log.
    let event_env = input.event_evm_input.into_env(chain_spec);

    let logs = Event::new::<IConnector::AckReady>(&event_env)
        .address(input.connector)
        .topic1(input.tx_id)
        .query();

    let observed: Vec<ObservedAckReady> = logs.iter().map(ObservedAckReady::from_log).collect();

    let event =
        select_unique_event(&observed, input.connector, input.tx_id).expect("failed to select AckReady event");

    validate_ack_event(&event, input.connector).expect("AckReady validation failed");

    let public_inputs = build_public_inputs(
        &event,
        U256::from(input.source_chain_id),
        U256::from(input.destination_chain_id),
    );

    env::commit_slice(&public_inputs.abi_encode());
}
