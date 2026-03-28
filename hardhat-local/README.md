# Hardhat Local

This package provides the local Hardhat-based destination chain used by the repository's default two-chain development setup.

## Default Role in This Repo

- runs a simulated L1-style Hardhat network on port `8546`
- uses chain ID `31338`
- serves as the destination chain while Anvil runs as the origin chain on `31337`

## Start the Destination Chain

```bash
cd hardhat-local
npm install
npm run start
```

That starts:

```bash
hardhat node --network localDest --port 8546
```

## `eth_getBlockReceipts` Proxy

The refund proving path needs `eth_getBlockReceipts`, which Hardhat does not implement. This package includes `proxy.mjs`, a lightweight JSON-RPC proxy that synthesizes `eth_getBlockReceipts` by fetching the block and then all individual transaction receipts.

Start it with:

```bash
cd hardhat-local
node proxy.mjs
```

Optional environment variables:

- `HARDHAT_INNER_PORT`: upstream Hardhat port. Default: `8546`.
- `PROXY_PORT`: proxy listen port. Default: `18546`.

## Testing the Proxy

```bash
cd hardhat-local
node test-proxy.mjs
```

## Related Docs

- [`../README.md`](../README.md)
- [`../smart-contracts/README.md`](../smart-contracts/README.md)
- [`../zk-proofs/README.md`](../zk-proofs/README.md)
