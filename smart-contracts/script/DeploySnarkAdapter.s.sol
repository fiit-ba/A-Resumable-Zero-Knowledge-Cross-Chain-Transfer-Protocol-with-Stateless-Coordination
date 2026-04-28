// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {SnarkAdapter} from "../src/zk-proof/adapters/SnarkAdapter.sol";
import {ISnarkVerifier} from "../src/zk-proof/ISnarkJsVerifier.sol";

/// @title MockSnarkVerifierDeploy
/// @author Trustless Universal Protocol Contributors
/// @notice Minimal always-true Groth16 shim used when no real SNARK verifier is available.
///         Safe for testnets where RISC Zero is the primary security mechanism.
contract MockSnarkVerifierDeploy is ISnarkVerifier {
    /// @notice Returns true for every SNARK proof verification request.
    function verify(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata)
        external
        pure
        override
        returns (bool)
    {
        return true;
    }
}

/// @title DeploySnarkAdapter
/// @author Trustless Universal Protocol Contributors
/// @notice Deploys a SnarkAdapter, optionally wrapping a pre-deployed verifier.
/// @dev Required env vars:
///   PRIVATE_KEY — deployer key
/// Optional:
///   SNARK_VERIFIER — pre-deployed ISnarkVerifier address; deploys MockSnarkVerifierDeploy if unset
contract DeploySnarkAdapter is Script {
    /// @notice Deploys the SNARK verifier adapter using the configured verifier address.
    /// @return adapter The deployed SnarkAdapter instance.
    function run() external returns (SnarkAdapter adapter) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address snarkVerifier = vm.envOr("SNARK_VERIFIER", address(0));

        vm.startBroadcast(privateKey);
        if (snarkVerifier == address(0)) {
            snarkVerifier = address(new MockSnarkVerifierDeploy());
        }
        adapter = new SnarkAdapter(snarkVerifier);
        vm.stopBroadcast();

        console2.log("SnarkAdapter:", address(adapter));
        console2.log("SnarkVerifier:", snarkVerifier);
    }
}
