# Smart Contracts

This package contains the Solidity contracts for the cross-chain transfer protocol, together with Foundry scripts and tests.

## Main Components

- `src/connectors/Connector.sol`: origin and destination connector logic for happy-path and refund-path execution.
- `src/libs/`: enums, errors, and proof-output encoders shared by the connector.
- `src/zk-proof/`: verifier interfaces used by proof adapters.
- `script/`: deployment and helper scripts.
- `test/`: Foundry tests.

## Contract Responsibilities

The `Connector` contract handles two flows.

### Happy path

- `depositAndLock` on the origin chain
- `submitLockProof` on the destination chain (mints wrapped destination tokens into connector holding)
- `submitMintProof` on the origin chain
- `submitAckProof` on the destination chain

### Refund path

- `initiateRefund` on the origin chain
- `submitRefundClaimProof` on the destination chain
- `executeBurn` on the destination chain
- `submitBurnProof` on the origin chain

For RISC Zero proofs, the connector also enforces route-specific image IDs through `getExpectedRisc0ImageId(...)` and adapter verification.

## Build and Test

```bash
cd smart-contracts
forge build
forge test
```

Tests are organized under `test/`:

- `test/connector/`: core happy-path and E2E Foundry tests.
- `test/fuzzing/`: property-based fuzzing tests.
- `test/mocks/`: shared mock contracts used by tests.

Run a single test by name:

```bash
forge test --match-test <TestName>
```

## Certora Formal Verification

Formal verification specs live in `certora/`. See [`certora/README.md`](certora/README.md) for design notes.

Run from `smart-contracts/`:

```bash
certoraRun certora/confs/connector-state.conf
certoraRun certora/confs/connector-exclusivity.conf
certoraRun certora/confs/connector-custody.conf
certoraRun certora/confs/connector-smoke.conf
```

## Solidity Linting (Solhint)

```bash
cd smart-contracts
npm install
npm run lint
```

Equivalent Make target:

```bash
cd smart-contracts
make lint-sol
```

## Security Static Analysis (Slither)

Install Slither (recommended via `pipx`):

```bash
pipx install slither-analyzer==0.11.5
```

Alternative (local Python environment):

```bash
cd smart-contracts
python3 -m pip install -r requirements-slither.txt
```

Run analysis:

```bash
cd smart-contracts
make slither
```

Strict mode (non-zero exit on high severity findings):

```bash
cd smart-contracts
make slither-strict
```

## Local Two-Chain Setup

The default local topology in this repository is:

- origin chain: Anvil at `http://127.0.0.1:8545`, chain ID `31337`
- destination chain: Hardhat at `http://127.0.0.1:8546`, chain ID `31338`

The chain IDs must be different. The lock proof includes both chain IDs, and validation fails if both sides use the same value.

## Deploy Production Connectors on Two Networks (Example: Sepolia -> Chiado)

From `smart-contracts/.env`, set at least:

- `PRIVATE_KEY`
- `RPC_URL_SOURCE` and `RPC_URL_DEST`
- `RISC0_ADAPTER_SOURCE` and `SNARK_ADAPTER_SOURCE`
- `RISC0_ADAPTER_DEST` and `SNARK_ADAPTER_DEST`

Then run:

```bash
cd smart-contracts
make deploy-connectors-prod
make addresses
```

`deploy-connectors-prod` deploys both connectors in one command using chain-specific
adapter addresses and route image IDs (`*_SOURCE`, `*_DEST`).

## Run the Happy-Path E2E Script

From the repository root:

```bash
export PRIVATE_KEY=0x...
bash scripts/e2e-happy-path.sh
```

The script deploys the connectors and adapters, executes `depositAndLock`, generates the required proofs, and submits them in order.

Optional flag-based examples:

```bash
# Swap chain roles
bash scripts/e2e-happy-path.sh \
  --source-profile local-hardhat \
  --destination-profile local-anvil \
  --private-key 0x...

# Testnet pair
bash scripts/e2e-happy-path.sh \
  --source-profile sepolia \
  --destination-profile hoodi \
  --private-key 0x...
```

## Run the Refund E2E Script

From the repository root:

```bash
export PRIVATE_KEY=0x...
bash scripts/e2e-refund-path.sh
```

This script exercises the refund branch, including refund-claim and burn proofs.

## Deployment Scripts

- `script/Connector.s.sol`: local helper deployment for demos and tests.
- `script/DeployRiscZeroAdapter.s.sol`: deploys a real `RiscZeroAdapter`.
- `script/DeployConnectorWithAdapters.s.sol`: deploys a connector wired to pre-deployed adapters.
- `script/MintMockERC20.s.sol`: helper for minting the local mock token.

## Environment Notes

- `PRIVATE_KEY` can be exported in the shell or stored in `smart-contracts/.env`.
- `RISC0_GUEST_USE_DOCKER=1` is the default expected path in this repo.
- `REUSE_SOURCE_DEPLOYMENTS=1` and `REUSE_DEST_DEPLOYMENTS=1` let you skip redeployments when you already know the connector and token addresses.

## Related Docs

- [`../README.md`](../README.md)
- [`../zk-proofs/README.md`](../zk-proofs/README.md)
- [`../stateless-client/README.md`](../stateless-client/README.md)
