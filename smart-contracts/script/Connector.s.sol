// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {Connector} from "../src/connectors/Connector.sol";
import {RiscZeroAdapter} from "../src/zk-proof/adapters/RiscZeroAdapter.sol";
import {SnarkAdapter} from "../src/zk-proof/adapters/SnarkAdapter.sol";
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
    // Default image IDs for current RISC0 guests in this repo.
    // Override any value via environment if guest code changes.
    bytes32 internal constant ORIGIN_MINT_IMAGE_ID_DEFAULT =
        0x5ab55c3e99a94be256acd6f786e7b9ff19b7b3665233a2adf086a6ae7daad736;
    bytes32 internal constant ORIGIN_BURN_IMAGE_ID_DEFAULT =
        0xa9decb43bf304fe0d047baf4aa6c613f566c9d5f89e82aa1b156d51fadfcc390;
    bytes32 internal constant DEST_LOCK_IMAGE_ID_DEFAULT =
        0x20a6b70fd94b1eef9415e6acf26d61732d54fc94d43cb99290ad5b1174fb3545;
    bytes32 internal constant DEST_ACK_IMAGE_ID_DEFAULT =
        0xca03b49170b4091a352759887eb483ae4624a5b780223f85b8742249e3b814fb;
    bytes32 internal constant DEST_REFUND_CLAIM_IMAGE_ID_DEFAULT =
        0x3e1fb2ad43fb2f08627576c6ddeb107a228751a682355da65e05b3fcadd4f0f5;

    uint64 internal constant ACK_WINDOW_SECONDS = 1 hours;

    /// @notice Local/mock deployment helper.
    /// @dev This script deploys mock verifiers and should not be used for production verification.
    function run() external returns (Connector connector) {
        vm.startBroadcast();

        bytes32 originMintImageId = vm.envOr("ORIGIN_MINT_IMAGE_ID", ORIGIN_MINT_IMAGE_ID_DEFAULT);
        bytes32 originBurnImageId = vm.envOr("ORIGIN_BURN_IMAGE_ID", ORIGIN_BURN_IMAGE_ID_DEFAULT);
        bytes32 destLockImageId = vm.envOr("DEST_LOCK_IMAGE_ID", DEST_LOCK_IMAGE_ID_DEFAULT);
        bytes32 destAckImageId = vm.envOr("DEST_ACK_IMAGE_ID", DEST_ACK_IMAGE_ID_DEFAULT);
        bytes32 destRefundClaimImageId = vm.envOr("DEST_REFUND_CLAIM_IMAGE_ID", DEST_REFUND_CLAIM_IMAGE_ID_DEFAULT);

        MockRiscZeroVerifier risc0 = new MockRiscZeroVerifier();
        MockSnarkVerifier snark = new MockSnarkVerifier();

        bytes32[] memory allowedIds = new bytes32[](5);
        allowedIds[0] = originMintImageId;
        allowedIds[1] = originBurnImageId;
        allowedIds[2] = destLockImageId;
        allowedIds[3] = destAckImageId;
        allowedIds[4] = destRefundClaimImageId;
        RiscZeroAdapter risc0Adapter = new RiscZeroAdapter(address(risc0), allowedIds);
        SnarkAdapter snarkAdapter = new SnarkAdapter(address(snark));

        bytes32[5] memory routeImageIds;
        routeImageIds[0] = originMintImageId;
        routeImageIds[1] = originBurnImageId;
        routeImageIds[2] = destLockImageId;
        routeImageIds[3] = destAckImageId;
        routeImageIds[4] = destRefundClaimImageId;
        connector = new Connector(address(risc0Adapter), address(snarkAdapter), ACK_WINDOW_SECONDS, routeImageIds);

        vm.stopBroadcast();
    }
}
