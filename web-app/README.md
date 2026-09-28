# web-app

Operator UI for the cross-chain transfer protocol. It starts a transfer from your wallet, tracks
each relay stage through the local [stateless-client agent](../stateless-client/README.md), and
asks the wallet to sign every prepared stage on the correct chain.

## What it does

1. Sends `depositAndLock` on the source chain, approving the token first if needed.
2. Registers the resulting `txId` with the local agent.
3. Polls the agent while it verifies and proves the next stage.
4. Runs on-chain preflight checks (status, ACK window, liquidity, RISC Zero image ID), then asks
   the wallet to switch chains and submit.
5. Reports the receipt back so the agent can plan the next stage, until the transfer completes
   or is refunded.

| Route | Page |
| --- | --- |
| `/` | Transfer form, active jobs, and developer recovery by `txId` |
| `/progress/:jobId` | Stage progress with auto and manual relay modes |

## Run

Requires the local agent (`npm run dev:agent` in `stateless-client/`) and an EIP-1193 wallet
such as MetaMask.

```bash
cd web-app
npm ci
npm run dev           # http://localhost:5173
```

The app talks to `http://localhost:7549` by default. Point it elsewhere with:

```bash
VITE_AGENT_URL=http://localhost:7549 npm run dev
```

The network picker offers the public profiles `sepolia`, `holesky`, `hoodi`, `gnosis` and
`chiado`. Their metadata lives in `src/lib/networks.ts`. Local chains are driven through the CLI
and E2E scripts instead.

## Scripts

```bash
npm run dev            # Vite dev server
npm run build          # type-check and production build
npm run preview        # serve the production build
npm test               # Vitest + Testing Library
npm run lint
npm run typecheck
npm run format:check
```

## Project structure

| Path | Contents |
| --- | --- |
| `src/pages/` | Route-level pages: data fetching, handlers, and layout |
| `src/features/job-progress/` | Progress-page components and the active-job slice |
| `src/features/transfer-start/` | Deposit flow, recovery and active-job panels, and the draft slice |
| `src/components/` | Shared UI primitives (`Alert`, `Card`, `InfoRow`), `NetworkPicker`, class helpers |
| `src/lib/` | Framework-free logic: stage metadata, protocol status, stage submission and preflight, wallet helpers, contract error decoding |
| `src/api/` | RTK Query client for the agent, plus types mirroring `stateless-client/src/agent/contracts.ts` |
