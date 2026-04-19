// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {WrappedTokenFactory} from "../../src/tokens/WrappedTokenFactory.sol";

/// @dev Test harness: zero-delay timelock + register() convenience for use in Foundry tests.
contract WrappedTokenFactoryHarness is WrappedTokenFactory {
    function _registrationTimelock() internal pure override returns (uint64) {
        return 0;
    }

    /// @dev One-shot register identical to the old API: propose then immediately apply.
    function register(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector,
        address wrappedToken
    ) external {
        proposeRoute(
            sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector, wrappedToken
        );
        applyRoute(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector);
    }
}
