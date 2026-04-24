// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ConnectorPostconditions} from "../postconditions/ConnectorPostconditions.sol";

/**
 * @title ConnectorPreconditions
 * @notice Precondition helpers that guard handler entry points.
 *         A handler that cannot find a valid target silently returns — the fuzzer
 *         will adjust its sequence and try another combination.
 */
abstract contract ConnectorPreconditions is ConnectorPostconditions {
    // Returns true and sets txId if _originActiveTxIds[idx % len] is a valid selection.
    function _pre_pickOriginActive(uint256 idx, bytes32 outTxId) internal view returns (bool ok, bytes32 txId) {
        uint256 len = _originActiveTxIds.length;
        if (len == 0) return (false, bytes32(0));
        txId = _originActiveTxIds[idx % len];
        ok = true;
        outTxId; // suppress unused warning — caller uses the returned txId
    }

    function _pre_pickOriginRefund(uint256 idx) internal view returns (bool ok, bytes32 txId) {
        uint256 len = _originRefundTxIds.length;
        if (len == 0) return (false, bytes32(0));
        txId = _originRefundTxIds[idx % len];
        ok = true;
    }

    function _pre_pickDestActive(uint256 idx) internal view returns (bool ok, bytes32 txId) {
        uint256 len = _destActiveTxIds.length;
        if (len == 0) return (false, bytes32(0));
        txId = _destActiveTxIds[idx % len];
        ok = true;
    }

    function _pre_pickDestRefundClaim(uint256 idx) internal view returns (bool ok, bytes32 txId) {
        uint256 len = _destRefundClaimTxIds.length;
        if (len == 0) return (false, bytes32(0));
        txId = _destRefundClaimTxIds[idx % len];
        ok = true;
    }
}
