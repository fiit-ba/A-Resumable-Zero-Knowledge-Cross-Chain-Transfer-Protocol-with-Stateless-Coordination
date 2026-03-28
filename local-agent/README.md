# Local Agent

This package runs a local HTTP service that coordinates relay jobs between the browser UI and the stateless relay logic. It persists jobs in SQLite, prepares stage payloads through `stateless-client`, and tracks which relay stage is ready for user signature.

## Responsibilities

- create and resume jobs keyed by `txId`
- store job state in SQLite under `~/.trustless-agent/jobs.db`
- prepare stage payloads for `lock`, `mint`, and `ack`
- expose a polling API for the web app
- record relay receipts so a job can advance to the next stage
- optionally register the `trustless-client://` custom URL scheme on macOS

## Default Runtime Configuration

- host: `127.0.0.1`
- port: `7549`
- default allowed origins: `http://localhost:5173` and `http://localhost:4173`

## Install and Run

From the repository root:

```bash
npm install
npm run build -w shared
npm run dev -w local-agent
```

Or from this directory:

```bash
cd local-agent
npm install
npm run dev
```

## Environment Variables

- `AGENT_PORT`: override the listening port. Default: `7549`.
- `AGENT_ALLOWED_ORIGINS`: comma-separated list of additional allowed origins.

Example:

```bash
AGENT_PORT=7549 \
AGENT_ALLOWED_ORIGINS=http://localhost:5173 \
npm run dev -w local-agent
```

## API Surface

- `GET /health`: health check and version information
- `POST /jobs`: create or resume a relay job for a `txId`
- `GET /jobs`: list known jobs
- `GET /jobs/:id`: fetch current job state
- `POST /jobs/:id/confirm`: start or retry stage preparation
- `GET /jobs/:id/next-stage`: fetch the next enriched stage payload when ready
- `POST /jobs/:id/receipts`: record a browser-submitted relay transaction hash
- `POST /scheme`: macOS custom-scheme forwarding endpoint

## Job Lifecycle

A happy-path job moves through these states:

- `awaiting_confirmation`
- `preparing_stage`
- `ready_for_signature`
- `waiting_for_receipt`
- `completed`

Refund-path states are marked as `unsupported`, which is an intentional stop condition in the current UI-assisted workflow.

## Tests

```bash
npm run test -w local-agent
npm run typecheck -w local-agent
```

## Related Docs

- [`../README.md`](../README.md)
- [`../stateless-client/README.md`](../stateless-client/README.md)
- [`../web-app/README.md`](../web-app/README.md)
