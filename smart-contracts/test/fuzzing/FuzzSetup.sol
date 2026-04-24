// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Connector} from "../../src/connectors/Connector.sol";
import {ConnectorStorage} from "../../src/connectors/ConnectorStorage.sol";
import {ProofOutputs} from "../../src/libs/ProofOutputs.sol";
import {RiscZeroAdapter} from "../../src/zk-proof/adapters/RiscZeroAdapter.sol";
import {SnarkAdapter} from "../../src/zk-proof/adapters/SnarkAdapter.sol";
import {MockRiscZeroVerifier} from "../mocks/MockRiscZeroVerifier.sol";
import {MockSnarkVerifier} from "../mocks/MockSnarkVerifier.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {WrappedTokenFactoryHarness} from "../mocks/WrappedTokenFactoryHarness.sol";
import {FuzzConstants} from "./util/FuzzConstants.sol";

/**
 * @title FuzzSetup
 * @notice Deploys two Connectors (origin + destination) sharing one factory and token pair.
 *         Using two separate connectors avoids txId collisions: an origin txId has
 *         DEPOSIT_LOCKED status on originConnector but NONE on destConnector, satisfying
 *         the _enforceDestinationLockPreconditions check in submitLockProof.
 *
 *         Ghost state variables shadow on-chain state so postconditions can be checked
 *         without reading every storage slot in the connectors after each call.
 */
abstract contract FuzzSetup is FuzzConstants {
    // ─── Protocol contracts ───────────────────────────────────────────────
    Connector internal _originConnector;
    Connector internal _destConnector;
    WrappedTokenFactoryHarness internal _factory;
    MockRiscZeroVerifier internal _risc0Mock;
    MockSnarkVerifier internal _snarkMock;
    RiscZeroAdapter internal _risc0Adapter;
    SnarkAdapter internal _snarkAdapter;
    MockERC20 internal _srcToken;
    MockERC20 internal _dstToken;

    // ─── Ghost: origin-side ────────────────────────────────────────────────
    bytes32[] internal _originActiveTxIds; // status == DEPOSIT_LOCKED
    bytes32[] internal _originRefundTxIds; // status == REFUND_INITIATED

    // Full tx snapshot captured at depositAndLock time (used to build proofs later)
    mapping(bytes32 txId => ConnectorStorage.CrossChainTx txData) internal _ghostOriginTxs;

    // Sum of amounts for txIds currently in DEPOSIT_LOCKED
    uint256 internal _totalOriginLocked;

    // ─── Ghost: destination-side ───────────────────────────────────────────
    bytes32[] internal _destActiveTxIds; // status == MINTED_IN_HOLDING
    bytes32[] internal _destRefundClaimTxIds; // status == REFUND_CLAIM_ACCEPTED

    // Permanent record of every txId that ever received destinationLockAccepted = true
    bytes32[] internal _tombstonedTxIds;
    mapping(bytes32 txId => bool tombstoned) internal _ghostTombstoned;

    // ─── Ghost: nonce ─────────────────────────────────────────────────────
    uint256 internal _lastSeenNonce;

    // ─── Setup ────────────────────────────────────────────────────────────

    constructor() {
        _deployInfra();
        _registerRoute();
        _fundFuzzer();
    }

    function _deployInfra() private {
        _risc0Mock = new MockRiscZeroVerifier();
        _snarkMock = new MockSnarkVerifier();
        _srcToken = new MockERC20("SrcToken", "SRC");
        _dstToken = new MockERC20("DstToken", "DST");

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = _FUZZ_IMAGE_ID;
        _risc0Adapter = new RiscZeroAdapter(address(_risc0Mock), ids);
        _snarkAdapter = new SnarkAdapter(address(_snarkMock));

        bytes32[6] memory imgIds;
        for (uint8 i = 0; i < 6; ++i) {
            imgIds[i] = _FUZZ_IMAGE_ID;
        }

        _factory = new WrappedTokenFactoryHarness();
        _originConnector =
            new Connector(address(_risc0Adapter), address(_snarkAdapter), _FUZZ_ACK_WINDOW, imgIds, address(_factory));
        _destConnector =
            new Connector(address(_risc0Adapter), address(_snarkAdapter), _FUZZ_ACK_WINDOW, imgIds, address(_factory));
    }

    function _registerRoute() private {
        // Route: _originConnector (_srcToken) → _destConnector (_dstToken), same chain
        _factory.register(
            block.chainid,
            address(_originConnector),
            address(_srcToken),
            block.chainid,
            address(_destConnector),
            address(_dstToken)
        );
    }

    function _fundFuzzer() private {
        // The Fuzz contract is both depositor and recipient; give it a large allowance.
        _srcToken.mint(address(this), _FUZZ_INITIAL_BALANCE);
        _srcToken.approve(address(_originConnector), type(uint256).max);
    }

    // ─── RISC0 proof builders (mock verifier accepts any seal) ────────────

    function _risc0Proof(bytes memory publicInputs) internal pure returns (bytes memory) {
        bytes memory seal = hex"cafe";
        bytes32 journalDigest = sha256(publicInputs);
        return abi.encode(seal, _FUZZ_IMAGE_ID, journalDigest);
    }

    function _mintProofPayload(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _ghostOriginTxs[txId];
        return _risc0Proof(abi.encode(txId, t.dstChainConnector, t.amount, t.to, t.sourceChainId, t.destinationChainId));
    }

    function _burnProofPayload(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _ghostOriginTxs[txId];
        return _risc0Proof(abi.encode(txId, t.dstChainConnector, t.amount, t.sourceChainId, t.destinationChainId));
    }

    function _nonAcceptanceProofPayload(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _ghostOriginTxs[txId];
        return _risc0Proof(abi.encode(txId, t.dstChainConnector, t.ackDeadline, t.sourceChainId, t.destinationChainId));
    }

    function _lockProofPayload(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _ghostOriginTxs[txId];
        return _risc0Proof(
            ProofOutputs.encodeLockProof(
                ProofOutputs.LockProofPublicInputs({
                    txId: txId,
                    amount: t.amount,
                    sender: t.from,
                    receiver: t.to,
                    currencyFrom: t.currencyFrom,
                    currencyTo: t.currencyTo,
                    srcChainConnector: t.srcChainConnector,
                    dstChainConnector: address(_destConnector),
                    originAckDeadline: t.ackDeadline,
                    nonce: t.nonce,
                    sourceChainId: t.sourceChainId,
                    destinationChainId: block.chainid
                })
            )
        );
    }

    function _ackProofPayload(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _destConnector.getTx(txId);
        return
            _risc0Proof(
                abi.encode(txId, t.srcChainConnector, t.dstChainConnector, t.sourceChainId, t.destinationChainId)
            );
    }

    function _refundClaimProofPayload(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _destConnector.getTx(txId);
        return _risc0Proof(abi.encode(txId, t.srcChainConnector, t.amount, t.sourceChainId, t.destinationChainId));
    }

    // ─── Ghost state helpers ───────────────────────────────────────────────

    function _recordTombstone(bytes32 txId) internal {
        if (!_ghostTombstoned[txId]) {
            _ghostTombstoned[txId] = true;
            _tombstonedTxIds.push(txId);
        }
    }

    function _removeFromArray(bytes32[] storage arr, bytes32 txId) internal {
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; ++i) {
            if (arr[i] == txId) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }
}
