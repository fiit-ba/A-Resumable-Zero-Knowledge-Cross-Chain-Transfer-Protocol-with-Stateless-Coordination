// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IMintableERC20
/// @author Trustless Universal Protocol Contributors
/// @notice Interface for bridge-wrapped ERC20 tokens mintable by the connector.
interface IMintableERC20 {
    /// @notice Mints a token amount to a recipient.
    /// @param to Recipient of minted tokens.
    /// @param amount Token amount to mint.
    function mint(address to, uint256 amount) external;
}
