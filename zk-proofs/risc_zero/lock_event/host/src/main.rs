use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::SolValue;
use anyhow::{ensure, Context, Result};
use clap::Parser;
use lock_proof_core::{chain_spec_from_id, IConnector, LockGuestInput, LockProofPublicInputs};
use lock_proof_methods::{LOCK_PROOF_GUEST_ELF, LOCK_PROOF_GUEST_ID};
use risc0_ethereum_contracts::encode_seal;
use risc0_steel::{ethereum::EthEvmEnv, host::BlockNumberOrTag, Contract, Event};
use risc0_zkvm::{default_prover, sha::Digestible, Digest, ExecutorEnv, Prover, ProverOpts};
use std::time::Instant;
use tracing_subscriber::EnvFilter;
use url::Url;

#[derive(Parser, Debug)]
#[command(about = "Generate trustless RISC Zero lock proof from DepositLocked event")]
struct Args {
    #[arg(long, env = "RPC_URL")]
    rpc_url: Url,

    #[arg(long)]
    connector: Address,

    #[arg(long)]
    tx_id: B256,

    #[arg(long)]
    source_chain_id: u64,

    #[arg(long)]
    destination_chain_id: u64,

    /// Block used to locate the DepositLocked event (must be the exact block where it was emitted).
    /// Defaults to "latest" but should always be set to the event block by the relay client.
    #[arg(long, env = "EXECUTION_BLOCK", default_value_t = BlockNumberOrTag::Latest)]
    execution_block: BlockNumberOrTag,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let args = Args::parse();

    let chain_spec = chain_spec_from_id(args.source_chain_id)
        .with_context(|| format!("unsupported source chain id: {}", args.source_chain_id))?;

    // --- Event environment (at the event block) ---
    // Used only for Event::preflight — fetches the DepositLocked log via eth_getLogs.
    // eth_getLogs is always available for historical blocks; no state trie is accessed here.
    let mut event_env = EthEvmEnv::builder()
        .rpc(args.rpc_url.clone())
        .chain_spec(chain_spec)
        .block_number_or_tag(args.execution_block)
        .build()
        .await
        .context("failed to build event EthEvmEnv")?;

    let event_query = Event::preflight::<IConnector::DepositLocked>(&mut event_env)
        .address(args.connector)
        .topic1(args.tx_id);
    let logs = event_query
        .query()
        .await
        .context("DepositLocked preflight failed")?;

    ensure!(!logs.is_empty(), "no DepositLocked logs found for txId");
    ensure!(
        logs.len() == 1,
        "expected exactly one DepositLocked log for txId, got {}",
        logs.len()
    );

    // --- State environment (at latest block) ---
    // Used only for Contract::preflight (getTx state read).
    // "latest" is always available regardless of RPC archive depth.
    // The connector storage for this txId is unchanged between the event block and "latest"
    // because storage is only deleted after submitMintProof succeeds.
    let mut state_env = EthEvmEnv::builder()
        .rpc(args.rpc_url.clone())
        .chain_spec(chain_spec)
        .block_number_or_tag(BlockNumberOrTag::Latest)
        .build()
        .await
        .context("failed to build state EthEvmEnv")?;

    let mut connector = Contract::preflight(args.connector, &mut state_env);
    let tx_snapshot = connector
        .call_builder(&IConnector::getTxCall { _txId: args.tx_id })
        .call()
        .await
        .context("getTx preflight failed")?;
    ensure!(
        tx_snapshot.txId == args.tx_id,
        "getTx returned unexpected txId"
    );

    let guest_input = LockGuestInput {
        event_evm_input: event_env
            .into_input()
            .await
            .context("failed to build event EthEvmInput")?,
        state_evm_input: state_env
            .into_input()
            .await
            .context("failed to build state EthEvmInput")?,
        connector: args.connector,
        tx_id: args.tx_id,
        source_chain_id: args.source_chain_id,
        destination_chain_id: U256::from(args.destination_chain_id),
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

        default_prover().prove_with_opts(exec_env, LOCK_PROOF_GUEST_ELF, &ProverOpts::groth16())
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
        .verify(LOCK_PROOF_GUEST_ID)
        .context("receipt verification failed")?;

    let journal_bytes = &receipt.journal.bytes;
    let public_inputs = LockProofPublicInputs::abi_decode(journal_bytes)
        .context("failed to decode lock proof public inputs")?;

    let image_id = <[u8; 32]>::from(Digest::from(LOCK_PROOF_GUEST_ID));
    let image_id_b256 = B256::from(image_id);
    let journal_digest = B256::from_slice(receipt.journal.digest().as_bytes());
    let seal = encode_seal(&receipt).context("failed to encode seal")?;
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
    println!("amount: {}", public_inputs.amount);
    println!("sender: {}", public_inputs.sender);
    println!("receiver: {}", public_inputs.receiver);
    println!("currencyFrom: {}", public_inputs.currencyFrom);
    println!("currencyTo: {}", public_inputs.currencyTo);
    println!("srcChainConnector: {}", public_inputs.srcChainConnector);
    println!("dstChainConnector: {}", public_inputs.dstChainConnector);
    println!("originAckDeadline: {}", public_inputs.originAckDeadline);
    println!("nonce: {}", public_inputs.nonce);
    println!("sourceChainId: {}", public_inputs.sourceChainId);
    println!("destChainId: {}", public_inputs.destinationChainId);

    Ok(())
}
