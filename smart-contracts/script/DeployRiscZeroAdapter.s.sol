pragma solidity ^0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {ControlID, RiscZeroGroth16Verifier} from "risc0-ethereum/groth16/RiscZeroGroth16Verifier.sol";
import {RiscZeroAdapter} from "../src/zk-proof/adapters/RiscZeroAdapter.sol";

/// @notice Deploys a production RiscZeroAdapter with an allowlist of image IDs for all routes
///         used on this chain.
/// @title DeployRiscZeroAdapter
/// @author Trustless Universal Protocol Contributors
/// @dev Required env vars:
/// - PRIVATE_KEY: deployer key
///
/// Optional env vars:
/// - RISC0_VERIFIER: IRiscZeroVerifier contract address
///   If omitted, this script deploys a RiscZeroGroth16Verifier first.
///
/// At least one of the following six route image IDs must be non-zero:
/// - ORIGIN_MINT_IMAGE_ID        (used by submitMintProof on the origin chain)
/// - ORIGIN_BURN_IMAGE_ID        (used by submitBurnProof on the origin chain)
/// - DEST_LOCK_IMAGE_ID          (used by submitLockProof on the destination chain)
/// - DEST_ACK_IMAGE_ID           (used by submitAckProof on the destination chain)
/// - DEST_REFUND_CLAIM_IMAGE_ID  (used by submitRefundClaimProof on the destination chain)
/// - ORIGIN_NON_ACCEPT_IMAGE_ID  (used by submitNonAcceptanceProof on the origin chain)
///
/// Zero-valued entries are skipped — only non-zero IDs are added to the allowlist.
contract DeployRiscZeroAdapter is Script {
    /// @notice Deploys a RiscZeroAdapter and configures its allowed image IDs from env vars.
    /// @return adapter Deployed RiscZeroAdapter instance.
    function run() external returns (RiscZeroAdapter adapter) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address risc0Verifier = vm.envOr("RISC0_VERIFIER", address(0));

        bytes32 originMintId = vm.envOr("ORIGIN_MINT_IMAGE_ID", bytes32(0));
        bytes32 originBurnId = vm.envOr("ORIGIN_BURN_IMAGE_ID", bytes32(0));
        bytes32 destLockId = vm.envOr("DEST_LOCK_IMAGE_ID", bytes32(0));
        bytes32 destAckId = vm.envOr("DEST_ACK_IMAGE_ID", bytes32(0));
        bytes32 destRefundClaimId = vm.envOr("DEST_REFUND_CLAIM_IMAGE_ID", bytes32(0));
        bytes32 originNonAcceptId = vm.envOr("ORIGIN_NON_ACCEPT_IMAGE_ID", bytes32(0));

        // Collect non-zero image IDs into the allowlist (deduplicated by omission).
        bytes32[6] memory candidates;
        candidates[0] = originMintId;
        candidates[1] = originBurnId;
        candidates[2] = destLockId;
        candidates[3] = destAckId;
        candidates[4] = destRefundClaimId;
        candidates[5] = originNonAcceptId;
        uint256 count;
        for (uint256 i = 0; i < 6; ++i) {
            if (candidates[i] != bytes32(0)) ++count;
        }

        bytes32[] memory allowedIds = new bytes32[](count);
        uint256 idx;
        for (uint256 i = 0; i < 6; ++i) {
            if (candidates[i] != bytes32(0)) {
                allowedIds[idx] = candidates[i];
                ++idx;
            }
        }

        vm.startBroadcast(privateKey);
        if (risc0Verifier == address(0)) {
            risc0Verifier = address(new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID));
            console2.log("RISC0 verifier:", risc0Verifier);
        }
        adapter = new RiscZeroAdapter(risc0Verifier, allowedIds);
        vm.stopBroadcast();

        console2.log("RiscZeroAdapter:", address(adapter));
        console2.log("Risc0Verifier:", risc0Verifier);
        console2.log("Allowlist size:", allowedIds.length);
        for (uint256 i = 0; i < allowedIds.length; ++i) {
            console2.log("  imageId[%d]:", i);
            console2.logBytes32(allowedIds[i]);
        }
    }
}
