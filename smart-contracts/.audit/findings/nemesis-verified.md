# Nemesis Audit — Verified Findings

**Audit date:** 2026-05-06  
**Auditor:** Nemesis iterative (Feynman × State Inconsistency, 4 passes)  
**Scope:** `smart-contracts/src/`  
**Discovery method:** Cross-feed State P2 → Feynman P3 (parallel-path mismatch confirmed by root-cause trace)

---

## Summary

| ID     | Severity | Title                                            | File                           |
| ------ | -------- | ------------------------------------------------ | ------------------------------ |
| NM-001 | INFO     | `_risc0RouteImageIds` has no post-deploy updater | `src/connectors/Connector.sol` |

---

## NM-001 · INFO — `_risc0RouteImageIds` has no post-deploy updater

### Description

`_risc0RouteImageIds[6]` is set once in the `Connector` constructor and has no setter function. Upgrading a ZK guest binary (e.g., patching a bug in a RISC Zero proof circuit) requires redeploying the entire Connector contract.

### Impact

Operational risk only — not exploitable. A stale image ID causes proof submissions to revert, halting new transfers on the affected route until the contract is redeployed.

### Recommendation

Consider adding a timelocked `proposeImageId` / `applyImageId` admin function mirroring the verifier update pattern, so guest binary upgrades don't require a full redeploy.

### Severity Rationale

**INFORMATIONAL.** No direct exploitability. Raises protocol availability concerns on guest binary upgrades.

---
