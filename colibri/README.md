# Colibri Stage Verifier (MVP)

This folder contains a minimal JS CLI helper that adds a trustless Colibri verification step to the existing cross-chain E2E flow.

## What It Verifies

For each flow stage, the script verifies through `@corpus-core/colibri-stateless` (proofable RPC calls):

1. `eth_getLogs` for the stage event (`DepositLocked`, `FundsReleased`, `AckReady`)
2. `eth_call` for `Connector.getTx(txId)`

Checks performed:

- the event exists for the given `txId`
- log `address` equals the expected connector
- event `txId` matches
- event `srcChainConnector` and `dstChainConnector` match expected connectors
- `getTx(txId).txId` matches
- `getTx(txId).srcChainConnector` and `.dstChainConnector` match
- `getTx(txId).status` matches expected stage status

## What It Does Not Verify

- It does not generate or verify RISC0 proof payloads on-chain
- It does not replace existing RISC0 proof hosts
- It does not change on-chain proof format or connector contract logic
- It cannot trustlessly verify local dev chains such as `31337/31338` (Anvil/Hardhat local E2E setup)

The existing RISC0 path remains unchanged and is still used for proof generation/submission.

## Install

```bash
cd colibri/ts_folder
npm install
```

## Direct Usage

```bash
node src/verify-connector-stage.mjs \
  --stage source-deposit \
  --chain-id 31337 \
  --connector 0x... \
  --tx-id 0x... \
  --expected-src-connector 0x... \
  --expected-dst-connector 0x... \
  --rpc-urls http://127.0.0.1:8545 \
  --prover-urls http://127.0.0.1:8090
```

Supported stages:

- `source-deposit`
- `destination-funds-released`
- `source-ack-ready`

## E2E Integration

`scripts/e2e-anvil-hardhat.sh` can run this verifier before each RISC0 stage when enabled:

```bash
COLIBRI_VERIFY=1 bash scripts/e2e-anvil-hardhat.sh
```

Optional env vars used by the E2E script:

- `SOURCE_NETWORK_PROFILE`, `DEST_NETWORK_PROFILE`
- `COLIBRI_TS_DIR` (default: `./colibri/ts_folder`)
- `COLIBRI_SOURCE_RPC_URLS` / `COLIBRI_DEST_RPC_URLS`
- `COLIBRI_SOURCE_PROVER_URLS` / `COLIBRI_DEST_PROVER_URLS`
- `COLIBRI_SOURCE_BEACON_URLS` / `COLIBRI_DEST_BEACON_URLS`
- `COLIBRI_SOURCE_CHECKPOINTZ_URLS` / `COLIBRI_DEST_CHECKPOINTZ_URLS`
