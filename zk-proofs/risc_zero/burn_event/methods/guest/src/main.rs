#![allow(unused_doc_comments)]
#![no_main]

use burn_proof_core::{
    BurnGuestInput, IConnector, ObservedDestTxClosed,
    build_public_inputs, chain_spec_from_id, select_unique_event, validate_burn_event,
};
use alloy_sol_types::SolValue;
use risc0_steel::Event;
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: BurnGuestInput = env::read();

    let chain_spec = chain_spec_from_id(input.dest_chain_id)
        .expect("unsupported destination chain id for Steel chain spec");

    let evm_env = input.evm_input.into_env(chain_spec);

    let logs = Event::new::<IConnector::DestTxClosed>(&evm_env)
        .address(input.connector)
        .topic1(input.tx_id)
        .query();

    let observed: Vec<ObservedDestTxClosed> = logs
        .iter()
        .map(ObservedDestTxClosed::from_log)
        .collect();

    let event = select_unique_event(&observed, input.connector, input.tx_id)
        .expect("failed to select DestTxClosed event");

    validate_burn_event(&event, input.connector)
        .expect("DestTxClosed validation failed");

    let public_inputs = build_public_inputs(&event);

    env::commit_slice(&public_inputs.abi_encode());
}
