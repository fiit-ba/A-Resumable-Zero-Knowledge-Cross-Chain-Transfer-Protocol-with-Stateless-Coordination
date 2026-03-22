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
- optional: `EXISTING_SOURCE_RISC0_ADAPTER`

Required vars when reusing destination:

- `EXISTING_DEST_CONNECTOR`
- `EXISTING_DEST_TOKEN`
- `EXISTING_DEST_RISC0_ADAPTER`

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
- destination deploy (real `RiscZeroGroth16Verifier` + single `RiscZeroAdapter` allowlisting lock+ack image IDs + `Connector`)
- source deploy (real `RiscZeroGroth16Verifier` + single `RiscZeroAdapter` allowlisting mint image ID + `Connector` + mock token), mint, approve, `depositAndLock`
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

`RiscZeroAdapter` accepts a `bytes32[]` allowlist of image IDs so a single
adapter instance can serve multiple proof routes on the same chain.

Set env vars (zero-valued entries are skipped):

```shell
export RPC_URL=https://your-rpc
export PRIVATE_KEY=0x...
export RISC0_VERIFIER=0x...

# Set only the image IDs used by proofs submitted on this chain.
# Origin chain: set ORIGIN_MINT_IMAGE_ID and/or ORIGIN_BURN_IMAGE_ID.
# Destination chain: set DEST_LOCK_IMAGE_ID, DEST_ACK_IMAGE_ID, and/or DEST_REFUND_CLAIM_IMAGE_ID.
export ORIGIN_MINT_IMAGE_ID=0x...
export DEST_LOCK_IMAGE_ID=0x...
export DEST_ACK_IMAGE_ID=0x...
```

Run:

```shell
forge script script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter \
  --rpc-url "$RPC_URL" \
  --broadcast
```

The script logs the deployed adapter address, the verifier address, and the full allowlist.

## Route-Aware Verifier API

`Connector` stores one verifier adapter per `(route, proofType)` pair using a
two-dimensional mapping:

```
_verifiers[VerifierRoute][ProofType] → adapter address
```

In addition, `Connector` stores the expected RISC Zero guest image ID per route
immutably in `_risc0RouteImageIds[5]`. Before calling the adapter, each proof
submission function checks that the image ID in the proof payload matches the
stored value for that route, reverting with `ImageIdRouteMismatch` on mismatch.

### VerifierRoute enum

| Value | Name                | Proof function              |
|-------|---------------------|-----------------------------|
| 0     | `ORIGIN_MINT`       | `submitMintProof`           |
| 1     | `ORIGIN_BURN`       | `submitBurnProof`           |
| 2     | `DEST_LOCK`         | `submitLockProof`           |
| 3     | `DEST_ACK`          | `submitAckProof`            |
| 4     | `DEST_REFUND_CLAIM` | `submitRefundClaimProof`    |

### ProofType enum

| Value | Name      | Adapter            |
|-------|-----------|--------------------|
| 0     | `RISC0`   | `RiscZeroAdapter`  |
| 1     | `SNARKJS` | `SnarkAdapter`     |

The constructor seeds every route with the same two default adapters (one per
proof type). Route image IDs are set once in the constructor and cannot be
changed — upgrading a guest ELF requires redeploying the Connector.

```solidity
// Read the expected image ID for a route
function getExpectedRisc0ImageId(Enums.VerifierRoute route) external view returns (bytes32);
// Read the adapter for a (route, proofType) pair
function getVerifier(Enums.VerifierRoute route, Enums.ProofType proofType) external view returns (address);
// Admin: replace the adapter for a (route, proofType) pair
function setVerifier(Enums.VerifierRoute route, Enums.ProofType proofType, address verifier) external;
```

## Wiring With Connector

Deploy one `RiscZeroAdapter` per chain with all image IDs used on that chain,
then deploy `Connector` with the adapter addresses and per-route image IDs:

```shell
export RPC_URL=https://your-rpc
export PRIVATE_KEY=0x...
export RISC0_ADAPTER=0x...
export SNARK_ADAPTER=0x...
export ACK_WINDOW_SECONDS=3600

# Set only the image IDs for routes used on this chain; omit or leave as 0x0 for unused routes.
# Origin chain example (submitMintProof only):
export ORIGIN_MINT_IMAGE_ID=0x...

# Destination chain example (submitLockProof + submitAckProof):
export DEST_LOCK_IMAGE_ID=0x...
export DEST_ACK_IMAGE_ID=0x...

forge script script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters \
  --rpc-url "$RPC_URL" \
  --broadcast
```

Route image IDs are immutable after deployment. To update a guest ELF, redeploy
both the `RiscZeroAdapter` (with the new allowlist) and `Connector` (with the
new `risc0RouteImageIds`).

## Refund Flow E2E (Local Anvil → Hardhat)

The refund path lets users recover locked funds when the cross-chain transfer
does not complete within the ack window.

### Full refund flow

```
Origin (Anvil 31337)                   Destination (Hardhat 31338)
─────────────────────────────────────────────────────────────────
depositAndLock ──────────────────────────────────────────────►
                                        submitLockProof (lock proof)
                                        [mint dstToken to dstConnector]
[warp time past ackDeadline]
initiateRefund (emits RefundClaimed) ──────────────────────────►
                                        submitRefundClaimProof (refund-claim proof)
                                        executeBurn (burns dstToken, emits DestTxClosed)
◄────────────────────────────────────────────────────────────
submitBurnProof (burn proof)
[srcToken returned to user]
```

### RISC Zero proof workspaces

| Proof              | Workspace                                    | Proves event       | Committed inputs                     |
|--------------------|----------------------------------------------|--------------------|--------------------------------------|
| Refund claim       | `zk-proofs/risc_zero/refund_claim_event`     | `RefundClaimed`    | `(txId, srcChainConnector, amount)`  |
| Burn               | `zk-proofs/risc_zero/burn_event`             | `DestTxClosed`     | `(txId, dstChainConnector, amount)`  |

### One-command refund E2E

With Anvil (port 8545) and Hardhat (port 8546) running:

```shell
cd /path/to/repo
bash scripts/e2e-refund-anvil-hardhat.sh
```

Key environment variables:

| Variable              | Default            | Description                                       |
|-----------------------|--------------------|---------------------------------------------------|
| `SOURCE_RPC`          | `http://127.0.0.1:8545` | Anvil RPC URL                               |
| `DEST_RPC`            | `http://127.0.0.1:8546` | Hardhat RPC URL                             |
| `PRIVATE_KEY`         | *(required)*       | 32-byte hex private key (or in `.env`)            |
| `ACK_WINDOW_SECONDS`  | `60`               | Short window for local refund testing             |
| `AMOUNT_WEI`          | `1000000000000000000` | Transfer amount (1 token with 18 decimals)     |
| `RISC0_PROVER_MODE`   | `local`            | `local` or `bonsai`                               |
| `RISC0_GUEST_USE_DOCKER` | `1`            | Build RISC Zero guest ELF inside Docker           |

### Generating proofs individually

```bash
# Refund claim proof (run after initiateRefund on origin)
cd zk-proofs/risc_zero/refund_claim_event
RPC_URL=http://127.0.0.1:8545 \
cargo run -p refund-claim-proof-host -- \
  --connector 0xOriginConnector \
  --tx-id 0xTxId \
  --source-chain-id 31337

# Burn proof (run after executeBurn on destination)
cd zk-proofs/risc_zero/burn_event
RPC_URL=http://127.0.0.1:8546 \
cargo run -p burn-proof-host -- \
  --connector 0xDestConnector \
  --tx-id 0xTxId \
  --dest-chain-id 31338
```
