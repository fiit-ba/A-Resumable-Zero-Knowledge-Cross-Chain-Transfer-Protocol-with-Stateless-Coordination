// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IRiscZeroVerifier, Receipt} from "risc0-ethereum/IRiscZeroVerifier.sol";

contract MockRiscZeroVerifier is IRiscZeroVerifier {
    error MockRiscZeroFail();

    bool public shouldRevert;

    function setShouldRevert(bool _val) external {
        shouldRevert = _val;
    }

    function verify(bytes calldata, bytes32, bytes32) external view override {
        if (shouldRevert) revert MockRiscZeroFail();
    }

    function verifyIntegrity(Receipt calldata) external view override {
        if (shouldRevert) revert MockRiscZeroFail();
    }
}
