use alloy_primitives::{Address, B256};
use alloy_sol_types::SolValue;
use anyhow::{ensure, Context, Result};
use clap::Parser;
use mint_proof_core::{
    chain_spec_from_id, IConnector, MintGuestInput, MintProofPublicInputs, MINTED_IN_HOLDING_STATUS,
};
use mint_proof_methods::{MINT_PROOF_GUEST_ELF, MINT_PROOF_GUEST_ID};
use risc0_ethereum_contracts::encode_seal;
use risc0_steel::{ethereum::EthEvmEnv, host::BlockNumberOrTag, Contract};
use risc0_zkvm::{default_prover, sha::Digestible, Digest, ExecutorEnv, Prover, ProverOpts};
use std::time::Instant;
use tracing_subscriber::EnvFilter;
use url::Url;

#[derive(Parser, Debug)]
#[command(about = "Generate trustless RISC Zero mint proof from FundsReleased event")]
struct Args {
    #[arg(long, env = "RPC_URL")]
    rpc_url: Url,

    #[arg(long)]
    connector: Address,

    #[arg(long)]
    tx_id: B256,

    #[arg(long)]
    destination_chain_id: u64,

    #[arg(long, env = "EXECUTION_BLOCK", default_value_t = BlockNumberOrTag::Latest)]
    execution_block: BlockNumberOrTag,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let args = Args::parse();

    let chain_spec = chain_spec_from_id(args.destination_chain_id).with_context(|| {
        format!(
            "unsupported destination chain id: {}",
            args.destination_chain_id
        )
    })?;

    let mut env = EthEvmEnv::builder()
        .rpc(args.rpc_url)
        .chain_spec(chain_spec)
        .block_number_or_tag(args.execution_block)
        .build()
        .await
        .context("failed to build EthEvmEnv")?;

    let mut connector = Contract::preflight(args.connector, &mut env);
    let tx_snapshot = connector
        .call_builder(&IConnector::getTxCall { _txId: args.tx_id })
        .call()
        .await
        .context("getTx preflight failed")?;
    ensure!(
        tx_snapshot.txId == args.tx_id,
        "getTx returned unexpected txId"
    );
    ensure!(
        tx_snapshot.status == MINTED_IN_HOLDING_STATUS,
        "destination tx status is not MINTED_IN_HOLDING"
    );

    let guest_input = MintGuestInput {
        evm_input: env
            .into_input()
            .await
            .context("failed to build EthEvmInput")?,
        connector: args.connector,
        tx_id: args.tx_id,
        destination_chain_id: args.destination_chain_id,
    };

    eprintln!(
        "Starting Groth16 proving for txId 0x{} (this may take several minutes)...",
        hex::encode(args.tx_id)
    );
    let prove_start = Instant::now();
    let prove_info = tokio::task::spawn_blocking(move || {
        let exec_env = ExecutorEnv::builder()
            .write(&guest_input)
            .context("failed to encode guest input")?
            .build()
            .context("failed to build ExecutorEnv")?;

        default_prover().prove_with_opts(exec_env, MINT_PROOF_GUEST_ELF, &ProverOpts::groth16())
    })
    .await
    .context("prover worker task join failed")?
    .context("proof generation failed")?;
    let prove_elapsed = prove_start.elapsed();
    eprintln!(
        "Proving finished in {} ms, verifying receipt...",
        prove_elapsed.as_millis()
    );

    let receipt = prove_info.receipt;

    receipt
        .verify(MINT_PROOF_GUEST_ID)
        .context("receipt verification failed")?;

    let journal_bytes = &receipt.journal.bytes;
    let public_inputs = MintProofPublicInputs::abi_decode(journal_bytes)
        .context("failed to decode mint proof public inputs")?;

    let image_id = <[u8; 32]>::from(Digest::from(MINT_PROOF_GUEST_ID));
    let image_id_b256 = B256::from(image_id);
    let journal_digest = B256::from_slice(receipt.journal.digest().as_bytes());
    let seal = encode_seal(&receipt).context("failed to encode seal")?;
    // Encode as ABI params so Solidity can decode directly as (bytes, bytes32, bytes32).
    let proof_payload = (seal.clone(), image_id_b256, journal_digest).abi_encode_params();

    println!("Proof generated and verified.");
    println!("proveTimeMs: {}", prove_elapsed.as_millis());
    println!("segments: {}", prove_info.stats.segments);
    println!("totalCycles: {}", prove_info.stats.total_cycles);
    println!("userCycles: {}", prove_info.stats.user_cycles);
    println!("pagingCycles: {}", prove_info.stats.paging_cycles);
    println!("reservedCycles: {}", prove_info.stats.reserved_cycles);
    println!("imageId: 0x{}", hex::encode(image_id_b256));
    println!("journalDigest: 0x{}", hex::encode(journal_digest));
    println!("proofPayload: 0x{}", hex::encode(proof_payload));
    println!("txId: 0x{}", hex::encode(public_inputs.txId));
    println!("dstChainConnector: {}", public_inputs.dstChainConnector);
    println!("amount: {}", public_inputs.amount);
    println!("receiver: {}", public_inputs.receiver);

    Ok(())
}
