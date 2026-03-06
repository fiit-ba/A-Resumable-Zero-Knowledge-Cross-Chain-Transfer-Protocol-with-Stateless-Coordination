// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {Connector} from "../src/connectors/Connector.sol";
import {IRiscZeroVerifier, Receipt} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {ISnarkVerifier} from "../src/zk-proof/ISnarkJsVerifier.sol";

contract MockRiscZeroVerifier is IRiscZeroVerifier {
    function verify(bytes calldata, bytes32, bytes32) external pure override {}

    function verifyIntegrity(Receipt calldata) external pure override {}
}

contract MockSnarkVerifier is ISnarkVerifier {
    function verify(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata)
        external
        pure
        override
        returns (bool)
    {
        return true;
    }
}

contract DeployConnector is Script {
    bytes32 internal constant IMAGE_ID = bytes32(uint256(0x1234));

    uint64 internal constant ACK_WINDOW_SECONDS = 1 hours;

    function run() external returns (Connector connector) {
        vm.startBroadcast();

        MockRiscZeroVerifier risc0 = new MockRiscZeroVerifier();
        MockSnarkVerifier snark = new MockSnarkVerifier();

        connector = new Connector(address(risc0), address(snark), IMAGE_ID, ACK_WINDOW_SECONDS);

        vm.stopBroadcast();
    }
}

