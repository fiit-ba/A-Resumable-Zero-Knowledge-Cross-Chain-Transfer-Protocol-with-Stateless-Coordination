// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title IWrappedTokenFactory
/// @author Trustless Universal Protocol Contributors
/// @notice Interface for canonical route-to-wrapped-token registry.
interface IWrappedTokenFactory {
    /// @notice Resolves the wrapped token configured for a canonical route.
    /// @param sourceChainId Source chain ID.
    /// @param sourceConnector Source connector address.
    /// @param sourceToken Source token address.
    /// @param destinationChainId Destination chain ID.
    /// @param destinationConnector Destination connector address.
    function resolve(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) external view returns (address);

    /// @notice Computes the canonical route key used by the factory registry.
    /// @param sourceChainId Source chain ID.
    /// @param sourceConnector Source connector address.
    /// @param sourceToken Source token address.
    /// @param destinationChainId Destination chain ID.
    /// @param destinationConnector Destination connector address.
    function routeKey(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) external pure returns (bytes32);
}
