// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console2} from "forge-std/Script.sol";

/// @title IMintableERC20
/// @author Trustless Universal Protocol Contributors
/// @notice Minimal interface for MockERC20 tokens used in local test deployments.
interface IMintableERC20 {
    /// @notice Mints `amount` tokens to `to`. Callable only by the token owner.
    /// @param to      Recipient address.
    /// @param amount  Token amount in wei.
    function mint(address to, uint256 amount) external;
}

/// @title SeedTestData
/// @author Trustless Universal Protocol Contributors
/// @notice Mints source tokens to a test recipient. Run on the source chain.
/// @dev Required env vars:
///   PRIVATE_KEY      — minter / contract-owner key
///   SOURCE_TOKEN     — MockERC20 address on the source chain
///   SOURCE_CONNECTOR — Connector address on the source chain (used in approve hint)
/// Optional env vars:
///   SEED_RECIPIENT   — address to receive tokens (defaults to the broadcaster)
///   SEED_AMOUNT      — amount in wei (default: 1 000 x 10^18)
contract SeedTestData is Script {
    uint256 internal constant _DEFAULT_SEED_AMOUNT = 1_000e18;

    /// @notice Reads env vars, mints tokens to SEED_RECIPIENT, and prints next steps.
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("SOURCE_TOKEN");
        address connector = vm.envAddress("SOURCE_CONNECTOR");
        address broadcaster = vm.addr(privateKey);
        address recipient = vm.envOr("SEED_RECIPIENT", broadcaster);
        uint256 amount = vm.envOr("SEED_AMOUNT", _DEFAULT_SEED_AMOUNT);

        vm.startBroadcast(privateKey);
        IMintableERC20(token).mint(recipient, amount);
        vm.stopBroadcast();

        console2.log("Seeded test data:");
        console2.log("  Token:    ", token);
        console2.log("  Recipient:", recipient);
        console2.log("  Amount:   ", amount);
        console2.log("Approve: make approve-connector");
        console2.log("Connector: ", connector);
    }
}
