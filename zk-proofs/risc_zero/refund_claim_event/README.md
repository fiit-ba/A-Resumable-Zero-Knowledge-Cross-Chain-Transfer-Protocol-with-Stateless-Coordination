# RISC Zero Refund Claim Proof

This workspace generates a RISC Zero Groth16 proof for an origin-chain
`RefundClaimed` event emitted by `Connector`.

The committed public inputs are ABI-encoded as:

```solidity
(bytes32 txId, address srcChainConnector, uint256 amount)
```

This matches the commitment expected by `Connector.submitRefundClaimProof(...)` on the
destination chain.

## Quick Start

```bash
cd zk-proofs/risc_zero/refund_claim_event
RPC_URL=http://127.0.0.1:8545 \
EXECUTION_BLOCK=latest \
cargo run -p refund-claim-proof-host -- \
  --connector 0xOriginConnector \
  --tx-id 0xTxId \
  --source-chain-id 31337
```

## Docker Helper

```bash
cd /path/to/repo
PROVER_ACTION=prove \
RPC_URL=http://127.0.0.1:8545 \
CONNECTOR=0xOriginConnector \
TX_ID=0xTxId \
SOURCE_CHAIN_ID=31337 \
bash zk-proofs/risc_zero/refund_claim_event/scripts/prove-refund-claim-docker.sh
```
