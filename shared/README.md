# Shared Package

This package contains the browser-safe DTOs and type definitions shared between `local-agent` and `web-app`.

## What Lives Here

`src/types.ts` defines the shared contract for:

- transfer intents
- relay jobs
- verification summaries
- enriched stage payloads
- agent health responses

Keeping these types in one package prevents the web app and the agent from drifting on JSON payload shape.

## Build

From the repository root:

```bash
npm install
npm run build -w shared
```

Or from this directory:

```bash
cd shared
npm install
npm run build
```

## Typecheck

```bash
npm run typecheck -w shared
```

## Consumers

- `local-agent`
- `web-app`

## Related Docs

- [`../README.md`](../README.md)
- [`../local-agent/README.md`](../local-agent/README.md)
- [`../web-app/README.md`](../web-app/README.md)
