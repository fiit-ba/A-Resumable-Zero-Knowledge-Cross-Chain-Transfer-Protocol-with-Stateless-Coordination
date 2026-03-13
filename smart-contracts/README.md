# Smart Contracts

Contracts for cross-chain flow + proof verification adapters.

## Build and Test

```shell
forge build
forge test
```

## Local Two-Chain Setup (Anvil -> Hardhat)

For your test setup:

- source chain: Anvil (`http://127.0.0.1:8545`, chain id `31337`)
- destination chain: Hardhat (`http://127.0.0.1:8546`, chain id `31338`)

Important:
- Chain IDs must be different. If both are `31337`, the lock proof validation will fail.
- Ensure Hardhat is configured with chain id `31338` in its `hardhat.config`.

You can deploy contracts/scripts to each chain by switching `RPC_URL`:

```shell
# source deployments (Anvil)
export RPC_URL=http://127.0.0.1:8545

# destination deployments (Hardhat)
export RPC_URL=http://127.0.0.1:8546
```

### One-command local E2E

If both nodes are running, execute:

```shell
cd /path/to/repo
bash scripts/e2e-anvil-hardhat.sh
```

Default behavior in this repo:

- host Rust runs locally
- RISC Zero guest build uses Docker via `RISC0_GUEST_USE_DOCKER=1`

To disable RISC Zero guest Docker build:

```shell
cd /path/to/repo
RISC0_GUEST_USE_DOCKER=0 bash scripts/e2e-anvil-hardhat.sh
```

Optional fallback (full proof pipeline in custom Docker wrapper):

```shell
cd /path/to/repo
USE_DOCKER_PROVER=1 bash scripts/e2e-anvil-hardhat.sh
```

This script performs:
- destination deploy (real `RiscZeroGroth16Verifier` + `RiscZeroAdapter` + `Connector`)
- source deploy (real `RiscZeroGroth16Verifier` + `RiscZeroAdapter` + `Connector` + mock token), mint, approve, `depositAndLock`
- lock proof generation via `zk-proofs/risc_zero/lock_event`
- `submitLockProof` on destination
- mint proof generation via `zk-proofs/risc_zero/mint_event`
- `submitMintProof` on source
- ack proof generation via `zk-proofs/risc_zero/ack_event`
- `submitAckProof` on destination

## Deployment Scripts

- `script/Connector.s.sol`
Local helper that deploys mock verifiers + adapters + `Connector`. Useful for tests and local demos only.

- `script/DeployRiscZeroAdapter.s.sol`
Deploys a real `RiscZeroAdapter` for on-chain verification of RISC Zero proofs.

- `script/DeployConnectorWithAdapters.s.sol`
Deploys `Connector` with pre-deployed adapter addresses.

## Deploy RiscZeroAdapter (real verifier)

Set env vars:

```shell
export RPC_URL=https://your-rpc
export PRIVATE_KEY=0x...
export RISC0_VERIFIER=0x...
export RISC0_IMAGE_ID=0x... # from zk-proofs/risc_zero host output: imageId
```

Run:

```shell
forge script script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter \
  --rpc-url "$RPC_URL" \
  --broadcast
```

The script logs:

- deployed adapter address
- verifier address used
- image id used

## Wiring With Connector

`Connector` receives adapter addresses in its constructor and currently has no public setter to change verifiers later.
Deploy real adapters first, then deploy `Connector` with those adapter addresses:

```shell
export RPC_URL=https://your-rpc
export PRIVATE_KEY=0x...
export RISC0_ADAPTER=0x...
export SNARK_ADAPTER=0x...
export ACK_WINDOW_SECONDS=3600

forge script script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters \
  --rpc-url "$RPC_URL" \
  --broadcast
```
