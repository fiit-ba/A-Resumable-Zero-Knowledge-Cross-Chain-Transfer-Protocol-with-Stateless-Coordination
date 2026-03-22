#![allow(unused_doc_comments)]
#![no_main]

use refund_claim_proof_core::{
    IConnector, ObservedRefundClaimed, REFUND_INITIATED_STATUS, RefundClaimGuestInput,
    build_public_inputs, chain_spec_from_id, select_unique_event, validate_refund_claim_event,
    validate_tx_status,
};
use alloy_sol_types::SolValue;
use risc0_steel::{Contract, Event};
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: RefundClaimGuestInput = env::read();

    let chain_spec = chain_spec_from_id(input.source_chain_id)
        .expect("unsupported source chain id for Steel chain spec");

    let evm_env = input.evm_input.into_env(chain_spec);

    let logs = Event::new::<IConnector::RefundClaimed>(&evm_env)
        .address(input.connector)
        .topic1(input.tx_id)
        .query();

    let observed: Vec<ObservedRefundClaimed> = logs
        .iter()
        .map(ObservedRefundClaimed::from_log)
        .collect();

    let event = select_unique_event(&observed, input.connector, input.tx_id)
        .expect("failed to select RefundClaimed event");

    validate_refund_claim_event(&event, input.connector)
        .expect("RefundClaimed validation failed");

    let contract = Contract::new(input.connector, &evm_env);
    let tx_snapshot = contract
        .call_builder(&IConnector::getTxCall { _txId: input.tx_id })
        .call();

    assert_eq!(tx_snapshot.txId, input.tx_id, "txId mismatch in getTx");
    assert_eq!(
        tx_snapshot.status, REFUND_INITIATED_STATUS,
        "source tx must be REFUND_INITIATED"
    );
    assert_eq!(
        tx_snapshot.srcChainConnector, event.src_chain_connector,
        "srcChainConnector mismatch in getTx"
    );
    assert_eq!(
        tx_snapshot.amount, event.amount,
        "amount mismatch in getTx"
    );

    validate_tx_status(tx_snapshot.status).expect("tx status validation failed");

    let public_inputs = build_public_inputs(&event);

    env::commit_slice(&public_inputs.abi_encode());
}
