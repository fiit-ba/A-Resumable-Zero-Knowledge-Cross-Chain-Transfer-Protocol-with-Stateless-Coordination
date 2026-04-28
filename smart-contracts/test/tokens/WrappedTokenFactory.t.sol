// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {Errors} from "../../src/libs/Errors.sol";
import {WrappedTokenFactory} from "../../src/tokens/WrappedTokenFactory.sol";

contract WrappedTokenFactoryTest is Test {
    uint256 internal constant _SOURCE_CHAIN_ID = 11_155_111;
    uint256 internal constant _DESTINATION_CHAIN_ID = 10_200;
    uint64 internal constant _TIMELOCK = 2 days;

    address internal constant _NON_ADMIN = address(0xA11CE);
    address internal constant _SOURCE_CONNECTOR = address(0x5EC);
    address internal constant _SOURCE_TOKEN = address(0x70C);
    address internal constant _DESTINATION_CONNECTOR = address(0xD57);
    address internal constant _WRAPPED_TOKEN = address(0xBEEF);
    address internal constant _OTHER_WRAPPED_TOKEN = address(0xCAFE);

    WrappedTokenFactory internal factory;

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

    event WrappedTokenRegistered(
        bytes32 indexed key,
        uint256 sourceChainId,
        address indexed sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address indexed destinationConnector,
        address wrappedToken
    );

    function setUp() public {
        factory = new WrappedTokenFactory(_TIMELOCK);
    }

    function test_constructor_SetsAdminAndTimelock() public view {
        assertEq(factory.ADMIN(), address(this));
        assertEq(factory.REGISTRATION_TIMELOCK(), _TIMELOCK);
    }

    function test_routeKey_MatchesCanonicalEncoding() public view {
        bytes32 expected = keccak256(
            abi.encode(
                _SOURCE_CHAIN_ID, _SOURCE_CONNECTOR, _SOURCE_TOKEN, _DESTINATION_CHAIN_ID, _DESTINATION_CONNECTOR
            )
        );

        assertEq(_routeKey(), expected);
    }

    function test_resolve_ReturnsZeroForUnregisteredRoute() public view {
        assertEq(_resolve(), address(0));
    }

    function test_proposeRoute_EmitsProposalWithTimelock() public {
        vm.warp(1_700_000_000);
        bytes32 key = _routeKey();
        uint64 availableAt = uint64(block.timestamp) + _TIMELOCK;

        vm.expectEmit(true, true, true, true, address(factory));
        emit WrappedTokenProposed(
            key,
            _SOURCE_CHAIN_ID,
            _SOURCE_CONNECTOR,
            _SOURCE_TOKEN,
            _DESTINATION_CHAIN_ID,
            _DESTINATION_CONNECTOR,
            _WRAPPED_TOKEN,
            availableAt
        );

        _propose(_WRAPPED_TOKEN);
    }

    function test_applyRoute_RevertsWhen_NotAdmin() public {
        _propose(_WRAPPED_TOKEN);

        vm.prank(_NON_ADMIN);
        vm.expectRevert(Errors.NotAdmin.selector);
        _apply();
    }

    function test_applyRoute_RevertsWhen_NoPendingRoute() public {
        bytes32 key = _routeKey();

        vm.expectRevert(abi.encodeWithSelector(Errors.NoPendingRoute.selector, key));
        _apply();
    }

    function test_applyRoute_RevertsWhen_TimelockNotExpired() public {
        vm.warp(1_700_000_000);
        _propose(_WRAPPED_TOKEN);
        uint64 availableAt = uint64(block.timestamp) + _TIMELOCK;

        uint64 currentTime = availableAt - 1;
        vm.warp(currentTime);
        vm.expectRevert(abi.encodeWithSelector(Errors.TimelockNotExpired.selector, availableAt, currentTime));
        _apply();

        assertEq(_resolve(), address(0));
    }

    function test_applyRoute_RegistersWrappedTokenAfterTimelock() public {
        vm.warp(1_700_000_000);
        _propose(_WRAPPED_TOKEN);
        vm.warp(block.timestamp + _TIMELOCK);
        bytes32 key = _routeKey();

        vm.expectEmit(true, true, true, true, address(factory));
        emit WrappedTokenRegistered(
            key,
            _SOURCE_CHAIN_ID,
            _SOURCE_CONNECTOR,
            _SOURCE_TOKEN,
            _DESTINATION_CHAIN_ID,
            _DESTINATION_CONNECTOR,
            _WRAPPED_TOKEN
        );

        _apply();

        assertEq(_resolve(), _WRAPPED_TOKEN);
        vm.expectRevert(abi.encodeWithSelector(Errors.NoPendingRoute.selector, key));
        _apply();
    }

    function test_proposeRoute_RevertsWhen_NotAdmin() public {
        vm.prank(_NON_ADMIN);
        vm.expectRevert(Errors.NotAdmin.selector);
        _propose(_WRAPPED_TOKEN);
    }

    function test_proposeRoute_RevertsWhen_WrappedTokenZero() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        _propose(address(0));
    }

    function test_proposeRoute_RevertsWhen_RouteAlreadyRegistered() public {
        _propose(_WRAPPED_TOKEN);
        vm.warp(block.timestamp + _TIMELOCK);
        _apply();
        bytes32 key = _routeKey();

        vm.expectRevert(abi.encodeWithSelector(Errors.RouteAlreadyRegistered.selector, key));
        _propose(_OTHER_WRAPPED_TOKEN);
    }

    function test_zeroTimelock_AllowsImmediateRegistration() public {
        WrappedTokenFactory immediateFactory = new WrappedTokenFactory(0);
        immediateFactory.proposeRoute(
            _SOURCE_CHAIN_ID,
            _SOURCE_CONNECTOR,
            _SOURCE_TOKEN,
            _DESTINATION_CHAIN_ID,
            _DESTINATION_CONNECTOR,
            _WRAPPED_TOKEN
        );
        immediateFactory.applyRoute(
            _SOURCE_CHAIN_ID, _SOURCE_CONNECTOR, _SOURCE_TOKEN, _DESTINATION_CHAIN_ID, _DESTINATION_CONNECTOR
        );

        assertEq(
            immediateFactory.resolve(
                _SOURCE_CHAIN_ID, _SOURCE_CONNECTOR, _SOURCE_TOKEN, _DESTINATION_CHAIN_ID, _DESTINATION_CONNECTOR
            ),
            _WRAPPED_TOKEN
        );
    }

    function _propose(address wrappedToken) internal {
        factory.proposeRoute(
            _SOURCE_CHAIN_ID,
            _SOURCE_CONNECTOR,
            _SOURCE_TOKEN,
            _DESTINATION_CHAIN_ID,
            _DESTINATION_CONNECTOR,
            wrappedToken
        );
    }

    function _apply() internal {
        factory.applyRoute(
            _SOURCE_CHAIN_ID, _SOURCE_CONNECTOR, _SOURCE_TOKEN, _DESTINATION_CHAIN_ID, _DESTINATION_CONNECTOR
        );
    }

    function _resolve() internal view returns (address) {
        return factory.resolve(
            _SOURCE_CHAIN_ID, _SOURCE_CONNECTOR, _SOURCE_TOKEN, _DESTINATION_CHAIN_ID, _DESTINATION_CONNECTOR
        );
    }

    function _routeKey() internal view returns (bytes32) {
        return factory.routeKey(
            _SOURCE_CHAIN_ID, _SOURCE_CONNECTOR, _SOURCE_TOKEN, _DESTINATION_CHAIN_ID, _DESTINATION_CONNECTOR
        );
    }
}
