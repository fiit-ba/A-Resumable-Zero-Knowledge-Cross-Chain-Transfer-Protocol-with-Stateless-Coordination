// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {WrappedTokenFactory} from "../../src/tokens/WrappedTokenFactory.sol";

/// @title ApplyRoutes
/// @author Trustless Universal Protocol Contributors
/// @notice Applies a previously proposed wrapped-token route after the 48-hour timelock.
///         On local Anvil, `make bootstrap` runs this automatically after warping the clock.
///         On production networks, run this manually 48 hours after `make propose-routes`.
/// @dev Required env vars:
///   PRIVATE_KEY                  — deployer / factory admin key
///   SOURCE_CHAIN_ID              — chain ID of the source connector
///   SOURCE_CONNECTOR             — Connector address on the source chain
///   SOURCE_TOKEN                 — ERC-20 token address on the source chain
///   DEST_CHAIN_ID                — chain ID of the destination connector
///   DEST_CONNECTOR               — Connector address on the destination chain
///   DEST_WRAPPED_TOKEN_FACTORY   — WrappedTokenFactory address on the destination chain
contract ApplyRoutes is Script {
    /// @notice Reads env vars and calls applyRoute on the destination WrappedTokenFactory.
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        uint256 sourceChainId = vm.envUint("SOURCE_CHAIN_ID");
        address sourceConnector = vm.envAddress("SOURCE_CONNECTOR");
        address sourceToken = vm.envAddress("SOURCE_TOKEN");
        uint256 destChainId = vm.envUint("DEST_CHAIN_ID");
        address destConnector = vm.envAddress("DEST_CONNECTOR");
        address factory = vm.envAddress("DEST_WRAPPED_TOKEN_FACTORY");

        vm.startBroadcast(privateKey);
        WrappedTokenFactory(factory).applyRoute(sourceChainId, sourceConnector, sourceToken, destChainId, destConnector);
        vm.stopBroadcast();

        console2.log("Route applied. Token is live.");
        console2.log("  Factory:           ", factory);
        console2.log("  Source chain ID:   ", sourceChainId);
        console2.log("  Source connector:  ", sourceConnector);
        console2.log("  Source token:      ", sourceToken);
        console2.log("  Dest chain ID:     ", destChainId);
        console2.log("  Dest connector:    ", destConnector);
    }
}
