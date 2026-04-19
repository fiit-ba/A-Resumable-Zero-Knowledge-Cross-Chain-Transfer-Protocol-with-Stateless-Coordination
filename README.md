# Trustless Universal Protocol for Interoperable Chains Based on Stateless Clients

This repository contains a cross-chain transfer prototype built around stateless verification. The core flow combines:

- Solidity `Connector` contracts for origin and destination chains
- RISC Zero proof workspaces for event proving
- an optional Colibri verification step for proofable chains
- a TypeScript stateless relay CLI with an embedded local coordination agent
- a React web app for operator-assisted submissions

## Flow Overview

### Happy path

1. The origin connector locks funds with `depositAndLock`, emitting `DepositLocked`.
2. A lock proof is generated from the origin event and submitted on the destination with `submitLockProof`, which mints wrapped destination tokens into connector custody and emits `FundsReleased`.
3. A mint proof is generated from the destination event and submitted back on the origin with `submitMintProof`, emitting `AckReady`.
4. An ack proof is generated from the origin event and submitted on the destination with `submitAckProof`, which releases the destination-side tokens to the receiver.

### Refund path

1. If the acknowledgement window expires, the origin can call `initiateRefund`, emitting `RefundClaimed`.
2. A refund-claim proof is submitted on the destination.
3. The destination burns its held wrapped tokens with `executeBurn`, emitting `DestTxClosed`.
4. A burn proof is submitted on the origin to release the originally locked funds back to the sender.

## Repository Layout

- [`smart-contracts/README.md`](smart-contracts/README.md): Solidity contracts, Foundry tests, and deployment scripts.
- [`zk-proofs/README.md`](zk-proofs/README.md): proof workspaces used by the relay flows.
- [`stateless-client/README.md`](stateless-client/README.md): TypeScript relay CLI, library, and embedded local HTTP agent.
- [`web-app/README.md`](web-app/README.md): React UI for starting transfers and signing relay submissions.
- [`smart-contracts/certora/README.md`](smart-contracts/certora/README.md): Certora formal verification rules for connector safety.
- `scripts/`: end-to-end orchestration scripts for happy path and refund path.

## Prerequisites

- Node.js and npm
- Rust and Cargo
- Foundry (`anvil`, `forge`, `cast`)
- Docker for the default guest build path and optional prover wrappers
- A funded private key for any non-local deployment or scripted submission flow

## Installation

Install the workspace packages from the repository root:

```bash
npm install
```

Install the standalone helper packages when you use them:

```bash
cd colibri && npm install
cd ../hardhat-local && npm install
```

Foundry dependencies are vendored under `smart-contracts/lib`, so `forge install` is usually not required unless you intentionally refresh them.

## Common Workflows

### Run the local happy-path E2E flow

Start the two local chains in separate terminals:

```bash
anvil --chain-id 31337
```

```bash
cd hardhat-local
npm run start
```

Then run the orchestrated flow from the repository root:

```bash
export PRIVATE_KEY=0x...
bash scripts/e2e-happy-path.sh
```

To select different networks, pass `--source-profile` and `--destination-profile`:

```bash
bash scripts/e2e-happy-path.sh \
  --source-profile local-hardhat \
  --destination-profile local-anvil
```

### Run the local refund E2E flow

With the same local chains running:

```bash
export PRIVATE_KEY=0x...
bash scripts/e2e-refund-path.sh
```

Reverse the chain roles:

```bash
bash scripts/e2e-refund-path.sh \
  --source-profile local-hardhat \
  --destination-profile local-anvil
```

### Run the web app and local agent flow

In separate terminals from the repository root:

```bash
npm run dev:agent -w stateless-client
```

```bash
npm run dev -w web-app
```

The agent listens on `http://localhost:7549` by default, and the web app targets that same URL unless `VITE_AGENT_URL` is set. The canonical CLI surface is `stateless-client agent start`.

### Run Certora formal verification

From `smart-contracts/` directory:

```bash
certoraRun certora/confs/connector-state.conf
certoraRun certora/confs/connector-exclusivity.conf
certoraRun certora/confs/connector-custody.conf
certoraRun certora/confs/connector-smoke.conf
```

## Root Workspace Commands

```bash
npm run build
npm run test
npm run lint
npm run typecheck
```

These are the scripts exposed by the root `package.json`. Coverage varies by script: `build` includes the three active workspaces, while `test`, `lint`, and `typecheck` only run the workspace commands explicitly configured there.

## Notes

- The local happy-path setup assumes Anvil on chain ID `31337` and Hardhat on chain ID `31338`.
- The automated scripts can optionally call the Colibri verifier, but local dev chains are not trustlessly proofable through Colibri.
- The proof workspaces and the Solidity contracts must stay aligned on route-specific RISC Zero image IDs.
