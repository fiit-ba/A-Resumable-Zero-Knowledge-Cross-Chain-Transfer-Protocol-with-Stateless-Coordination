// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC20} from "openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Errors} from "../libs/Errors.sol";

/// @title BridgeWrappedToken
/// @author Trustless Universal Protocol Contributors
/// @notice ERC-20 whose mint and burn are exclusively controlled by the registered bridge connector.
///         Prevents arbitrary third-party tokens from being minted or burned through the bridge:
///         only a connector that was named at deployment time may call mint or burn.
contract BridgeWrappedToken is ERC20 {
    /// @notice Connector address that is allowed to mint and burn this wrapped token.
    address public immutable CONNECTOR;

    constructor(string memory name_, string memory symbol_, address connector_) ERC20(name_, symbol_) {
        if (connector_ == address(0)) revert Errors.ZeroAddress();
        CONNECTOR = connector_;
    }

    /// @notice Mints `amount` tokens to `to`. Only callable by the registered connector.
    /// @param to Recipient address for minted tokens.
    /// @param amount Token amount to mint.
    function mint(address to, uint256 amount) external {
        if (msg.sender != CONNECTOR) revert Errors.NotAdmin();
        _mint(to, amount);
    }

    /// @notice Burns `amount` tokens from the caller (the connector).
    ///         Only callable by the registered connector.
    /// @param amount Token amount to burn.
    function burn(uint256 amount) external {
        if (msg.sender != CONNECTOR) revert Errors.NotAdmin();
        _burn(msg.sender, amount);
    }
}
