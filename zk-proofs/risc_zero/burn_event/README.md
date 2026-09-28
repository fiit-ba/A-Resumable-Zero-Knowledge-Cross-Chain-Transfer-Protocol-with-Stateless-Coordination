# RISC Zero Burn Proof

This workspace generates a RISC Zero Groth16 proof for a destination-chain
`DestTxClosed` event emitted by `Connector` when `executeBurn` is called after
a refund claim is accepted.

The committed public inputs are ABI-encoded as:

```solidity
(bytes32 txId, address dstChainConnector, uint256 amount, uint256 sourceChainId, uint256 destinationChainId)
```

This matches the commitment expected by `Connector.submitBurnProof(...)` on the
origin chain, which uses this proof to release the locked funds back to the user.

## Quick Start

```bash
cd zk-proofs/risc_zero/burn_event
RPC_URL=http://127.0.0.1:8546 \
EXECUTION_BLOCK=latest \
cargo run -p burn-proof-host -- \
  --connector 0xDestConnector \
  --tx-id 0xTxId \
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
SOURCE_CHAIN_ID=31337 \
DEST_CHAIN_ID=31338 \
bash zk-proofs/risc_zero/burn_event/scripts/prove-burn-docker.sh
```
