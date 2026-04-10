// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Errors} from "../libs/Errors.sol";

/// @title WrappedTokenFactory
/// @author Trustless Universal Protocol Contributors
/// @notice Registry mapping canonical bridge routes to bridge-wrapped token addresses.
contract WrappedTokenFactory {
    /// @notice Administrator address that can register wrapped token routes.
    address public immutable ADMIN;

    /// @dev route key -> canonical wrapped token address (address(0) = unregistered)
    mapping(bytes32 routeKeyHash => address wrappedTokenAddress) private _wrappedTokens;

    /// @notice Emitted when a wrapped token is registered for a route.
    /// @param key Canonical route key.
    /// @param sourceChainId Source chain ID.
    /// @param sourceConnector Source connector address.
    /// @param sourceToken Source chain token address.
    /// @param destinationChainId Destination chain ID.
    /// @param destinationConnector Destination connector address.
    /// @param wrappedToken Wrapped token address registered for the route.
    event WrappedTokenRegistered(
        bytes32 indexed key,
        uint256 sourceChainId,
        address indexed sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address indexed destinationConnector,
        address wrappedToken
    );

    constructor() {
        ADMIN = msg.sender;
    }

    /// @notice Registers a wrapped token address for a route. Only callable by admin.
    /// @param sourceChainId Source chain ID.
    /// @param sourceConnector Source connector address.
    /// @param sourceToken Source chain token address.
    /// @param destinationChainId Destination chain ID.
    /// @param destinationConnector Destination connector address.
    /// @param wrappedToken Wrapped token address to register.
    function register(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector,
        address wrappedToken
    ) external {
        if (msg.sender != ADMIN) revert Errors.NotAdmin();
        if (wrappedToken == address(0)) revert Errors.ZeroAddress();
        bytes32 key = _key(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector);
        if (_wrappedTokens[key] != address(0)) revert Errors.RouteAlreadyRegistered(key);
        _wrappedTokens[key] = wrappedToken;
        emit WrappedTokenRegistered(
            key, sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector, wrappedToken
        );
    }

    /// @notice Returns the registered wrapped token for a route, or address(0) if unregistered.
    /// @param sourceChainId Source chain ID.
    /// @param sourceConnector Source connector address.
    /// @param sourceToken Source chain token address.
    /// @param destinationChainId Destination chain ID.
    /// @param destinationConnector Destination connector address.
    function resolve(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) external view returns (address) {
        return _wrappedTokens[
            _key(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector)
        ];
    }

    /// @notice Computes the canonical route key for external callers.
    /// @param sourceChainId Source chain ID.
    /// @param sourceConnector Source connector address.
    /// @param sourceToken Source chain token address.
    /// @param destinationChainId Destination chain ID.
    /// @param destinationConnector Destination connector address.
    function routeKey(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) external pure returns (bytes32) {
        return _key(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector);
    }

    function _key(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector)
        );
    }
}
