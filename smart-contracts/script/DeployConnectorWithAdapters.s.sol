// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {Connector} from "../src/connectors/Connector.sol";
import {WrappedTokenFactory} from "../src/tokens/WrappedTokenFactory.sol";
import {Errors} from "../src/libs/Errors.sol";

/// @notice Deploys Connector with pre-deployed verifier adapters and per-route RISC Zero image IDs.
/// @title DeployConnectorWithAdapters
/// @author Trustless Universal Protocol Contributors
/// @dev Required env vars:
/// - PRIVATE_KEY: deployer key
/// - RISC0_ADAPTER: deployed RiscZeroAdapter address
/// - SNARK_ADAPTER: deployed SnarkAdapter address
/// - ACK_WINDOW_SECONDS: ack window in seconds (uint64)
/// - WRAPPED_TOKEN_FACTORY: deployed WrappedTokenFactory address (optional — deploys a new one if unset)
/// - REGISTRATION_TIMELOCK: route-registration timelock in seconds for a freshly deployed factory
///   (default 0 = instant; set to 172800 for 48-hour timelock on live bridges with existing users)
///
/// Per-route RISC Zero image IDs (set to 0x0 for routes unused on this chain):
/// - ORIGIN_MINT_IMAGE_ID   (VerifierRoute 0 — submitMintProof)
/// - ORIGIN_BURN_IMAGE_ID   (VerifierRoute 1 — submitBurnProof)
/// - DEST_LOCK_IMAGE_ID     (VerifierRoute 2 — submitLockProof)
/// - DEST_ACK_IMAGE_ID      (VerifierRoute 3 — submitAckProof)
/// - DEST_REFUND_CLAIM_IMAGE_ID (VerifierRoute 4 — submitRefundClaimProof)
contract DeployConnectorWithAdapters is Script {
    /// @notice Deploys a Connector using configured verifier adapters and route image IDs.
    /// @return connector Deployed Connector instance.
    function run() external returns (Connector connector) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address risc0Adapter = vm.envAddress("RISC0_ADAPTER");
        address snarkAdapter = vm.envAddress("SNARK_ADAPTER");
        uint64 ackWindowSeconds = uint64(vm.envUint("ACK_WINDOW_SECONDS"));
        if (ackWindowSeconds == 0) revert Errors.ZeroAckWindow();

        bytes32[6] memory risc0RouteImageIds;
        risc0RouteImageIds[0] = vm.envOr("ORIGIN_MINT_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[1] = vm.envOr("ORIGIN_BURN_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[2] = vm.envOr("DEST_LOCK_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[3] = vm.envOr("DEST_ACK_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[4] = vm.envOr("DEST_REFUND_CLAIM_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[5] = vm.envOr("ORIGIN_NON_ACCEPT_IMAGE_ID", bytes32(0));

        address wrappedTokenFactoryAddr = vm.envOr("WRAPPED_TOKEN_FACTORY", address(0));
        uint64 registrationTimelock = uint64(vm.envOr("REGISTRATION_TIMELOCK", uint256(0)));

        vm.startBroadcast(privateKey);
        if (wrappedTokenFactoryAddr == address(0)) {
            wrappedTokenFactoryAddr = address(new WrappedTokenFactory(registrationTimelock));
        }
        connector =
            new Connector(risc0Adapter, snarkAdapter, ackWindowSeconds, risc0RouteImageIds, wrappedTokenFactoryAddr);
        vm.stopBroadcast();

        console2.log("Connector:", address(connector));
        console2.log("WrappedTokenFactory:", wrappedTokenFactoryAddr);
        console2.log("Risc0Adapter:", risc0Adapter);
        console2.log("SnarkAdapter:", snarkAdapter);
        console2.log("AckWindowSeconds:", ackWindowSeconds);
        console2.log("RouteImageIds:");
        console2.log("  ORIGIN_MINT (0):         ");
        console2.logBytes32(risc0RouteImageIds[0]);
        console2.log("  ORIGIN_BURN (1):         ");
        console2.logBytes32(risc0RouteImageIds[1]);
        console2.log("  DEST_LOCK (2):           ");
        console2.logBytes32(risc0RouteImageIds[2]);
        console2.log("  DEST_ACK (3):            ");
        console2.logBytes32(risc0RouteImageIds[3]);
        console2.log("  DEST_REFUND_CLAIM (4):   ");
        console2.logBytes32(risc0RouteImageIds[4]);
    }
}
