// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

interface IHevm {
    function warp(uint256 newTimestamp) external;
    function roll(uint256 newBlockNumber) external;
}

abstract contract FuzzConstants {
    // Echidna / Medusa cheatcode address (same as Foundry vm)
    IHevm internal constant _HEVM = IHevm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    bytes32 internal constant _FUZZ_IMAGE_ID = bytes32(uint256(0x1234));
    uint64 internal constant _FUZZ_ACK_WINDOW = 1 hours;

    // Generous balance so the fuzzer never runs out of source tokens
    uint256 internal constant _FUZZ_INITIAL_BALANCE = 1_000_000_000e18;

    uint256 internal constant _FUZZ_MIN_DEPOSIT = 1e15;
    uint256 internal constant _FUZZ_MAX_DEPOSIT = 100_000e18;

    // Maximum seconds handler_advanceTime may add in a single call
    uint32 internal constant _FUZZ_MAX_TIME_DELTA = 7 days;

    function _clamp(uint256 value, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (hi < lo) return lo;
        return lo + (value % (hi - lo + 1));
    }
}
