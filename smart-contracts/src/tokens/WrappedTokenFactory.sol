// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Errors} from "../libs/Errors.sol";

/// @title WrappedTokenFactory
/// @author Trustless Universal Protocol Contributors
/// @notice Registry mapping canonical bridge routes to bridge-wrapped token addresses.
///         Route registration uses a two-step propose/apply pattern with a 48-hour timelock,
///         matching the verifier timelock in Connector, so users have time to exit before
///         a new (potentially malicious) wrapped token becomes active on a route.
contract WrappedTokenFactory {
    /// @notice Administrator address that can register wrapped token routes.
    address public immutable ADMIN;

    /// @notice Timelock duration (seconds) between proposeRoute and applyRoute.
    ///         Set to 0 for instant registration (e.g. initial deployment before any users).
    uint64 public immutable REGISTRATION_TIMELOCK;

    /// @dev route key -> canonical wrapped token address (address(0) = unregistered)
    mapping(bytes32 routeKeyHash => address wrappedTokenAddress) private _wrappedTokens;

    /// @dev route key -> pending wrapped token (address(0) = no pending proposal)
    mapping(bytes32 routeKeyHash => address pendingWrappedToken) private _pendingWrappedTokens;

    /// @dev route key -> earliest timestamp at which applyRoute may be called
    mapping(bytes32 routeKeyHash => uint64 availableAt) private _pendingAvailableAt;

    /// @notice Emitted when a route registration is proposed.
    /// @param key                  Canonical route key hash.
    /// @param sourceChainId        Chain ID of the source connector.
    /// @param sourceConnector      Connector address on the source chain.
    /// @param sourceToken          Token address on the source chain.
    /// @param destinationChainId   Chain ID of the destination connector.
    /// @param destinationConnector Connector address on the destination chain.
    /// @param wrappedToken         Proposed wrapped-token address on the destination chain.
    /// @param availableAt          Earliest timestamp at which applyRoute may be called.
    event WrappedTokenProposed(
        bytes32 indexed key,
        uint256 sourceChainId,
        address indexed sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address indexed destinationConnector,
        address wrappedToken,
        uint64 availableAt
    );

    /// @notice Emitted when a proposed route registration is applied.
    /// @param key                  Canonical route key hash.
    /// @param sourceChainId        Chain ID of the source connector.
    /// @param sourceConnector      Connector address on the source chain.
    /// @param sourceToken          Token address on the source chain.
    /// @param destinationChainId   Chain ID of the destination connector.
    /// @param destinationConnector Connector address on the destination chain.
    /// @param wrappedToken         Registered wrapped-token address on the destination chain.
    event WrappedTokenRegistered(
        bytes32 indexed key,
        uint256 sourceChainId,
        address indexed sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address indexed destinationConnector,
        address wrappedToken
    );

    /// @notice Deploys the factory.
    /// @param registrationTimelock_ Seconds between proposeRoute and applyRoute.
    ///        Pass 0 for instant registration (safe for initial deployment when no users exist yet).
    ///        Pass 172800 (48 hours) for live production where existing users need time to exit.
    constructor(uint64 registrationTimelock_) {
        ADMIN = msg.sender;
        REGISTRATION_TIMELOCK = registrationTimelock_;
    }

    /// @notice Returns the registered wrapped token for a route, or address(0) if unregistered.
    /// @param sourceChainId        Chain ID of the source connector.
    /// @param sourceConnector      Connector address on the source chain.
    /// @param sourceToken          Token address on the source chain.
    /// @param destinationChainId   Chain ID of the destination connector.
    /// @param destinationConnector Connector address on the destination chain.
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
    /// @param sourceChainId        Chain ID of the source connector.
    /// @param sourceConnector      Connector address on the source chain.
    /// @param sourceToken          Token address on the source chain.
    /// @param destinationChainId   Chain ID of the destination connector.
    /// @param destinationConnector Connector address on the destination chain.
    function routeKey(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) external pure returns (bytes32) {
        return _key(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector);
    }

    /// @notice Proposes a wrapped token for a route. Callable only by admin.
    ///         Must wait _registrationTimelock() seconds before calling applyRoute.
    /// @param sourceChainId        Chain ID of the source connector.
    /// @param sourceConnector      Connector address on the source chain.
    /// @param sourceToken          Token address on the source chain.
    /// @param destinationChainId   Chain ID of the destination connector.
    /// @param destinationConnector Connector address on the destination chain.
    /// @param wrappedToken         Wrapped-token address to register for this route.
    function proposeRoute(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector,
        address wrappedToken
    ) public {
        if (msg.sender != ADMIN) revert Errors.NotAdmin();
        if (wrappedToken == address(0)) revert Errors.ZeroAddress();
        bytes32 key = _key(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector);
        if (_wrappedTokens[key] != address(0)) revert Errors.RouteAlreadyRegistered(key);
        uint64 availableAt = uint64(block.timestamp) + _registrationTimelock();
        _pendingWrappedTokens[key] = wrappedToken;
        _pendingAvailableAt[key] = availableAt;
        emit WrappedTokenProposed(
            key,
            sourceChainId,
            sourceConnector,
            sourceToken,
            destinationChainId,
            destinationConnector,
            wrappedToken,
            availableAt
        );
    }

    /// @notice Applies a previously proposed route registration after the timelock elapses.
    ///         Callable only by admin.
    /// @param sourceChainId        Chain ID of the source connector.
    /// @param sourceConnector      Connector address on the source chain.
    /// @param sourceToken          Token address on the source chain.
    /// @param destinationChainId   Chain ID of the destination connector.
    /// @param destinationConnector Connector address on the destination chain.
    function applyRoute(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) public {
        if (msg.sender != ADMIN) revert Errors.NotAdmin();
        bytes32 key = _key(sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector);
        address pending = _pendingWrappedTokens[key];
        if (pending == address(0)) revert Errors.NoPendingRoute(key);
        uint64 availableAt = _pendingAvailableAt[key];
        if (uint64(block.timestamp) < availableAt) {
            revert Errors.TimelockNotExpired(availableAt, uint64(block.timestamp));
        }
        _wrappedTokens[key] = pending;
        delete _pendingWrappedTokens[key];
        delete _pendingAvailableAt[key];
        emit WrappedTokenRegistered(
            key, sourceChainId, sourceConnector, sourceToken, destinationChainId, destinationConnector, pending
        );
    }

    function _registrationTimelock() internal virtual returns (uint64) {
        return REGISTRATION_TIMELOCK;
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
