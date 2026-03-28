// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Connector} from "../src/connectors/Connector.sol";
import {Errors} from "../src/libs/Errors.sol";

/// @notice Deploys Connector with pre-deployed verifier adapters and per-route RISC Zero image IDs.
/// @dev Required env vars:
/// - PRIVATE_KEY: deployer key
/// - RISC0_ADAPTER: deployed RiscZeroAdapter address
/// - SNARK_ADAPTER: deployed SnarkAdapter address
/// - ACK_WINDOW_SECONDS: ack window in seconds (uint64)
///
/// Per-route RISC Zero image IDs (set to 0x0 for routes unused on this chain):
/// - ORIGIN_MINT_IMAGE_ID   (VerifierRoute 0 — submitMintProof)
/// - ORIGIN_BURN_IMAGE_ID   (VerifierRoute 1 — submitBurnProof)
/// - DEST_LOCK_IMAGE_ID     (VerifierRoute 2 — submitLockProof)
/// - DEST_ACK_IMAGE_ID      (VerifierRoute 3 — submitAckProof)
/// - DEST_REFUND_CLAIM_IMAGE_ID (VerifierRoute 4 — submitRefundClaimProof)
contract DeployConnectorWithAdapters is Script {
    function run() external returns (Connector connector) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address risc0Adapter = vm.envAddress("RISC0_ADAPTER");
        address snarkAdapter = vm.envAddress("SNARK_ADAPTER");
        uint64 ackWindowSeconds = uint64(vm.envUint("ACK_WINDOW_SECONDS"));
        if (ackWindowSeconds == 0) revert Errors.ZeroAckWindow();

        bytes32[5] memory risc0RouteImageIds;
        risc0RouteImageIds[0] = vm.envOr("ORIGIN_MINT_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[1] = vm.envOr("ORIGIN_BURN_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[2] = vm.envOr("DEST_LOCK_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[3] = vm.envOr("DEST_ACK_IMAGE_ID", bytes32(0));
        risc0RouteImageIds[4] = vm.envOr("DEST_REFUND_CLAIM_IMAGE_ID", bytes32(0));

        vm.startBroadcast(privateKey);
        connector = new Connector(risc0Adapter, snarkAdapter, ackWindowSeconds, risc0RouteImageIds);
        vm.stopBroadcast();

        console2.log("Connector:", address(connector));
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
