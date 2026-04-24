// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/* solhint-disable avoid-low-level-calls */

/**
 * @title FuzzIntegrityBase
 * @notice Contains shared helpers for fuzz integrity contracts
 */
abstract contract FuzzIntegrityBase {
    /**
     * @notice Executes a delegatecall against the current harness
     * @dev Used to invoke handler entrypoints through the fuzz integrity surface
     * @param callData Encoded calldata for the handler call
     * @return success Whether the delegatecall succeeded
     * @return errorSelector First four bytes of the returned data
     */
    function _testSelf(bytes memory callData) internal returns (bool, bytes4) {
        (bool success, bytes memory returnData) = address(this).delegatecall(callData);

        return (success, bytes4(returnData));
    }
}
