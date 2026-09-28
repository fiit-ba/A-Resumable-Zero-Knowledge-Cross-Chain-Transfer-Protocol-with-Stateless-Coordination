# stateless-client

TypeScript library, CLI, and local HTTP agent that coordinate cross-chain transfers without
keeping authoritative state. For each relay stage it:

1. **plans**: reads both connectors and picks the next valid action;
2. **verifies**: checks the triggering event and `getTx` state through Colibri stateless proofs,
   falling back to plain RPC on local chains and known Chiado outages;
3. **proves**: runs the matching RISC Zero proof host, locally or in Docker;
4. **submits**: signs with a local key (CLI), or hands an unsigned payload to a browser wallet
   (agent).

## Install

```bash
cd stateless-client
npm ci
npm run build       # emits dist/, including the `stateless-client` bin
```

## CLI

```bash
npx tsx src/cli.ts --help          # or: node dist/cli.js --help after building
```

| Command | What it does |
| --- | --- |
| `relay-resume` | Reads both chains and runs whichever stage is due. **Start here when unsure.** |
| `relay-happy-path` | Runs lock → mint → ack in sequence |
| `relay-lock`, `relay-mint`, `relay-ack` | Runs one happy-path stage |
| `relay-non-accept-proof` | Refunds a transfer whose lock was never accepted on the destination |
| `verify-stage --stage <stage>` | Verifies one on-chain checkpoint without proving or submitting |
| `agent start` | Starts the local HTTP agent used by the web app |

Relay commands share one set of options:

```bash
npx tsx src/cli.ts relay-resume \
  --tx-id 0x… \
  --private-key 0x… \
  --proof-backend local \
  --source-connector 0x… --destination-connector 0x… \
  --source-profile local-anvil --destination-profile local-hardhat
```

- **Networks:** `--source-profile` / `--destination-profile` select a built-in profile:
  `local-anvil`, `local-hardhat`, `mainnet`, `sepolia`, `holesky`, `hoodi`, `gnosis` or
  `chiado`. Override any part of a profile with `--<side>-rpc-url`, `--<side>-chain-id`,
  `--<side>-prover-urls`, and similar options.
- **Execution blocks:** `--execution-block` pins every proof to one block. Per-stage variants
  such as `--lock-execution-block` take precedence.
- **Proof paths:** by default these are discovered from the repository root. Override them with
  `--repo-root` or per-workspace `--<stage>-workspace` / `--<stage>-docker-script`.

`--help` prints the full, generated option list.

## Local agent

```bash
npm run dev:agent      # development (tsx)
npm run start:agent    # after npm run build
```

The agent listens on `http://127.0.0.1:7549` and stores jobs in `~/.trustless-agent/jobs.db`.
It exposes a small REST API:

| Method and path | Purpose |
| --- | --- |
| `POST /jobs` | Register a transfer by `txId` and intent |
| `POST /jobs/:id/confirm` | Plan and prepare the next stage (auto mode) |
| `POST /jobs/:id/prepare` | Prepare a specific stage, optionally `force` or `regenerate` (manual mode) |
| `GET /jobs/:id/stages/current`, `GET /jobs/:id/stages/:stage` | Prepared payload and checkpoint details |
| `POST /jobs/:id/receipts` | Record a submitted transaction and advance the job |
| `POST /jobs/recover` | Rebuild a job from a `txId` by scanning every supported network |
| `PATCH /jobs/:id/settings` | Switch between `auto` and `manual` relay mode |

## Library

```ts
import { planRelayResume, prepareStageSubmission, resolveChainConfig } from "stateless-client";
```

Public exports include `planRelayResume` and `computeResumeDecision` (planning),
`prepareStageSubmission` (verify, prove, and build an unsigned payload), `runRelayStage` and the
`runRelay*` helpers (sign and submit), `verifyStage`, `discoverTransferByTxId`,
`resolveChainConfig`, `defaultProofPaths`, `discoverRepoRoot`, and the stage registry
`RELAY_STAGE_REGISTRY`.

## Configuration

Environment variables are read from the process or from `stateless-client/.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_PORT` | `7549` | Agent listen port |
| `AGENT_ALLOWED_ORIGINS` | none | Extra CORS origins, comma-separated. The Vite dev and preview origins are always allowed. |
| `STATELESS_CLIENT_PROOF_BACKEND` | `local` | Agent proof backend: `local` or `docker` |
| `STATELESS_CLIENT_RISC0_PROVER_MODE` | auto | `local` or `bonsai`. Defaults to Bonsai for non-local chains when `BONSAI_API_URL` and `BONSAI_API_KEY` are set. |
| `STATELESS_CLIENT_PROOF_TIMEOUT_SEC` | `1800` | Kill a proof host that runs longer than this |
| `RISC0_VM`, `RISC0_HOME` | auto-detected | Location of `r0vm` |
| `STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS` | `50000` | Log window used when a stage has no explicit block |
| `STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRIES` | `6` | Retries for transient Colibri errors |
| `STATELESS_CLIENT_COLIBRI_TRANSIENT_RETRY_DELAY_SEC` | `12` | Delay between those retries |
| `STATELESS_CLIENT_COLIBRI_CACHE_DIR` | `./.colibri-cache` | Colibri sync-state cache |
| `STATELESS_CLIENT_RESET_STATE_ON_SYNC_BACKWARDS` | `true` | Wipe cached sync state when Colibri reports "sync backwards" |
| `STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK` | `true` | Allow RPC fallback for known Chiado Colibri issues |
| `STATELESS_CLIENT_COLIBRI_IMPL` | `current` | Set to `dev` to use an upstream Colibri build. Install `@corpus-core/colibri-stateless-dev` yourself first, for example with `npm link`, because it is not published to npm. |

## Development

```bash
npm test                  # unit + agent tests (Vitest)
npm run test:integration  # requires the local two-chain setup
npm run typecheck
npm run lint
npm run format:check
```

Source layout:

| Path | Contents |
| --- | --- |
| `src/relay/` | Planner, stage registry, verification, proof runner, relay execution |
| `src/agent/` | HTTP server, job service, SQLite persistence |
| `src/config/` | Network profiles, CLI option resolution, `.env` loading |
| `src/colibri/` | Colibri backend adapter |
| `src/contracts/` | Connector ABI |
