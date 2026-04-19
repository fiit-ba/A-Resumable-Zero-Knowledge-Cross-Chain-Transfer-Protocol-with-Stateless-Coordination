# Connector Certora v1

This folder contains focused Certora assets for Connector lifecycle safety:

- `specs/ConnectorState.spec`
- `specs/ConnectorExclusivity.spec`
- `specs/ConnectorCustody.spec`
- `specs/ConnectorRouteBinding.spec`
- `specs/ConnectorSmoke.spec`
- `confs/*.conf` (one conf per focused spec + one combined smoke conf)
- `harness/` Solidity-only verification harnesses

## Design Notes

- Verification target is `ConnectorCertoraHarness`, which **inherits `Connector` unchanged** and only adds scene helpers/getters.
- Real collaborators are used in-scene: `WrappedTokenFactory`, `BridgeWrappedToken`, `SnarkAdapter`, `RiscZeroAdapter`, and mock verifier backends.
- `ProofPayloadBuilder.sol` mirrors proof payload encodings used by `test/Connector.t.sol`.
- No production contract storage/ABI was modified.
- No `DISPATCHER`/`HAVOC_*` summaries are used for Connector or core collaborators.

## Run

From `smart-contracts/`:

```bash
certoraRun certora/confs/connector-state.conf
certoraRun certora/confs/connector-exclusivity.conf
certoraRun certora/confs/connector-custody.conf
certoraRun certora/confs/connector-smoke.conf
```

Each spec starts with `use builtin rule sanity;` and conf files enable `multi_assert_check`.
Confs pin `solc_via_ir: true`, which is required to avoid stack-too-deep in `submitLockProof`. `solc_optimize` is intentionally omitted due current Certora CLI/solc Yul-optimizer compatibility issues on this setup.
Confs also enable `optimistic_hashing` with `hashing_length_bound: 4096` so sanity checks can reason about unbounded `bytes` proof payload arguments on Connector proof methods.
