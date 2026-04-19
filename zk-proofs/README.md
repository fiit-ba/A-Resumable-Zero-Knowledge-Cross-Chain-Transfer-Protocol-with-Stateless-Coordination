# ZK Proof Workspaces

This directory groups the proof implementations used by the connector relay flows.

## Active Proof Path

The automated scripts in this repository use the RISC Zero workspaces under `zk-proofs/risc_zero/`.

Those workspaces are:

- [`risc_zero/lock_event/README.md`](risc_zero/lock_event/README.md): proves `DepositLocked` for destination-side lock submission.
- [`risc_zero/mint_event/README.md`](risc_zero/mint_event/README.md): proves `FundsReleased` for origin-side mint submission.
- [`risc_zero/ack_event/README.md`](risc_zero/ack_event/README.md): proves `AckReady` for destination-side acknowledgement.
- [`risc_zero/refund_claim_event/README.md`](risc_zero/refund_claim_event/README.md): proves `RefundClaimed` for the refund path.
- [`risc_zero/burn_event/README.md`](risc_zero/burn_event/README.md): proves `DestTxClosed` so the origin side can release refunded funds.
- [`risc_zero/non_accept_event/README.md`](risc_zero/non_accept_event/README.md): proves that a destination connector never accepted a lock (`destinationLockAccepted` is false) after `ackDeadline`, enabling a non-acceptance refund path via `submitNonAcceptanceProof` on the origin.

Each RISC Zero workspace follows the same layout:

- `core/`: shared proof input and validation logic
- `methods/`: the zkVM guest method
- `host/`: the proving CLI used by scripts and the relay client
- `scripts/`: Docker helper wrappers

## Main Script Integration

The repository-level orchestration scripts use these workspaces directly:

- `scripts/e2e-happy-path.sh` — happy-path flow (lock → mint → ack)
- `scripts/e2e-refund-path.sh` — refund flow (lock → refund-initiate → refund-claim → execute-burn → burn-proof)

The stateless relay client also resolves these workspaces when it generates stage payloads.

## Typical Usage

Each workspace README contains a concrete `cargo run` example, but the general pattern is:

```bash
cd zk-proofs/risc_zero/<workspace>
RPC_URL=https://... \
EXECUTION_BLOCK=latest \
cargo run -p <host-package> -- <workspace-specific-args>
```

## Other Trees

`zk-proofs/stark_zkp/` is present as a parallel layout, but the current automated flows in this repository are wired to the RISC Zero path.

## Related Docs

- [`../README.md`](../README.md)
- [`../smart-contracts/README.md`](../smart-contracts/README.md)
- [`../stateless-client/README.md`](../stateless-client/README.md)
