# RISC Zero Lock Proof

This workspace generates a RISC Zero Groth16 proof for a `DepositLocked` event emitted by the Connector contract.

## Workspace Layout

- `core`: shared types and validation logic for lock proofs.
- `methods`: RISC Zero guest method (zkVM program), embedded into the host at build time.
- `host`: CLI app that fetches on-chain data, proves, verifies locally, and prints proof artifacts.

## Prerequisites

- Rust + Cargo (stable toolchain).
- Access to an EVM RPC endpoint for the source chain.
- A `DepositLocked` transaction ID (`txId`) and Connector contract address.

Note: first build can take several minutes because dependencies and zkVM tooling are compiled/downloaded.

## Quick Start

From this workspace:

```bash
cd zk-proofs/risc_zero/lock_event
cargo run -p lock-proof-host -- \
  --rpc-url https://YOUR_RPC_URL \
  --connector 0xYourConnectorAddress \
  --tx-id 0xYourDepositLockedTxId \
  --source-chain-id 11155111 \
  --destination-chain-id 84532
```

Or use environment variables for frequently reused values:

```bash
cd zk-proofs/risc_zero/lock_event
RPC_URL=https://YOUR_RPC_URL \
EXECUTION_BLOCK=latest \
cargo run -p lock-proof-host -- \
  --connector 0xYourConnectorAddress \
  --tx-id 0xYourDepositLockedTxId \
  --source-chain-id 11155111 \
  --destination-chain-id 84532
```

## CLI Arguments

- `--rpc-url` (or `RPC_URL`): source chain RPC URL.
- `--connector`: Connector contract address that emitted `DepositLocked`.
- `--tx-id`: `txId` from the `DepositLocked` event.
- `--source-chain-id`: chain where the lock event happened.
- `--destination-chain-id`: destination chain id for the cross-chain tx.
- `--execution-block` (or `EXECUTION_BLOCK`, default `latest`): block number/tag used for preflight.

## What You Get

On success, the host prints:

- `imageId`
- `journalDigest`
- `proofPayload`
- decoded public inputs (`txId`, `amount`, `sender`, `receiver`, chain IDs, etc.)

`proofPayload` is ABI-encoded as:

```solidity
(bytes seal, bytes32 imageId, bytes32 journalDigest)
```

This matches `RiscZeroAdapter.verify(...)` in smart contracts, so you can pass it to connector proof submission flows.

## How To Read Inputs

- `tx-id`: from `DepositLocked(bytes32 indexed txId, ...)`.
- `connector`: address of the contract that emitted that event.
- `source-chain-id`: chain where `DepositLocked` was emitted.
- `destination-chain-id`: target chain configured for this transfer.

## Local Test Topology (Anvil -> Hardhat)

If you use:

- source chain: Anvil (`http://127.0.0.1:8545`)
- destination chain: Hardhat (`http://127.0.0.1:8546`)

then use different chain IDs, for example:

- Anvil chain id: `31337`
- Hardhat chain id: `31338`

Example prove command:

```bash
cd zk-proofs/risc_zero/lock_event
RPC_URL=http://127.0.0.1:8545 \
EXECUTION_BLOCK=latest \
cargo run -p lock-proof-host -- \
  --connector 0xSourceConnectorOnAnvil \
  --tx-id 0xDepositLockedTxId \
  --source-chain-id 31337 \
  --destination-chain-id 31338
```

Important: source and destination chain IDs must differ, otherwise proof generation fails validation.

## Docker Prover (Recommended on ARM Hosts)

If local proving is slow/failing on Apple Silicon or other ARM machines, run the host prover in Docker:

```bash
cd /path/to/repo
PROVER_ACTION=prove \
RPC_URL=http://127.0.0.1:8545 \
CONNECTOR=0xSourceConnectorOnAnvil \
TX_ID=0xDepositLockedTxId \
SOURCE_CHAIN_ID=31337 \
DEST_CHAIN_ID=31338 \
bash zk-proofs/risc_zero/lock_event/scripts/prove-lock-docker.sh
```

Notes:

- `localhost` / `127.0.0.1` RPC URLs are automatically rewritten to `host.docker.internal` for the container.
- Docker prover defaults to `DOCKER_PLATFORM=linux/amd64`.
- `linux/arm64` is not currently supported by `rzup`; if provided, the script automatically falls back to `linux/amd64`.
- Force image rebuild: `DOCKER_REBUILD=1`.
- `r0vm` install is optional in Docker image; if GitHub rate limits are hit, image build still continues.
- If you have a GitHub token, export `GITHUB_TOKEN` before running to reduce rate-limit failures during image build.

Print image id from Docker:

```bash
cd /path/to/repo
PROVER_ACTION=print-image-id bash zk-proofs/risc_zero/lock_event/scripts/prove-lock-docker.sh
```

First run can still take several minutes (image build + dependency compilation).

## Built-in RISC Zero Docker Build (No Rust-in-Docker)

If you want to run host Rust locally but let `risc0-build` compile guest methods via Docker,
set:

```bash
RISC0_GUEST_USE_DOCKER=1
```

This uses RISC Zero's own guest-builder container (`risczero/risc0-guest-builder:*`) from
`methods/build.rs`, while `cargo run` still executes on your machine.

## Development Commands

```bash
cd zk-proofs/risc_zero/lock_event
cargo run -p lock-proof-host -- --help
cargo run -p lock-proof-host --bin print_image_id
cargo test
```

## Common Errors

- `unsupported source chain id`: `--source-chain-id` is not supported by the Steel chain-spec mapping.
- `no DepositLocked logs found for txId`: wrong `txId`, wrong connector, wrong chain, or wrong execution block.
- `expected exactly one DepositLocked log`: event query matched multiple logs for the same `txId`.
- `receipt verification failed`: proof generation output failed local verification; check inputs and environment.
