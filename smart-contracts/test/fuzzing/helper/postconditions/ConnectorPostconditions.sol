// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {FuzzSetup} from "../../FuzzSetup.sol";
import {Enums} from "../../../../src/libs/Enums.sol";

/**
 * @title ConnectorPostconditions
 * @notice Invariant assertions run after every successful handler call.
 *
 * Invariants enforced:
 *   1. Origin solvency — srcToken balance of originConnector >= sum of DEPOSIT_LOCKED amounts
 *   2. Nonce monotonicity — originConnector.txNonce() never decreases
 *   3. Tombstone permanence — destinationLockAccepted is never cleared for any accepted txId
 *   4. Status integrity — individual checks after each handler verify the expected on-chain status
 */
abstract contract ConnectorPostconditions is FuzzSetup {
    // ─── Individual post-call checks ──────────────────────────────────────

    function _post_originStatus(bytes32 txId, Enums.TxStatus expected) internal view {
        assert(_originConnector.txStatus(txId) == expected);
    }

    function _post_destStatus(bytes32 txId, Enums.TxStatus expected) internal view {
        assert(_destConnector.txStatus(txId) == expected);
    }

    function _post_destTombstone(bytes32 txId) internal view {
        assert(_destConnector.destinationLockAccepted(txId) == true);
    }

    // ─── Global invariants ─────────────────────────────────────────────────

    // INV-1: originConnector always holds at least as many srcTokens as are owed to DEPOSIT_LOCKED txs
    function _inv_originSolvency() internal view {
        // solhint-disable-next-line gas-strict-inequalities
        assert(_srcToken.balanceOf(address(_originConnector)) >= _totalOriginLocked);
    }

    // INV-2: txNonce is monotonically non-decreasing
    function _inv_nonceMonotonic() internal {
        uint256 current = _originConnector.txNonce();
        // solhint-disable-next-line gas-strict-inequalities
        assert(current >= _lastSeenNonce);
        _lastSeenNonce = current;
    }

    // INV-3: every txId that ever received destinationLockAccepted = true still has it set
    function _inv_tombstonePermanence() internal view {
        uint256 len = _tombstonedTxIds.length;
        for (uint256 i = 0; i < len; ++i) {
            assert(_destConnector.destinationLockAccepted(_tombstonedTxIds[i]));
        }
    }

    // INV-4: a txId cannot simultaneously appear in both origin active and origin refund lists
    function _inv_noDoubleStatus() internal view {
        uint256 activeLen = _originActiveTxIds.length;
        uint256 refundLen = _originRefundTxIds.length;
        for (uint256 i = 0; i < activeLen; ++i) {
            for (uint256 j = 0; j < refundLen; ++j) {
                assert(_originActiveTxIds[i] != _originRefundTxIds[j]);
            }
        }
    }

    // ─── Composite check called after every handler ────────────────────────

    function _globalPostconditions() internal {
        _inv_originSolvency();
        _inv_nonceMonotonic();
        _inv_tombstonePermanence();
        _inv_noDoubleStatus();
    }
}
