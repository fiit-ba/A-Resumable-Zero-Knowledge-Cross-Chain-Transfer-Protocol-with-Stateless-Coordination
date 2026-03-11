// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {RiscZeroAdapter} from "../src/zk-proof/adapters/RiscZeroAdapter.sol";

/// @notice Deploys a production RiscZeroAdapter using real verifier + image id.
/// @dev Required env vars:
/// - PRIVATE_KEY: deployer key
/// - RISC0_VERIFIER: IRiscZeroVerifier contract address
/// - RISC0_IMAGE_ID: bytes32 image id (0x...)
contract DeployRiscZeroAdapter is Script {
    function run() external returns (RiscZeroAdapter adapter) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address risc0Verifier = vm.envAddress("RISC0_VERIFIER");
        bytes32 imageId = vm.envBytes32("RISC0_IMAGE_ID");

        vm.startBroadcast(privateKey);
        adapter = new RiscZeroAdapter(risc0Verifier, imageId);
        vm.stopBroadcast();

        console2.log("RiscZeroAdapter:", address(adapter));
        console2.log("Risc0Verifier:", risc0Verifier);
        console2.log("ImageId:");
        console2.logBytes32(imageId);
    }
}
