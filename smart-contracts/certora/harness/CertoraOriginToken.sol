// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @notice Dummy ERC20 for Certora scenes to prevent arithmetic overflows 
///         and path explosion. The harness uses shadow accounting to track 
///         origin token balances, so the actual ERC20 state is irrelevant.
contract CertoraOriginToken {
    function mint(address, uint256) external pure {}

    function forceApprove(address, address, uint256) external pure {}

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function totalSupply() external pure returns (uint256) {
        return 0;
    }
}
