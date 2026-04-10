// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script} from "forge-std/Script.sol";

/// @title IMintableERC20
/// @author Trustless Universal Protocol Contributors
/// @notice Interface for mint-capable ERC20 test tokens.
interface IMintableERC20 {
    /// @notice Mints tokens to a target account.
    /// @param to Recipient address that will receive minted tokens.
    /// @param amount Token amount to mint.
    function mint(address to, uint256 amount) external;
}

/// @title MintMockERC20
/// @author Trustless Universal Protocol Contributors
/// @notice Mints MockERC20 tokens to a recipient.
/// @dev Expects env vars: TOKEN (address), RECIPIENT (address), MINT_AMOUNT (uint256).
contract MintMockERC20 is Script {
    /// @notice Loads mint inputs from env vars and sends a mint transaction.
    function run() external {
        address token = vm.envAddress("TOKEN");
        address recipient = vm.envAddress("RECIPIENT");
        uint256 amount = vm.envUint("MINT_AMOUNT");

        vm.startBroadcast();
        IMintableERC20(token).mint(recipient, amount);
        vm.stopBroadcast();
    }
}
