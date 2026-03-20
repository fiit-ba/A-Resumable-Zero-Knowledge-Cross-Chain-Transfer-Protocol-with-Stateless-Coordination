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

### Run Against Other Networks

The same script now supports per-side network profiles:

- `local-anvil`
- `local-hardhat`
- `mainnet`
- `sepolia`
- `holesky`
- `hoodi`
- `gnosis`
- `chiado`

Defaults remain:

- source: `local-anvil`
- destination: `local-hardhat`

Example using public testnet profiles:

```shell
cd /path/to/repo
SOURCE_NETWORK_PROFILE=sepolia \
DEST_NETWORK_PROFILE=hoodi \
COLIBRI_VERIFY=0 \
PRIVATE_KEY=0x... \
bash scripts/e2e-anvil-hardhat.sh
```

You can still override explicitly with `SOURCE_RPC`, `DEST_RPC`, `SOURCE_CHAIN_ID`, `DEST_CHAIN_ID`.

Note:

- For `holesky` and `hoodi`, the script sets RPC/beacon defaults only.
- If you run with `COLIBRI_VERIFY=1`, provide `COLIBRI_SOURCE_PROVER_URLS` / `COLIBRI_DEST_PROVER_URLS` (or rely on local proof generation).
- `hoodi` defaults use `https://ethereum-hoodi-rpc.publicnode.com` and `https://ethereum-hoodi-beacon-api.publicnode.com`.

### Reuse Existing Deployments (save gas)

To avoid redeploying contracts every run:

- set `REUSE_SOURCE_DEPLOYMENTS=1` and/or `REUSE_DEST_DEPLOYMENTS=1`
- pass already deployed addresses via env vars

Required vars when reusing source:

- `EXISTING_SOURCE_CONNECTOR`
- `EXISTING_SOURCE_TOKEN`
- optional: `EXISTING_SOURCE_MINT_RISC0_ADAPTER` (if you want script to force source verifier to this adapter)

Required vars when reusing destination:

- `EXISTING_DEST_CONNECTOR`
- `EXISTING_DEST_TOKEN`
- `EXISTING_DEST_LOCK_RISC0_ADAPTER`
- `EXISTING_DEST_ACK_RISC0_ADAPTER`

The script now computes `txId` using current `txNonce()` from source connector, so repeated runs with reused deployments stay consistent.

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

### Optional Colibri Trustless Verification (MVP)

An optional Colibri step is integrated into `scripts/e2e-anvil-hardhat.sh` and can run before each RISC0 proof stage.

Colibri support is chain-dependent in the installed `@corpus-core/colibri-stateless` package.
If a profile is not proofable for `eth_getLogs`/`eth_call`, the script exits early with a clear unsupported-chain message.

What Colibri verifies:

- Source: `DepositLocked` (`eth_getLogs`) + `getTx(txId)` (`eth_call`)
- Destination: `FundsReleased` (`eth_getLogs`) + `getTx(txId)` (`eth_call`)
- Source: `AckReady` (`eth_getLogs`) + `getTx(txId)` (`eth_call`)

Colibri checks:

- event existence for the target `txId`
- event `txId` and connector addresses (`srcChainConnector`, `dstChainConnector`)
- log `address` equals the expected connector
- `getTx(txId)` exists and its `status` matches stage (`1`, `4`, `2`)

What Colibri does not do in this repo:

- no replacement of RISC0 proof hosts
- no change to on-chain proof payload format
- no change to connector proof submission path
- no trustless verification on local dev chain IDs (`31337`/`31338`)

Install helper dependencies:

```shell
cd colibri/ts_folder
npm install
```

Run E2E with Colibri enabled:

```shell
cd /path/to/repo
COLIBRI_VERIFY=1 bash scripts/e2e-anvil-hardhat.sh
```

Useful env vars:

- `SOURCE_NETWORK_PROFILE`, `DEST_NETWORK_PROFILE`
- `COLIBRI_TS_DIR` (default: `./colibri/ts_folder`)
- `COLIBRI_SOURCE_RPC_URLS`, `COLIBRI_DEST_RPC_URLS`
- `COLIBRI_SOURCE_PROVER_URLS`, `COLIBRI_DEST_PROVER_URLS`
- `COLIBRI_SOURCE_BEACON_URLS`, `COLIBRI_DEST_BEACON_URLS`
- `COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL` (default `https://rpc-gbc.chiadochain.net`; auto-prepended for Chiado when PublicNode beacon returns unsigned-parent-root style errors)
- For Chiado prover `cannot sync backwards` errors, the script now automatically retries with range `[eventBlock,latest]`, then retries without `COLIBRI_DEST_PROVER_URLS` for that stage.
- `COLIBRI_SOURCE_CHECKPOINTZ_URLS`, `COLIBRI_DEST_CHECKPOINTZ_URLS`
- `COLIBRI_LOG_LOOKBACK_BLOCKS` (default `50000`; Chiado is auto-capped to `10000` because many providers enforce that `eth_getLogs` limit)
- `COLIBRI_VERIFY_RETRIES` (default `6`) and `COLIBRI_VERIFY_RETRY_DELAY_SEC` (default `12`) for transient Colibri timing/bootstrap retries (`parentBeaconBlockRoot`, unsigned block, SSZ bootstrap parse)
- stage toggles: `COLIBRI_VERIFY_SOURCE_DEPOSIT`, `COLIBRI_VERIFY_DEST_FUNDS_RELEASED`, `COLIBRI_VERIFY_SOURCE_ACK_READY` (each default `1`)
- `COLIBRI_RESET_STATE_ON_SYNC_BACKWARDS` (default `1`): on Chiado `cannot sync backwards`, the script removes local Colibri state files (`states_<chainId>`) once and retries.
- `LOCK_EXECUTION_BLOCK`, `MINT_EXECUTION_BLOCK`, `ACK_EXECUTION_BLOCK` (optional overrides; by default the script now auto-pins each proof host to the exact tx receipt block for that stage event)

RISC Zero note:

- If your machine has `rzup` components installed but `r0vm` is not symlinked into `PATH`, the script auto-detects `~/.risc0/extensions/*/r0vm` and exports it to avoid slow ImageID fallback.

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
