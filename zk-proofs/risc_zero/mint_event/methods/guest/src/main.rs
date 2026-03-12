#![allow(unused_doc_comments)]
#![no_main]

use alloy_sol_types::SolValue;
use mint_proof_core::{
    IConnector, MINTED_IN_HOLDING_STATUS, MintGuestInput, build_public_inputs_from_tx,
    chain_spec_from_id,
};
use risc0_steel::Contract;
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: MintGuestInput = env::read();

    let chain_spec = chain_spec_from_id(input.destination_chain_id)
        .expect("unsupported destination chain id for Steel chain spec");

    let evm_env = input.evm_input.into_env(chain_spec);

    let contract = Contract::new(input.connector, &evm_env);
    let tx_snapshot = contract
        .call_builder(&IConnector::getTxCall { _txId: input.tx_id })
        .call();

    assert_eq!(tx_snapshot.txId, input.tx_id, "txId mismatch in getTx");
    assert!(tx_snapshot.amount > alloy_primitives::U256::ZERO, "amount must be > 0");
    assert!(!tx_snapshot.from.is_zero(), "from must be non-zero");
    assert!(!tx_snapshot.to.is_zero(), "to must be non-zero");
    assert!(
        !tx_snapshot.srcChainConnector.is_zero(),
        "srcChainConnector must be non-zero"
    );
    assert!(
        !tx_snapshot.dstChainConnector.is_zero(),
        "dstChainConnector must be non-zero"
    );
    assert_eq!(
        tx_snapshot.dstChainConnector, input.connector,
        "destination connector mismatch"
    );
    assert_eq!(
        tx_snapshot.status, MINTED_IN_HOLDING_STATUS,
        "destination tx must be MINTED_IN_HOLDING"
    );
    assert!(tx_snapshot.mintedAt > 0, "mintedAt must be set");

    let public_inputs = build_public_inputs_from_tx(
        tx_snapshot.txId,
        tx_snapshot.dstChainConnector,
        tx_snapshot.amount,
        tx_snapshot.to,
    );

    env::commit_slice(&public_inputs.abi_encode());
}
