# RISC Zero Mint Proof

This workspace generates a RISC Zero Groth16 proof for a destination-chain
`FundsReleased` event emitted by `Connector`.

The committed public inputs are ABI-encoded as:

```solidity
(bytes32 txId, address dstChainConnector, uint256 amount, address receiver)
```

This matches the commitment expected by `Connector.submitMintProof(...)` on the
origin chain.

## Quick Start

```bash
cd zk-proofs/risc_zero/mint_event
RPC_URL=http://127.0.0.1:8546 \
EXECUTION_BLOCK=latest \
cargo run -p mint-proof-host -- \
  --connector 0xDestinationConnector \
  --tx-id 0xTxId \
  --destination-chain-id 31338
```

## Docker Helper

```bash
cd /path/to/repo
PROVER_ACTION=prove \
RPC_URL=http://127.0.0.1:8546 \
CONNECTOR=0xDestinationConnector \
TX_ID=0xTxId \
DESTINATION_CHAIN_ID=31338 \
bash zk-proofs/risc_zero/mint_event/scripts/prove-mint-docker.sh
```
