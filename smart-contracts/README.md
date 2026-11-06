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
make install   # fetch forge-std and risc0-ethereum into lib/ (pinned in foundry.lock)
forge build
forge test
```

`lib/` is git-ignored, so run `make install` once after cloning. It is a no-op when the
dependencies are already present. Run `make help` to list every build, analysis, and deployment
target.

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
- destination chain: a second Anvil at `http://127.0.0.1:8546`, chain ID `31338` (profile `local-hardhat`)

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

## Local End-to-End Transfer

The root [README quick start](../README.md#quick-start) walks through a complete local transfer:
`make deploy-all`, `make bootstrap`, a `depositAndLock`, then `stateless-client relay-resume`
for each stage, including the refund path.

The scripts in [`../scripts`](../scripts) run the same flows end to end on two running chains:
they deploy with `make deploy-prod-full`, deposit, and drive every stage with
`stateless-client relay-resume`, then check statuses and balances.

| Script | Flow |
| --- | --- |
| `e2e-happy-path.sh` | lock → mint → ack |
| `e2e-refund-path.sh` | lock, ACK deadline passes, refund-initiate → refund-claim → execute-burn → burn-proof |
| `e2e-non-accept-path.sh` | no lock, ACK deadline passes, refund-initiate → non-accept-proof |

From the repository root:

```bash
anvil --port 8545 --chain-id 31337 &
anvil --port 8546 --chain-id 31338 &
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
scripts/e2e-happy-path.sh --proof-backend test
scripts/e2e-refund-path.sh --proof-backend test --source-finality-delay 3600
scripts/e2e-non-accept-path.sh --proof-backend test --destination-finality-delay 3600
```

`--proof-backend test` needs only Foundry, Node and make: each stage submits a SnarkJS test proof
built from chain data, which the mock SnarkJS verifier of `deploy-prod-full` accepts. With
`--proof-backend local` or `docker` the stages carry real RISC Zero proofs, and the scripts first
build the six guests to deploy with their image IDs. With a finality delay the refund scripts
also check that the connector refuses the refund proof (`FinalityNotReached`) until the delay
has passed. On Linux, `--proof-backend docker` needs the chains to listen beyond localhost
(`anvil --host 0.0.0.0`) so the prover container can reach them.

## Deployment Scripts

- `script/Connector.s.sol`: local helper deployment for demos and tests.
- `script/DeployRiscZeroAdapter.s.sol`: deploys a real `RiscZeroAdapter`.
- `script/DeployConnectorWithAdapters.s.sol`: deploys a connector wired to pre-deployed adapters.
- `script/MintMockERC20.s.sol`: helper for minting the local mock token.

## Environment Notes

- `PRIVATE_KEY` can be exported in the shell or stored in `smart-contracts/.env`.
- `RISC0_GUEST_USE_DOCKER=1` is the default expected path in this repo.
- With `--proof-backend local`, set `RISC0_GUEST_USE_DOCKER=0` for now: the e2e scripts build all six guests for their image IDs, and the non-accept guest does not build in RISC Zero's docker builder yet (its `Cargo.lock` needs rustc 1.91, the builder has 1.88).
- `REUSE_SOURCE_DEPLOYMENTS=1` (or `REUSE_DEST_DEPLOYMENTS=1`) lets the e2e scripts skip the deployment when you already know both connectors, the source token and the wrapped token (`EXISTING_*`).

## Related Docs

- [`../README.md`](../README.md)
- [`../zk-proofs/README.md`](../zk-proofs/README.md)
- [`../stateless-client/README.md`](../stateless-client/README.md)
