// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ISnarkVerifier} from "../../src/zk-proof/ISnarkJsVerifier.sol";

contract MockSnarkVerifier is ISnarkVerifier {
    bool public shouldReturnFalse;

    function setShouldReturnFalse(bool _val) external {
        shouldReturnFalse = _val;
    }

    function verify(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata)
        external
        view
        override
        returns (bool)
    {
        return !shouldReturnFalse;
    }
}
