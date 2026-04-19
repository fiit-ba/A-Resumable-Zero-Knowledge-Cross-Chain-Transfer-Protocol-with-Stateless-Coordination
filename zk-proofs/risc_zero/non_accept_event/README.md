# RISC Zero Non-Acceptance Proof

This workspace generates a RISC Zero Groth16 proof that a destination connector
**never accepted** a lock (`destinationLockAccepted(txId)` returns `false`) at a
block after the transfer's `ackDeadline` has passed.

The committed public inputs are ABI-encoded as:

```solidity
(bytes32 txId, address dstChainConnector, uint64 ackDeadline, uint256 sourceChainId, uint256 destinationChainId)
```

This matches the commitment expected by `Connector.submitNonAcceptanceProof(...)` on the
origin chain, which uses this proof to allow a refund when the destination side never
processed the lock.

## Quick Start

```bash
cd zk-proofs/risc_zero/non_accept_event
RPC_URL=http://127.0.0.1:8546 \
EXECUTION_BLOCK=latest \
cargo run -p non-accept-proof-host -- \
  --connector 0xDestConnector \
  --tx-id 0xTxId \
  --ack-deadline <unix-seconds> \
  --source-chain-id 31337 \
  --dest-chain-id 31338
```

## Docker Helper

```bash
cd /path/to/repo
PROVER_ACTION=prove \
RPC_URL=http://127.0.0.1:8546 \
CONNECTOR=0xDestConnector \
TX_ID=0xTxId \
ACK_DEADLINE=<unix-seconds> \
SOURCE_CHAIN_ID=31337 \
DEST_CHAIN_ID=31338 \
bash zk-proofs/risc_zero/non_accept_event/scripts/prove-non-accept-docker.sh
```

## Validation Rules

The guest enforces two conditions before committing the journal:

1. `destinationLockAccepted(txId)` must return `false` on the destination connector at the execution block.
2. The execution block timestamp must be **after** `ackDeadline`. Proving before the deadline is rejected with `TooEarly`.

If either condition fails, the proof is not generated and the host exits with an error.
