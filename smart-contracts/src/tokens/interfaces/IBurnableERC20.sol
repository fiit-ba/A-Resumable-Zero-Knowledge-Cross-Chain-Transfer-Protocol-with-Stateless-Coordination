// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IBurnableERC20
/// @author Trustless Universal Protocol Contributors
/// @notice Interface for bridge-wrapped ERC20 tokens that can be burned by the connector.
interface IBurnableERC20 {
    /// @notice Burns a token amount from the caller balance.
    /// @param amount Token amount to burn.
    function burn(uint256 amount) external;
}
