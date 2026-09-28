# zk-proofs

RISC Zero programs that prove facts about one chain so the connector on the other chain can act
on them. Each guest uses [Steel](https://github.com/boundless-xyz/steel) to read EVM events or
storage at a specific block, and emits a journal the connector checks against its own transfer
record.

## Proof workspaces

| Workspace | Proves | Read on | Submitted via |
| --- | --- | --- | --- |
| [`lock_event`](risc_zero/lock_event/README.md) | `DepositLocked` | origin | `submitLockProof` on the destination |
| [`mint_event`](risc_zero/mint_event/README.md) | `FundsReleased` | destination | `submitMintProof` on the origin |
| [`ack_event`](risc_zero/ack_event/README.md) | `AckReady` | origin | `submitAckProof` on the destination |
| [`refund_claim_event`](risc_zero/refund_claim_event/README.md) | `RefundClaimed` | origin | `submitRefundClaimProof` on the destination |
| [`burn_event`](risc_zero/burn_event/README.md) | `DestTxClosed` | destination | `submitBurnProof` on the origin |
| [`non_accept_event`](risc_zero/non_accept_event/README.md) | `destinationLockAccepted[txId] == false` after `ackDeadline` | destination | `submitNonAcceptanceProof` on the origin |

Every workspace has the same layout:

| Path | Contents |
| --- | --- |
| `core/` | Input and journal types plus validation shared by host and guest |
| `methods/guest/` | The zkVM guest program |
| `host/` | Proving CLI (`<stage>-proof-host`) and `print_image_id` |
| `scripts/prove-<stage>-docker.sh` | Runs the host inside the shared prover image |

> [!IMPORTANT]
> Connectors pin a RISC Zero image ID per route. Any change to guest code changes its image ID,
> so redeploy the connector (or its adapters) with the new IDs. Use `print_image_id` or
> `PROVER_ACTION=print-image-id` to read them.

## Running a proof

You normally don't run these by hand. The [stateless-client](../stateless-client/README.md)
picks the right workspace, block, and arguments for each stage.

Every workspace depends on `risc0-ethereum` from `smart-contracts/lib` by path, so run
`make install` in [`smart-contracts/`](../smart-contracts) once before building any of them,
locally or in Docker.

To run one directly with a local RISC Zero toolchain:

```bash
cd zk-proofs/risc_zero/lock_event
RPC_URL=http://127.0.0.1:8545 EXECUTION_BLOCK=latest \
cargo run -p lock-proof-host --bin lock-proof-host -- \
  --connector 0x… --tx-id 0x… --source-chain-id 31337 --destination-chain-id 31338
```

Or without installing the toolchain, inside Docker:

```bash
RPC_URL=http://127.0.0.1:8545 CONNECTOR=0x… TX_ID=0x… \
SOURCE_CHAIN_ID=31337 DEST_CHAIN_ID=31338 \
bash zk-proofs/risc_zero/lock_event/scripts/prove-lock-docker.sh
```

The per-workspace READMEs list each host's exact inputs.

### Docker prover

All six wrappers delegate to [`risc_zero/scripts/docker-prover.sh`](risc_zero/scripts/docker-prover.sh)
and build from one shared [`risc_zero/Dockerfile.prover`](risc_zero/Dockerfile.prover). The image
is built on first use (`linux/amd64`, the platform `rzup` supports) and cached, along with a
per-stage cargo cache volume. The repository root is mounted read-only at `/workspace`, so the
container sees `smart-contracts/lib` too. `localhost` RPC URLs are rewritten to `host.docker.internal`
automatically. See the header of `docker-prover.sh` for every tunable (`DOCKER_IMAGE`,
`DOCKER_REBUILD`, `DOCKER_PLATFORM`, `RISC0_PROVER_MODE`, and more).

To prove remotely on Bonsai instead of the local CPU, use the local toolchain with
`RISC0_PROVER=bonsai`, `BONSAI_API_URL` and `BONSAI_API_KEY`. The Docker wrapper does not
forward Bonsai credentials into the container.
