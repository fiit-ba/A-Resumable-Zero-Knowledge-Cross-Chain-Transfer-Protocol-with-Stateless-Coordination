// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {WrappedTokenFactory} from "../../src/tokens/WrappedTokenFactory.sol";

/// @title ProposeRoutes
/// @author Trustless Universal Protocol Contributors
/// @notice Proposes a wrapped-token route on the destination chain WrappedTokenFactory.
///         Pair with ApplyRoutes after the 48-hour timelock elapses (or use `make bootstrap`
///         on a local Anvil node, which warps the clock automatically).
/// @dev Required env vars:
///   PRIVATE_KEY                  — deployer / factory admin key
///   SOURCE_CHAIN_ID              — chain ID of the source connector (e.g. 31337)
///   SOURCE_CONNECTOR             — Connector address on the source chain
///   SOURCE_TOKEN                 — ERC-20 token address on the source chain
///   DEST_CHAIN_ID                — chain ID of the destination connector (e.g. 31338)
///   DEST_CONNECTOR               — Connector address on the destination chain
///   DEST_WRAPPED_TOKEN_FACTORY   — WrappedTokenFactory address on the destination chain
///   DEST_WRAPPED_TOKEN           — wrapped-token address to register for this route
contract ProposeRoutes is Script {
    /// @notice Reads env vars and calls proposeRoute on the destination WrappedTokenFactory.
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        uint256 sourceChainId = vm.envUint("SOURCE_CHAIN_ID");
        address sourceConnector = vm.envAddress("SOURCE_CONNECTOR");
        address sourceToken = vm.envAddress("SOURCE_TOKEN");
        uint256 destChainId = vm.envUint("DEST_CHAIN_ID");
        address destConnector = vm.envAddress("DEST_CONNECTOR");
        address factory = vm.envAddress("DEST_WRAPPED_TOKEN_FACTORY");
        address wrappedToken = vm.envAddress("DEST_WRAPPED_TOKEN");

        vm.startBroadcast(privateKey);
        WrappedTokenFactory(factory)
            .proposeRoute(sourceChainId, sourceConnector, sourceToken, destChainId, destConnector, wrappedToken);
        vm.stopBroadcast();

        console2.log("Route proposed.");
        console2.log("  Factory:           ", factory);
        console2.log("  Source chain ID:   ", sourceChainId);
        console2.log("  Source connector:  ", sourceConnector);
        console2.log("  Source token:      ", sourceToken);
        console2.log("  Dest chain ID:     ", destChainId);
        console2.log("  Dest connector:    ", destConnector);
        console2.log("  Wrapped token:     ", wrappedToken);
        console2.log("Next: make apply-routes (48h)");
    }
}
