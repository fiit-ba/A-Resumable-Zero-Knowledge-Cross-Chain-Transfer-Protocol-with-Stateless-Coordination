# RISC Zero Ack Proof

This workspace generates a RISC Zero Groth16 proof for an origin-chain
`AckReady` event emitted by `Connector`.

The committed public inputs are ABI-encoded as:

```solidity
(bytes32 txId, address srcChainConnector, address dstChainConnector)
```

This matches the commitment expected by `Connector.submitAckProof(...)` on the
destination chain.

## Quick Start

```bash
cd zk-proofs/risc_zero/ack_event
RPC_URL=http://127.0.0.1:8545 \
EXECUTION_BLOCK=latest \
cargo run -p ack-proof-host -- \
  --connector 0xSourceConnector \
  --tx-id 0xTxId \
  --source-chain-id 31337
```

## Docker Helper

```bash
cd /path/to/repo
PROVER_ACTION=prove \
RPC_URL=http://127.0.0.1:8545 \
CONNECTOR=0xSourceConnector \
TX_ID=0xTxId \
SOURCE_CHAIN_ID=31337 \
bash zk-proofs/risc_zero/ack_event/scripts/prove-ack-docker.sh
```
