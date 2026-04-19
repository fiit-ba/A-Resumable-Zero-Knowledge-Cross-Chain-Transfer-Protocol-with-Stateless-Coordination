# Smart Contracts Docs

This folder contains package-local reference docs for the deployable Solidity contracts in `smart-contracts/src`.

## Contract References

- [`connector.md`](./connector.md): full lifecycle reference for `Connector.sol`, including verifier management, happy-path flow, refund flow, events, errors, and view getters.
- [`wrapped-token-factory.md`](./wrapped-token-factory.md): route registry for mapping a canonical bridge route to the only wrapped token the destination connector may mint.
- [`bridge-wrapped-token.md`](./bridge-wrapped-token.md): ERC-20 wrapper whose mint and burn rights are fixed to one connector.
- [`verifier-adapters.md`](./verifier-adapters.md): `RiscZeroAdapter` and `SnarkAdapter` reference, including payload formats and commitment rules.
- [`deployment.md`](./deployment.md): deployment prerequisites, environment variables, local bootstrap flow, and production deployment notes.

## Source Files Covered

- `src/connectors/Connector.sol`
- `src/connectors/ConnectorStorage.sol`
- `src/connectors/IConnector.sol`
- `src/tokens/WrappedTokenFactory.sol`
- `src/tokens/BridgeWrappedToken.sol`
- `src/zk-proof/adapters/RiscZeroAdapter.sol`
- `src/zk-proof/adapters/SnarkAdapter.sol`
- `src/libs/Enums.sol`
- `src/libs/Errors.sol`
- `src/libs/ProofOutputs.sol`

## Notes

- These docs describe the current checked-out Solidity implementation, not older protocol writeups.
- `Connector` is the main protocol contract. The other pages document the contracts it depends on at runtime.
- Test harness contracts under `smart-contracts/test/mocks` are intentionally not documented here as production contracts.
