// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ConnectorPreconditions} from "../preconditions/ConnectorPreconditions.sol";
import {ConnectorStorage} from "../../../../src/connectors/ConnectorStorage.sol";
import {Enums} from "../../../../src/libs/Enums.sol";

/* solhint-disable avoid-low-level-calls */

/**
 * @title ConnectorHandler
 * @notice One handler_ function per protocol action. Each handler:
 *   1. Checks a precondition (silently returns if no valid target exists).
 *   2. Calls the connector.
 *   3. Updates ghost state.
 *   4. Runs post-call assertions.
 *   5. Runs global invariants.
 *
 * Handlers are the only public entry points — the fuzzer calls only these.
 *
 * Time control: handler_advanceTime warps the EVM clock forward so deadline-
 * dependent paths (initiateRefund, submitRefundClaimProof) are reachable.
 */
contract ConnectorHandler is ConnectorPreconditions {
    error InsufficientSrcBalance();

    // ─── Time control ──────────────────────────────────────────────────────

    /**
     * @notice Advance block timestamp by [1, FUZZ_MAX_TIME_DELTA] seconds.
     *         Called by the fuzzer to exercise deadline-dependent branches.
     */
    function handler_advanceTime(uint32 delta) external {
        uint32 clamped = uint32(_clamp(uint256(delta), 1, uint256(_FUZZ_MAX_TIME_DELTA)));
        _HEVM.warp(block.timestamp + clamped);
    }

    // ─── Origin: happy path ────────────────────────────────────────────────

    /**
     * @notice Lock tokens on the origin connector, opening a new transfer.
     * @param rawAmount Fuzzed deposit amount — clamped to [MIN, MAX].
     */
    function handler_depositAndLock(uint256 rawAmount) external {
        uint256 amount = _clamp(rawAmount, _FUZZ_MIN_DEPOSIT, _FUZZ_MAX_DEPOSIT);
        if (_srcToken.balanceOf(address(this)) < amount) revert InsufficientSrcBalance();

        bytes32 txId = _originConnector.depositAndLock(
            address(_srcToken),
            address(_dstToken),
            address(this), // recipient = this contract
            amount,
            address(_destConnector),
            block.chainid
        );

        // Update ghost state
        _ghostOriginTxs[txId] = _originConnector.getTx(txId);
        _originActiveTxIds.push(txId);
        _totalOriginLocked += amount;
        _lastSeenNonce = _originConnector.txNonce();

        // Post-call assertions
        _post_originStatus(txId, Enums.TxStatus.DEPOSIT_LOCKED);
        _globalPostconditions();
    }

    /**
     * @notice Submit a mint proof for a DEPOSIT_LOCKED origin tx (within ack window).
     * @param idx Selects which active txId to use.
     */
    function handler_submitMintProof(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickOriginActive(idx, bytes32(0));
        if (!ok) return;

        // Must be within the ack window
        ConnectorStorage.CrossChainTx memory t = _ghostOriginTxs[txId];
        // solhint-disable-next-line gas-strict-inequalities
        if (block.timestamp >= t.ackDeadline) return;

        bytes memory proof = _mintProofPayload(txId);
        _originConnector.submitMintProof(Enums.ProofType.RISC0, proof, txId);

        // Update ghost state — tx is cleaned up on-chain
        _totalOriginLocked -= t.amount;
        _removeFromArray(_originActiveTxIds, txId);

        _post_originStatus(txId, Enums.TxStatus.NONE);
        _globalPostconditions();
    }

    // ─── Origin: refund path ───────────────────────────────────────────────

    /**
     * @notice Initiate a refund for a DEPOSIT_LOCKED origin tx (after ack deadline).
     * @param idx Selects which active txId to use.
     */
    function handler_initiateRefund(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickOriginActive(idx, bytes32(0));
        if (!ok) return;

        ConnectorStorage.CrossChainTx memory t = _ghostOriginTxs[txId];
        if (block.timestamp < t.ackDeadline) return;

        _originConnector.initiateRefund(txId);

        // Ghost state: move from active → refund; no longer counted in locked
        _totalOriginLocked -= t.amount;
        _removeFromArray(_originActiveTxIds, txId);
        _originRefundTxIds.push(txId);

        _post_originStatus(txId, Enums.TxStatus.REFUND_INITIATED);
        _globalPostconditions();
    }

    /**
     * @notice Submit a burn proof for a REFUND_INITIATED origin tx to recover tokens.
     * @param idx Selects which refund-pending txId to use.
     */
    function handler_submitBurnProof(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickOriginRefund(idx);
        if (!ok) return;

        bytes memory proof = _burnProofPayload(txId);
        _originConnector.submitBurnProof(Enums.ProofType.RISC0, proof, txId);

        _removeFromArray(_originRefundTxIds, txId);

        _post_originStatus(txId, Enums.TxStatus.NONE);
        _globalPostconditions();
    }

    /**
     * @notice Submit a non-acceptance proof for a REFUND_INITIATED origin tx
     *         (alternate recovery path when destination never accepted the lock).
     * @param idx Selects which refund-pending txId to use.
     */
    function handler_submitNonAcceptanceProof(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickOriginRefund(idx);
        if (!ok) return;

        // Non-acceptance path is only valid if destination never accepted the lock
        if (_destConnector.destinationLockAccepted(txId)) return;

        bytes memory proof = _nonAcceptanceProofPayload(txId);
        _originConnector.submitNonAcceptanceProof(Enums.ProofType.RISC0, proof, txId);

        _removeFromArray(_originRefundTxIds, txId);

        _post_originStatus(txId, Enums.TxStatus.NONE);
        _globalPostconditions();
    }

    // ─── Destination: happy path ───────────────────────────────────────────

    /**
     * @notice Submit a lock proof to the destination connector, minting wrapped tokens.
     *         Uses a txId from _originActiveTxIds so the ack window is likely open.
     * @param idx Selects which origin txId to relay.
     */
    function handler_submitLockProof(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickOriginActive(idx, bytes32(0));
        if (!ok) return;

        ConnectorStorage.CrossChainTx memory t = _ghostOriginTxs[txId];

        // Guard: ack window must still be open on destination
        // solhint-disable-next-line gas-strict-inequalities
        if (block.timestamp >= t.ackDeadline) return;
        // Guard: replay protection — never lock the same txId twice
        if (_destConnector.destinationLockAccepted(txId)) return;
        // Guard: must not already exist as dest tx
        if (_destConnector.txStatus(txId) != Enums.TxStatus.NONE) return;

        bytes memory proof = _lockProofPayload(txId);

        _destConnector.submitLockProof(
            Enums.ProofType.RISC0,
            proof,
            txId,
            t.amount,
            t.currencyFrom,
            t.currencyTo,
            t.from,
            t.to,
            t.srcChainConnector,
            t.ackDeadline,
            t.nonce,
            t.sourceChainId
        );

        // Ghost state
        _destActiveTxIds.push(txId);
        _recordTombstone(txId);

        _post_destStatus(txId, Enums.TxStatus.MINTED_IN_HOLDING);
        _post_destTombstone(txId);
        _globalPostconditions();
    }

    /**
     * @notice Submit an ack proof on the destination connector (within ack window).
     * @param idx Selects which dest-active txId to use.
     */
    function handler_submitAckProof(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickDestActive(idx);
        if (!ok) return;

        ConnectorStorage.CrossChainTx memory t = _destConnector.getTx(txId);
        // solhint-disable-next-line gas-strict-inequalities
        if (block.timestamp >= t.ackDeadline) return;

        bytes memory proof = _ackProofPayload(txId);
        _destConnector.submitAckProof(Enums.ProofType.RISC0, proof, txId);

        _removeFromArray(_destActiveTxIds, txId);

        _post_destStatus(txId, Enums.TxStatus.NONE);
        _post_destTombstone(txId);
        _globalPostconditions();
    }

    // ─── Destination: refund path ──────────────────────────────────────────

    /**
     * @notice Submit a refund-claim proof on the destination (after ack deadline).
     * @param idx Selects which dest-active txId to use.
     */
    function handler_submitRefundClaimProof(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickDestActive(idx);
        if (!ok) return;

        ConnectorStorage.CrossChainTx memory t = _destConnector.getTx(txId);
        if (block.timestamp < t.ackDeadline) return;

        bytes memory proof = _refundClaimProofPayload(txId);
        _destConnector.submitRefundClaimProof(Enums.ProofType.RISC0, proof, txId);

        _removeFromArray(_destActiveTxIds, txId);
        _destRefundClaimTxIds.push(txId);

        _post_destStatus(txId, Enums.TxStatus.REFUND_CLAIM_ACCEPTED);
        _post_destTombstone(txId);
        _globalPostconditions();
    }

    /**
     * @notice Execute burn on the destination to destroy holding tokens after refund claim.
     * @param idx Selects which dest-refund-claim txId to use.
     */
    function handler_executeBurn(uint256 idx) external {
        (bool ok, bytes32 txId) = _pre_pickDestRefundClaim(idx);
        if (!ok) return;

        _destConnector.executeBurn(txId);

        _removeFromArray(_destRefundClaimTxIds, txId);

        _post_destStatus(txId, Enums.TxStatus.NONE);
        _post_destTombstone(txId);
        _globalPostconditions();
    }
}
