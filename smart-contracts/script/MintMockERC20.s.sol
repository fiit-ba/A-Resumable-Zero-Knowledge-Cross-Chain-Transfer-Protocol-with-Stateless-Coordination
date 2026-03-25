// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

/// @notice Mints MockERC20 tokens to a recipient.
/// @dev Expects env vars: TOKEN (address), RECIPIENT (address), MINT_AMOUNT (uint256).
contract MintMockERC20 is Script {
    function run() external {
        address token = vm.envAddress("TOKEN");
        address recipient = vm.envAddress("RECIPIENT");
        uint256 amount = vm.envUint("MINT_AMOUNT");

        vm.startBroadcast();
        IMintableERC20(token).mint(recipient, amount);
        vm.stopBroadcast();
    }
}

