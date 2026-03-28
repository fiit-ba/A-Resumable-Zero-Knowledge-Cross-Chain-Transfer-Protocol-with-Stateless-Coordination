# Web App

This package contains the operator-facing React application for starting a transfer, tracking relay progress, and submitting each prepared relay transaction from a browser wallet.

## What the App Does

- collects the transfer input and selected source/destination network profiles
- sends `depositAndLock` through the connected wallet
- registers the resulting `txId` with the local agent
- polls the local agent for the next prepared stage
- asks the wallet to submit the stage transaction on the correct chain
- records relay receipts back to the agent so the job can advance

The app has two primary routes:

- `/`: transfer form
- `/progress/:jobId`: job progress and per-stage submission UI

## Prerequisites

- the local agent running on `http://localhost:7549`, or `VITE_AGENT_URL` pointing elsewhere
- a browser wallet that supports EIP-1193, such as MetaMask
- access to the configured source and destination networks

## Install and Run

From the repository root:

```bash
npm install
npm run build -w shared
npm run dev -w web-app
```

Or from this directory:

```bash
cd web-app
npm install
npm run dev
```

The Vite dev server starts on its default port unless configured otherwise.

## Environment

Set a custom agent URL when needed:

```bash
VITE_AGENT_URL=http://localhost:7549 npm run dev -w web-app
```

By default the app uses `http://localhost:7549`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run preview
npm run test
```

## Network Profiles Exposed in the UI

The app currently exposes these profiles:

- `local-anvil`
- `local-hardhat`
- `sepolia`
- `holesky`
- `hoodi`
- `gnosis`
- `chiado`

The profile metadata lives in `src/lib/networks.ts`.

## Testing

The package uses Vitest and Testing Library for UI and agent-integration tests.

```bash
npm run test -w web-app
```

## Related Docs

- [`../README.md`](../README.md)
- [`../local-agent/README.md`](../local-agent/README.md)
- [`../shared/README.md`](../shared/README.md)
