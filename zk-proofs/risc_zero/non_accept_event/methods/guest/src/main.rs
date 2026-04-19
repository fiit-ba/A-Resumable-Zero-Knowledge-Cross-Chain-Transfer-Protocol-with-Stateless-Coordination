#![allow(unused_doc_comments)]
#![no_main]

use non_accept_proof_core::{
    IConnector, NonAcceptGuestInput,
    build_public_inputs, chain_spec_from_id, validate_non_acceptance,
};
use alloy_primitives::U256;
use alloy_sol_types::SolValue;
use risc0_steel::Contract;
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: NonAcceptGuestInput = env::read();

    let chain_spec = chain_spec_from_id(input.dest_chain_id)
        .expect("unsupported destination chain id for Steel chain spec");

    // Build the verified EVM environment for the destination chain.
    // `into_env` cryptographically binds this execution to the block header
    // committed inside `evm_input` — the block hash is part of the Steel proof.
    let evm_env = input.evm_input.into_env(chain_spec);

    // Read the block timestamp from the verified execution environment header.
    // This timestamp is part of the block header whose hash Steel commits to,
    // so it cannot be forged by the prover.
    let block_timestamp: u64 = evm_env.header().timestamp;

    // Call `destinationLockAccepted(txId)` on the destination connector.
    // Steel generates a verifiable storage proof for this view call — the
    // result is trustless and cannot be manipulated by the host.
    let contract = Contract::new(input.dst_connector, &evm_env);
    let lock_accepted: bool = contract
        .call_builder(&IConnector::destinationLockAcceptedCall {
            txId: input.tx_id,
        })
        .call();

    // Validate: lock must not have been accepted, and the block must be at or
    // after ackDeadline so that non-acceptance is final (submitLockProof on the
    // destination is permanently blocked once block.timestamp >= ackDeadline).
    validate_non_acceptance(
        lock_accepted,
        block_timestamp,
        input.ack_deadline,
        input.dst_connector,
    )
    .expect("non-acceptance validation failed");

    // Commit the public inputs: these are the values the origin-chain contract
    // will verify the commitment against in submitNonAcceptanceProof.
    let public_inputs = build_public_inputs(
        input.tx_id,
        input.dst_connector,
        input.ack_deadline,
        input.source_chain_id,
        input.dest_chain_id,
    );

    env::commit_slice(&public_inputs.abi_encode());
}
