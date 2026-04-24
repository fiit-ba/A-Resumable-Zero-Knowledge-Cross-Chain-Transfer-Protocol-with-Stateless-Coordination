// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ConnectorHandler} from "../helper/handlers/ConnectorHandler.sol";

/**
 * @title ConnectorProperties
 * @notice Named invariant functions with the `echidna_` prefix.
 *         Echidna calls these after every sequence step; they must always return true.
 *         Medusa's property testing mode also recognises the same prefix.
 *
 * These complement the inline `assert()` calls in ConnectorPostconditions:
 *   - assert()  → surfaced as assertion failures (fast, per-call)
 *   - echidna_  → checked after every sequence step (persistent invariants)
 */
contract ConnectorProperties is ConnectorHandler {
    /**
     * @notice The origin connector always holds at least as many srcTokens as
     *         the sum of all currently DEPOSIT_LOCKED amounts.
     */
    function echidna_origin_solvent() external view returns (bool) {
        // solhint-disable-next-line gas-strict-inequalities
        return _srcToken.balanceOf(address(_originConnector)) >= _totalOriginLocked;
    }

    /**
     * @notice originConnector.txNonce() must never go below the highest value
     *         we have ever observed (monotonically non-decreasing).
     */
    function echidna_nonce_monotonic() external view returns (bool) {
        // solhint-disable-next-line gas-strict-inequalities
        return _originConnector.txNonce() >= _lastSeenNonce;
    }

    /**
     * @notice Every txId that ever received destinationLockAccepted = true on the
     *         destination connector must still have it set (tombstone is permanent).
     */
    function echidna_tombstone_permanent() external view returns (bool) {
        uint256 len = _tombstonedTxIds.length;
        for (uint256 i = 0; i < len; ++i) {
            if (!_destConnector.destinationLockAccepted(_tombstonedTxIds[i])) return false;
        }
        return true;
    }

    /**
     * @notice A txId cannot appear in both the origin-active and origin-refund
     *         ghost lists simultaneously — the state machine is a DAG.
     */
    function echidna_no_dual_origin_status() external view returns (bool) {
        uint256 al = _originActiveTxIds.length;
        uint256 rl = _originRefundTxIds.length;
        for (uint256 i = 0; i < al; ++i) {
            for (uint256 j = 0; j < rl; ++j) {
                if (_originActiveTxIds[i] == _originRefundTxIds[j]) return false;
            }
        }
        return true;
    }

    /**
     * @notice A txId cannot appear in both the destination-active and destination-
     *         refund-claim ghost lists simultaneously.
     */
    function echidna_no_dual_dest_status() external view returns (bool) {
        uint256 al = _destActiveTxIds.length;
        uint256 rl = _destRefundClaimTxIds.length;
        for (uint256 i = 0; i < al; ++i) {
            for (uint256 j = 0; j < rl; ++j) {
                if (_destActiveTxIds[i] == _destRefundClaimTxIds[j]) return false;
            }
        }
        return true;
    }

    /**
     * @notice The source-token balance of the origin connector must never exceed
     *         what was minted to this harness (no spurious tokens can appear).
     */
    function echidna_no_token_inflation() external view returns (bool) {
        return _srcToken.balanceOf(address(_originConnector)) < _FUZZ_INITIAL_BALANCE + 1;
    }
}
