// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC20} from "openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @author Trustless Universal Protocol Contributors
/// @notice Simple mintable token for local end-to-end testing.
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// @notice Mints tokens to a target account.
    /// @param to Recipient address that will receive minted tokens.
    /// @param amount Token amount to mint.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Burns tokens from the caller account.
    /// @param amount Token amount to burn from msg.sender.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
