# Stateless Client

This package is the TypeScript relay CLI, library, and embedded local agent used to verify relay stages, plan the next required action, generate proof payloads, submit them to the connector contracts, and expose the local HTTP coordinator consumed by the web app.

## Core Capabilities

- verify a single stage with `verify-stage`
- generate and submit a lock proof with `relay-lock`
- generate and submit a mint proof with `relay-mint`
- generate and submit an ack proof with `relay-ack`
- run the full happy path with `relay-happy-path`
- inspect on-chain state and continue from the correct stage with `relay-resume`
- run the local HTTP agent with `agent start`

`relay-resume` is the safest default when the current source and destination statuses are not obvious, because it reads both connectors first and chooses the next valid action.

## Supported Network Profiles

The built-in profile map includes:

- `local-anvil`
- `local-hardhat`
- `mainnet`
- `sepolia`
- `holesky`
- `hoodi`
- `gnosis`
- `chiado`

Profiles define default chain IDs, RPC URLs, and Colibri-related endpoints where applicable.

## Install and Build

From the repository root:

```bash
npm install
npm run build -w stateless-client
```

Or from this directory:

```bash
cd stateless-client
npm install
npm run build
```

## CLI Usage

Show the built-in usage text:

```bash
npm run dev -w stateless-client -- --help
```

Show the agent-specific usage text:

```bash
npm run dev -w stateless-client -- agent
```

Verify a single stage:

```bash
npm run dev -w stateless-client -- verify-stage \
  --stage source-deposit \
  --tx-id 0x... \
  --source-connector 0x... \
  --destination-connector 0x... \
  --source-profile local-anvil \
  --destination-profile local-hardhat
```

Resume the next required stage:

```bash
npm run dev -w stateless-client -- relay-resume \
  --tx-id 0x... \
  --private-key 0x... \
  --proof-backend local \
  --source-connector 0x... \
  --destination-connector 0x... \
  --source-profile local-anvil \
  --destination-profile local-hardhat
```

Run the full happy path from the CLI:

```bash
npm run dev -w stateless-client -- relay-happy-path \
  --tx-id 0x... \
  --private-key 0x... \
  --proof-backend local \
  --source-connector 0x... \
  --destination-connector 0x...
```

Start the embedded agent:

```bash
npm run dev:agent -w stateless-client
```

The canonical production CLI entrypoint is:

```bash
stateless-client agent start
```

## Library Usage

This package also exports relay helpers used internally by the embedded agent, including:

- `prepareStageSubmission(...)`
- `planRelayResume(...)`
- `resolveChainConfig(...)`
- `defaultProofPaths(...)`
- `discoverRepoRoot(...)`

## Tests

```bash
npm run test -w stateless-client
npm run test:integration -w stateless-client
npm run typecheck -w stateless-client
npm run lint -w stateless-client
```

## Related Docs

- [`../README.md`](../README.md)
- [`../zk-proofs/README.md`](../zk-proofs/README.md)
- [`../colibri/README.md`](../colibri/README.md)
