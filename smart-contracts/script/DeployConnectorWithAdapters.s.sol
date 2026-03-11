// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Connector} from "../src/connectors/Connector.sol";

/// @notice Deploys Connector with pre-deployed verifier adapters.
/// @dev Required env vars:
/// - PRIVATE_KEY: deployer key
/// - RISC0_ADAPTER: deployed RiscZeroAdapter address
/// - SNARK_ADAPTER: deployed SnarkAdapter address
/// - ACK_WINDOW_SECONDS: ack window in seconds (uint64)
contract DeployConnectorWithAdapters is Script {
    function run() external returns (Connector connector) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address risc0Adapter = vm.envAddress("RISC0_ADAPTER");
        address snarkAdapter = vm.envAddress("SNARK_ADAPTER");
        uint64 ackWindowSeconds = uint64(vm.envUint("ACK_WINDOW_SECONDS"));

        vm.startBroadcast(privateKey);
        connector = new Connector(risc0Adapter, snarkAdapter, ackWindowSeconds);
        vm.stopBroadcast();

        console2.log("Connector:", address(connector));
        console2.log("Risc0Adapter:", risc0Adapter);
        console2.log("SnarkAdapter:", snarkAdapter);
        console2.log("AckWindowSeconds:");
        console2.logUint(ackWindowSeconds);
    }
}
