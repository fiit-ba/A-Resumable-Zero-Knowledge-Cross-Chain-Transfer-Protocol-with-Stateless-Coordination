// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {RiscZeroAdapter} from "../src/zk-proof/adapters/RiscZeroAdapter.sol";

/// @notice Deploys a production RiscZeroAdapter with an allowlist of image IDs for all routes
///         used on this chain.
/// @dev Required env vars:
/// - PRIVATE_KEY: deployer key
/// - RISC0_VERIFIER: IRiscZeroVerifier contract address
///
/// At least one of the following five route image IDs must be non-zero:
/// - ORIGIN_MINT_IMAGE_ID   (used by submitMintProof on the origin chain)
/// - ORIGIN_BURN_IMAGE_ID   (used by submitBurnProof on the origin chain)
/// - DEST_LOCK_IMAGE_ID     (used by submitLockProof on the destination chain)
/// - DEST_ACK_IMAGE_ID      (used by submitAckProof on the destination chain)
/// - DEST_REFUND_CLAIM_IMAGE_ID (used by submitRefundClaimProof on the destination chain)
///
/// Zero-valued entries are skipped — only non-zero IDs are added to the allowlist.
contract DeployRiscZeroAdapter is Script {
    function run() external returns (RiscZeroAdapter adapter) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address risc0Verifier = vm.envAddress("RISC0_VERIFIER");

        bytes32 originMintId = vm.envOr("ORIGIN_MINT_IMAGE_ID", bytes32(0));
        bytes32 originBurnId = vm.envOr("ORIGIN_BURN_IMAGE_ID", bytes32(0));
        bytes32 destLockId = vm.envOr("DEST_LOCK_IMAGE_ID", bytes32(0));
        bytes32 destAckId = vm.envOr("DEST_ACK_IMAGE_ID", bytes32(0));
        bytes32 destRefundClaimId = vm.envOr("DEST_REFUND_CLAIM_IMAGE_ID", bytes32(0));

        // Collect non-zero image IDs into the allowlist (deduplicated by omission).
        bytes32[5] memory candidates;
        candidates[0] = originMintId;
        candidates[1] = originBurnId;
        candidates[2] = destLockId;
        candidates[3] = destAckId;
        candidates[4] = destRefundClaimId;
        uint256 count;
        for (uint256 i = 0; i < 5; i++) {
            if (candidates[i] != bytes32(0)) count++;
        }

        bytes32[] memory allowedIds = new bytes32[](count);
        uint256 idx;
        for (uint256 i = 0; i < 5; i++) {
            if (candidates[i] != bytes32(0)) {
                allowedIds[idx++] = candidates[i];
            }
        }

        vm.startBroadcast(privateKey);
        adapter = new RiscZeroAdapter(risc0Verifier, allowedIds);
        vm.stopBroadcast();

        console2.log("RiscZeroAdapter:", address(adapter));
        console2.log("Risc0Verifier:", risc0Verifier);
        console2.log("Allowlist size:", allowedIds.length);
        for (uint256 i = 0; i < allowedIds.length; i++) {
            console2.log("  imageId[%d]:", i);
            console2.logBytes32(allowedIds[i]);
        }
    }
}
