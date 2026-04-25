// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IZKVerifier} from "../zk-proof/IZKVerifier.sol";
import {IERC20} from "openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../libs/Errors.sol";
import {Enums} from "../libs/Enums.sol";
import {ProofOutputs} from "../libs/ProofOutputs.sol";
import {ConnectorStorage} from "./ConnectorStorage.sol";
import {IConnector} from "./IConnector.sol";
import {IBurnableERC20} from "../tokens/interfaces/IBurnableERC20.sol";
import {IMintableERC20} from "../tokens/interfaces/IMintableERC20.sol";
import {IWrappedTokenFactory} from "../tokens/interfaces/IWrappedTokenFactory.sol";

/// @title Connector
/// @author Trustless Universal Protocol Contributors
/// @notice Cross-chain connector handling lock/mint/ack/refund flows with ZK-proof validation.
contract Connector is ConnectorStorage, IConnector, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Minimum delay between proposeVerifier and applyVerifier.
    uint64 private constant _VERIFIER_TIMELOCK = 48 hours;
    /// @dev Maximum window after the timelock opens during which applyVerifier can be called.
    ///      Forces re-proposal after 7 days, preventing a "poison pill" staged far in advance.
    uint64 private constant _VERIFIER_APPLY_WINDOW = 7 days;

    address private immutable _ADMIN;
    uint64 private immutable _ACK_WINDOW_SECONDS;
    address private immutable _WRAPPED_TOKEN_FACTORY;

    modifier requireStatus(bytes32 _txId, Enums.TxStatus _expected) {
        _requireStatus(_txId, _expected);
        _;
    }

    /// @param _risc0Adapter        Single RiscZeroAdapter allowlisting all image IDs used on this chain.
    /// @param _snarkAdapter        SnarkAdapter for SNARKJS proof routes.
    /// @param _ackWindowSeconds    Ack window duration in seconds.
    /// @param risc0RouteImageIds   Expected RISC Zero image ID per VerifierRoute (index == uint8 route).
    ///        Routes unused on this chain should be set to bytes32(0); they will never be checked.
    /// @param _wrappedTokenFactory WrappedTokenFactory that maps canonical routes to bridge-wrapped tokens.
    ///        Both depositAndLock and submitLockProof consult this registry to enforce that only
    ///        factory-registered bridge wrappers are used as destination currencies.
    /// @notice Initializes verifiers, route image IDs, and connector-wide configuration.
    constructor(
        address _risc0Adapter,
        address _snarkAdapter,
        uint64 _ackWindowSeconds,
        bytes32[6] memory risc0RouteImageIds,
        address _wrappedTokenFactory
    ) {
        if (_risc0Adapter == address(0)) revert Errors.ZeroAddress();
        if (_snarkAdapter == address(0)) revert Errors.ZeroAddress();
        if (_ackWindowSeconds == 0) revert Errors.ZeroAckWindow();
        if (_wrappedTokenFactory == address(0)) revert Errors.ZeroAddress();

        _ADMIN = msg.sender;
        _ACK_WINDOW_SECONDS = _ackWindowSeconds;
        _WRAPPED_TOKEN_FACTORY = _wrappedTokenFactory;

        uint8 numRoutes = 6;
        for (uint8 r = 0; r < numRoutes; ++r) {
            _verifiers[r][uint8(Enums.ProofType.RISC0)] = _risc0Adapter;
            _verifiers[r][uint8(Enums.ProofType.SNARKJS)] = _snarkAdapter;
            _risc0RouteImageIds[r] = risc0RouteImageIds[r];
        }
    }

    /// @inheritdoc IConnector
    function proposeVerifier(Enums.VerifierRoute _route, Enums.ProofType _proofType, address _verifier) external {
        if (msg.sender != _ADMIN) revert Errors.NotAdmin();
        if (_verifier == address(0)) revert Errors.ZeroAddress();
        uint64 availableAt = uint64(block.timestamp) + _VERIFIER_TIMELOCK;
        _pendingVerifiers[uint8(_route)][uint8(_proofType)] = _verifier;
        _pendingVerifierAvailableAt[uint8(_route)][uint8(_proofType)] = availableAt;
        emit VerifierProposed(_route, _proofType, _verifier, availableAt);
    }

    /// @inheritdoc IConnector
    function applyVerifier(Enums.VerifierRoute _route, Enums.ProofType _proofType) external {
        if (msg.sender != _ADMIN) revert Errors.NotAdmin();
        address pending = _pendingVerifiers[uint8(_route)][uint8(_proofType)];
        if (pending == address(0)) revert Errors.NoPendingVerifier(uint8(_route), uint8(_proofType));
        uint64 availableAt = _pendingVerifierAvailableAt[uint8(_route)][uint8(_proofType)];
        if (uint64(block.timestamp) < availableAt) {
            revert Errors.TimelockNotExpired(availableAt, uint64(block.timestamp));
        }
        if (uint64(block.timestamp) > availableAt + _VERIFIER_APPLY_WINDOW) {
            revert Errors.TimelockExpired(availableAt, uint64(block.timestamp));
        }
        _verifiers[uint8(_route)][uint8(_proofType)] = pending;
        delete _pendingVerifiers[uint8(_route)][uint8(_proofType)];
        delete _pendingVerifierAvailableAt[uint8(_route)][uint8(_proofType)];
        emit VerifierUpdated(_route, _proofType, pending);
    }

    /// @inheritdoc IConnector
    function proposeChainFinalityDelay(uint256 _chainId, uint64 _delaySeconds) external {
        if (msg.sender != _ADMIN) revert Errors.NotAdmin();
        uint64 availableAt = uint64(block.timestamp) + _VERIFIER_TIMELOCK;
        _pendingChainFinalityDelay[_chainId] = _delaySeconds;
        _pendingChainFinalityDelayAvailableAt[_chainId] = availableAt;
        _pendingChainFinalityDelayExists[_chainId] = true;
        emit ChainFinalityDelayProposed(_chainId, _delaySeconds, availableAt);
    }

    /// @inheritdoc IConnector
    function applyChainFinalityDelay(uint256 _chainId) external {
        if (msg.sender != _ADMIN) revert Errors.NotAdmin();
        if (!_pendingChainFinalityDelayExists[_chainId]) revert Errors.NoPendingFinalityDelay(_chainId);
        uint64 availableAt = _pendingChainFinalityDelayAvailableAt[_chainId];
        if (uint64(block.timestamp) < availableAt) {
            revert Errors.TimelockNotExpired(availableAt, uint64(block.timestamp));
        }
        if (uint64(block.timestamp) > availableAt + _VERIFIER_APPLY_WINDOW) {
            revert Errors.TimelockExpired(availableAt, uint64(block.timestamp));
        }
        uint64 pending = _pendingChainFinalityDelay[_chainId];
        _chainFinalityDelaySeconds[_chainId] = pending;
        delete _pendingChainFinalityDelay[_chainId];
        delete _pendingChainFinalityDelayAvailableAt[_chainId];
        delete _pendingChainFinalityDelayExists[_chainId];
        emit ChainFinalityDelayUpdated(_chainId, pending);
    }

    /*//////////////////////////////////////////////////////////////
                            ORIGIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IConnector
    function depositAndLock(
        address _currencyFrom,
        address _currencyTo,
        address _to,
        uint256 _amount,
        address _dstChainConnector,
        uint256 _destinationChainId
    ) external nonReentrant returns (bytes32 txId) {
        _validateDepositInputs(_currencyFrom, _currencyTo, _to, _amount, _dstChainConnector);
        _enforceWrappedTokenRoute(
            block.chainid, address(this), _currencyFrom, _destinationChainId, _dstChainConnector, _currencyTo
        );

        uint256 nonce = txNonce;
        ++txNonce;
        uint64 timestamp = uint64(block.timestamp);
        txId = _deriveOriginTxId(
            msg.sender, _to, _amount, _currencyFrom, _currencyTo, _dstChainConnector, nonce, _destinationChainId
        );

        if (txStatus[txId] != Enums.TxStatus.NONE) {
            revert Errors.TxAlreadyExists(txId);
        }

        uint256 received = _pullOriginTokens(_currencyFrom, _amount);

        _txs[txId] = CrossChainTx({
            txId: txId,
            amount: received,
            currencyFrom: _currencyFrom,
            currencyTo: _currencyTo,
            from: msg.sender,
            to: _to,
            srcChainConnector: address(this),
            dstChainConnector: _dstChainConnector,
            timestamp: timestamp,
            finalizedAt: 0,
            mintedAt: 0,
            ackDeadline: timestamp + _ACK_WINDOW_SECONDS,
            status: Enums.TxStatus.DEPOSIT_LOCKED,
            nonce: nonce,
            sourceChainId: block.chainid,
            destinationChainId: _destinationChainId
        });
        txStatus[txId] = Enums.TxStatus.DEPOSIT_LOCKED;

        _emitDepositLocked(_txs[txId]);
    }

    /// @inheritdoc IConnector
    function submitMintProof(Enums.ProofType _proofType, bytes calldata _proofPayload, bytes32 _txId)
        external
        nonReentrant
        requireStatus(_txId, Enums.TxStatus.DEPOSIT_LOCKED)
    {
        _checkRouteImageId(Enums.VerifierRoute.ORIGIN_MINT, _proofType, _proofPayload);
        // Memory snapshot so events can be emitted after storage is erased.
        CrossChainTx memory tx_ = _txs[_txId];
        if (!(block.timestamp < tx_.ackDeadline)) {
            revert Errors.AckWindowExpired(tx_.ackDeadline, uint64(block.timestamp));
        }

        _cleanupTx(_txId);

        (bytes32 commitment, bytes32 proofHash) =
            _verifyProof(Enums.VerifierRoute.ORIGIN_MINT, _proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(
            Enums.VerifierRoute.ORIGIN_MINT,
            _proofType,
            abi.encode(_txId, tx_.dstChainConnector, tx_.amount, tx_.to, tx_.sourceChainId, tx_.destinationChainId)
        );

        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        tx_.finalizedAt = uint64(block.timestamp);

        emit AckReady(
            _txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            _proofType,
            proofHash,
            commitment,
            _proofPayload
        );
        emit OriginTxClosed(
            _txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            tx_.finalizedAt
        );
    }

    /// @inheritdoc IConnector
    function initiateRefund(bytes32 _txId) external nonReentrant {
        Enums.TxStatus current = txStatus[_txId];
        CrossChainTx storage tx_ = _txs[_txId];

        if (current != Enums.TxStatus.DEPOSIT_LOCKED) {
            revert Errors.InvalidStateTransition(uint8(current), uint8(Enums.TxStatus.REFUND_INITIATED));
        }
        if (msg.sender != tx_.from) {
            revert Errors.NotTxOriginator(_txId, msg.sender, tx_.from);
        }
        if (block.timestamp < tx_.ackDeadline) {
            revert Errors.AckWindowNotExpired(tx_.ackDeadline, uint64(block.timestamp));
        }

        _setStatus(_txId, Enums.TxStatus.REFUND_INITIATED);

        emit RefundClaimed(_txId, tx_.from, tx_.amount, tx_.srcChainConnector);
    }

    /// @inheritdoc IConnector
    function submitBurnProof(Enums.ProofType _proofType, bytes calldata _proofPayload, bytes32 _txId)
        external
        nonReentrant
        requireStatus(_txId, Enums.TxStatus.REFUND_INITIATED)
    {
        _checkRouteImageId(Enums.VerifierRoute.ORIGIN_BURN, _proofType, _proofPayload);
        CrossChainTx memory tx_ = _txs[_txId];
        _cleanupTx(_txId);

        (bytes32 commitment,) = _verifyProof(Enums.VerifierRoute.ORIGIN_BURN, _proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(
            Enums.VerifierRoute.ORIGIN_BURN,
            _proofType,
            abi.encode(_txId, tx_.dstChainConnector, tx_.amount, tx_.sourceChainId, tx_.destinationChainId)
        );
        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        address refundTo = tx_.from;
        uint256 refundAmt = tx_.amount;
        address token = tx_.currencyFrom;

        tx_.finalizedAt = uint64(block.timestamp);

        IERC20(token).safeTransfer(refundTo, refundAmt);

        emit RefundExecuted(_txId, refundTo, refundAmt);
        emit OriginTxClosed(
            _txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            tx_.finalizedAt
        );
    }

    /// @inheritdoc IConnector
    function submitNonAcceptanceProof(Enums.ProofType _proofType, bytes calldata _proofPayload, bytes32 _txId)
        external
        nonReentrant
        requireStatus(_txId, Enums.TxStatus.REFUND_INITIATED)
    {
        _checkRouteImageId(Enums.VerifierRoute.ORIGIN_NON_ACCEPT, _proofType, _proofPayload);
        CrossChainTx memory tx_ = _txs[_txId];

        // Reorg-safety gate: the guest proves non-acceptance at some destination block with
        // timestamp >= ackDeadline.  For that observation to be final, enough wall time must
        // have elapsed for the destination chain's configured finality delay to cover the
        // observed block even in the worst case where its timestamp equals ackDeadline.
        _enforceFinality(tx_.destinationChainId, tx_.ackDeadline);

        _cleanupTx(_txId);

        (bytes32 commitment,) = _verifyProof(Enums.VerifierRoute.ORIGIN_NON_ACCEPT, _proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(
            Enums.VerifierRoute.ORIGIN_NON_ACCEPT,
            _proofType,
            abi.encode(_txId, tx_.dstChainConnector, tx_.ackDeadline, tx_.sourceChainId, tx_.destinationChainId)
        );
        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        address refundTo = tx_.from;
        uint256 refundAmt = tx_.amount;
        address token = tx_.currencyFrom;

        tx_.finalizedAt = uint64(block.timestamp);

        IERC20(token).safeTransfer(refundTo, refundAmt);

        emit RefundExecuted(_txId, refundTo, refundAmt);
        emit OriginTxClosed(
            _txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            tx_.finalizedAt
        );
    }

    /*//////////////////////////////////////////////////////////////
                            DESTINATION FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IConnector
    function submitLockProof(
        Enums.ProofType _proofType,
        bytes calldata _proofPayload,
        bytes32 _txId,
        uint256 _amount,
        address _currencyFrom,
        address _currencyTo,
        address _from,
        address _to,
        address _srcChainConnector,
        uint64 _originAckDeadline,
        uint256 _nonce,
        uint256 _sourceChainId
    ) external nonReentrant {
        _submitLockProofImpl(
            _proofType,
            _proofPayload,
            _txId,
            _amount,
            _currencyFrom,
            _currencyTo,
            _from,
            _to,
            _srcChainConnector,
            _originAckDeadline,
            _nonce,
            _sourceChainId
        );
    }

    /// @inheritdoc IConnector
    function submitAckProof(Enums.ProofType _proofType, bytes calldata _proofPayload, bytes32 _txId)
        external
        nonReentrant
        requireStatus(_txId, Enums.TxStatus.MINTED_IN_HOLDING)
    {
        _checkRouteImageId(Enums.VerifierRoute.DEST_ACK, _proofType, _proofPayload);
        CrossChainTx memory tx_ = _txs[_txId];
        if (!(block.timestamp < tx_.ackDeadline)) {
            revert Errors.AckWindowExpired(tx_.ackDeadline, uint64(block.timestamp));
        }
        _cleanupTx(_txId);

        bytes32 commitment;
        bytes32 proofHash;
        // Scoped block frees `expected` from the stack before the emit call.
        {
            (commitment, proofHash) = _verifyProof(Enums.VerifierRoute.DEST_ACK, _proofType, _proofPayload, _txId);
            bytes32 expected = _expectedCommitment(
                Enums.VerifierRoute.DEST_ACK,
                _proofType,
                abi.encode(
                    _txId, tx_.srcChainConnector, tx_.dstChainConnector, tx_.sourceChainId, tx_.destinationChainId
                )
            );
            if (commitment != expected) {
                revert Errors.CommitmentMismatch(commitment, expected);
            }
        }

        tx_.finalizedAt = uint64(block.timestamp);
        IERC20(tx_.currencyTo).safeTransfer(tx_.to, tx_.amount);

        // Delegate the 14-argument emit to a private function to avoid stack-too-deep
        // when forge coverage compiles without --via-ir.
        _emitAckAccepted(tx_, _proofType, proofHash, commitment, _proofPayload);
    }

    /// @inheritdoc IConnector
    function submitRefundClaimProof(Enums.ProofType _proofType, bytes calldata _proofPayload, bytes32 _txId)
        external
        nonReentrant
        requireStatus(_txId, Enums.TxStatus.MINTED_IN_HOLDING)
    {
        _checkRouteImageId(Enums.VerifierRoute.DEST_REFUND_CLAIM, _proofType, _proofPayload);
        CrossChainTx storage tx_ = _txs[_txId];

        if (block.timestamp < tx_.ackDeadline) {
            revert Errors.AckWindowNotExpired(tx_.ackDeadline, uint64(block.timestamp));
        }

        // Reorg-safety gate: the origin's `RefundClaimed` event is emitted by initiateRefund,
        // which itself requires `block.timestamp (origin) >= ackDeadline`.  Requiring this
        // destination-side observation to be at least `finalityDelay[sourceChainId]` past
        // `ackDeadline` ensures the origin block that emitted the event is finalized.
        _enforceFinality(tx_.sourceChainId, tx_.ackDeadline);

        _setStatus(_txId, Enums.TxStatus.REFUND_CLAIM_ACCEPTED);

        (bytes32 commitment, bytes32 proofHash) =
            _verifyProof(Enums.VerifierRoute.DEST_REFUND_CLAIM, _proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(
            Enums.VerifierRoute.DEST_REFUND_CLAIM,
            _proofType,
            abi.encode(_txId, tx_.srcChainConnector, tx_.amount, tx_.sourceChainId, tx_.destinationChainId)
        );
        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        emit RefundClaimAccepted(
            _txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            _proofType,
            proofHash,
            commitment,
            _proofPayload
        );
    }

    /// @inheritdoc IConnector
    function executeBurn(bytes32 _txId)
        external
        nonReentrant
        requireStatus(_txId, Enums.TxStatus.REFUND_CLAIM_ACCEPTED)
    {
        CrossChainTx memory tx_ = _txs[_txId];

        _cleanupTx(_txId);
        tx_.finalizedAt = uint64(block.timestamp);

        _burnHoldingToken(tx_.currencyTo, tx_.amount);

        emit DestTxClosed(
            _txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            tx_.finalizedAt
        );
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IConnector
    function getVerifier(Enums.VerifierRoute _route, Enums.ProofType _proofType) external view returns (address) {
        return _verifiers[uint8(_route)][uint8(_proofType)];
    }

    /// @inheritdoc IConnector
    function getPendingVerifier(Enums.VerifierRoute _route, Enums.ProofType _proofType)
        external
        view
        returns (address verifier, uint64 availableAt)
    {
        return (
            _pendingVerifiers[uint8(_route)][uint8(_proofType)],
            _pendingVerifierAvailableAt[uint8(_route)][uint8(_proofType)]
        );
    }

    /// @inheritdoc IConnector
    function getExpectedRisc0ImageId(Enums.VerifierRoute _route) external view returns (bytes32) {
        return _risc0RouteImageIds[uint8(_route)];
    }

    /// @inheritdoc IConnector
    function chainFinalityDelaySeconds(uint256 _chainId) external view returns (uint64) {
        return _chainFinalityDelaySeconds[_chainId];
    }

    /// @inheritdoc IConnector
    function getPendingChainFinalityDelay(uint256 _chainId)
        external
        view
        returns (bool exists, uint64 delaySeconds, uint64 availableAt)
    {
        return (
            _pendingChainFinalityDelayExists[_chainId],
            _pendingChainFinalityDelay[_chainId],
            _pendingChainFinalityDelayAvailableAt[_chainId]
        );
    }

    /// @notice Backwards-compatible getter for the connector admin.
    function admin() external view returns (address) {
        return _ADMIN;
    }

    /// @notice Returns the configured ACK window duration in seconds.
    function ackWindowSeconds() external view returns (uint64) {
        return _ACK_WINDOW_SECONDS;
    }

    /// @notice Returns the WrappedTokenFactory address used for destination currency validation.
    function wrappedTokenFactory() external view returns (address) {
        return _WRAPPED_TOKEN_FACTORY;
    }

    /// @notice Returns transfer data tracked by transaction identifier.
    /// @param _txId Transfer identifier.
    function getTx(bytes32 _txId) external view returns (CrossChainTx memory) {
        return _txs[_txId];
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @dev Mints wrapped tokens into this connector during submitLockProof.
    ///      Virtual so Certora harness can override with a concrete token type,
    ///      avoiding opaque interface calls under solc --via-ir.
    function _mintHoldingToken(address _currencyTo, uint256 _amount) internal virtual {
        IMintableERC20(_currencyTo).mint(address(this), _amount);
    }

    /// @dev Burns wrapped tokens held by this connector during executeBurn.
    ///      Virtual so Certora harness can override with a concrete token type,
    ///      avoiding opaque interface calls under solc --via-ir.
    function _burnHoldingToken(address _currencyTo, uint256 _amount) internal virtual {
        IBurnableERC20(_currencyTo).burn(_amount);
    }

    function _expectedCommitment(Enums.VerifierRoute _route, Enums.ProofType _proofType, bytes memory _publicInputs)
        internal
        virtual
        returns (bytes32)
    {
        address verifier = _verifiers[uint8(_route)][uint8(_proofType)];
        if (verifier == address(0)) revert Errors.VerifierNotRegistered(uint8(_proofType));
        return IZKVerifier(verifier).computeCommitment(_publicInputs);
    }

    function _cleanupTx(bytes32 _txId) internal {
        if (txStatus[_txId] == Enums.TxStatus.NONE) {
            revert Errors.TxNotFound(_txId);
        }

        delete _txs[_txId];
        delete txStatus[_txId];
    }

    function _pullOriginTokens(address _currencyFrom, uint256 _amount) internal virtual returns (uint256 received) {
        uint256 balanceBefore = IERC20(_currencyFrom).balanceOf(address(this));
        IERC20(_currencyFrom).safeTransferFrom(msg.sender, address(this), _amount);
        received = IERC20(_currencyFrom).balanceOf(address(this)) - balanceBefore;
        if (received < 1) revert Errors.ZeroAmount();
    }

    function _enforceWrappedTokenRoute(
        uint256 _sourceChainId,
        address _sourceConnector,
        address _sourceToken,
        uint256 _destinationChainId,
        address _destinationConnector,
        address _currencyTo
    ) internal virtual {
        bytes32 routeKey = IWrappedTokenFactory(_WRAPPED_TOKEN_FACTORY)
            .routeKey(_sourceChainId, _sourceConnector, _sourceToken, _destinationChainId, _destinationConnector);
        address expectedWrapped = IWrappedTokenFactory(_WRAPPED_TOKEN_FACTORY)
            .resolve(_sourceChainId, _sourceConnector, _sourceToken, _destinationChainId, _destinationConnector);
        if (expectedWrapped == address(0)) revert Errors.WrappedTokenNotRegistered(routeKey);
        if (_currencyTo != expectedWrapped) revert Errors.WrappedTokenMismatch(_currencyTo, expectedWrapped);
    }

    function _verifyProof(
        Enums.VerifierRoute _route,
        Enums.ProofType _proofType,
        bytes memory _proofPayload,
        bytes32 _txId
    ) internal virtual returns (bytes32 commitment, bytes32 proofHash) {
        proofHash = keccak256(_proofPayload);

        address verifier = _verifiers[uint8(_route)][uint8(_proofType)];
        if (verifier == address(0)) revert Errors.VerifierNotRegistered(uint8(_proofType));

        commitment = IZKVerifier(verifier).verify(_proofPayload);

        emit ProofVerified(_txId, _proofType, proofHash, commitment, _proofPayload);
    }

    function _submitLockProofImpl(
        Enums.ProofType _proofType,
        bytes memory _proofPayload,
        bytes32 _txId,
        uint256 _amount,
        address _currencyFrom,
        address _currencyTo,
        address _from,
        address _to,
        address _srcChainConnector,
        uint64 _originAckDeadline,
        uint256 _nonce,
        uint256 _sourceChainId
    ) private {
        _checkRouteImageId(Enums.VerifierRoute.DEST_LOCK, _proofType, _proofPayload);
        _enforceDestinationLockPreconditions(_txId, _originAckDeadline);
        _enforceWrappedTokenRoute(
            _sourceChainId, _srcChainConnector, _currencyFrom, block.chainid, address(this), _currencyTo
        );

        destinationLockAccepted[_txId] = true;
        _recordDestinationLockTx(
            _txId,
            _amount,
            _currencyFrom,
            _currencyTo,
            _from,
            _to,
            _srcChainConnector,
            _originAckDeadline,
            _nonce,
            _sourceChainId,
            uint64(block.timestamp)
        );

        (bytes32 commitment, bytes32 proofHash) =
            _verifyProof(Enums.VerifierRoute.DEST_LOCK, _proofType, _proofPayload, _txId);
        {
            bytes32 expected = _expectedDestinationLockCommitment(
                _proofType,
                _txId,
                _amount,
                _currencyFrom,
                _currencyTo,
                _from,
                _to,
                _srcChainConnector,
                _originAckDeadline,
                _nonce,
                _sourceChainId
            );
            if (commitment != expected) {
                revert Errors.CommitmentMismatch(commitment, expected);
            }
        }

        _mintHoldingToken(_currencyTo, _amount);
        _emitFundsReleased(
            _proofType,
            _proofPayload,
            _txId,
            _amount,
            _currencyFrom,
            _currencyTo,
            _from,
            _to,
            _srcChainConnector,
            uint64(block.timestamp),
            proofHash,
            commitment
        );
    }

    function _deriveOriginTxId(
        address _from,
        address _to,
        uint256 _amount,
        address _currencyFrom,
        address _currencyTo,
        address _dstChainConnector,
        uint256 _nonce,
        uint256 _destinationChainId
    ) private returns (bytes32) {
        return keccak256(
            abi.encode(
                _from,
                _to,
                _amount,
                _currencyFrom,
                _currencyTo,
                address(this),
                _dstChainConnector,
                _nonce,
                block.chainid,
                _destinationChainId
            )
        );
    }

    function _validateDepositInputs(
        address _currencyFrom,
        address _currencyTo,
        address _to,
        uint256 _amount,
        address _dstChainConnector
    ) private {
        if (_amount == 0) revert Errors.ZeroAmount();
        if (_to == address(0)) revert Errors.ZeroAddress();
        if (_currencyFrom == address(0)) revert Errors.ZeroAddress();
        if (_currencyTo == address(0)) revert Errors.ZeroAddress();
        if (_dstChainConnector == address(0)) revert Errors.ZeroAddress();
    }

    function _emitDepositLocked(CrossChainTx memory tx_) private {
        emit DepositLocked(
            tx_.txId,
            tx_.from,
            tx_.to,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            tx_.ackDeadline,
            tx_.nonce,
            tx_.sourceChainId,
            tx_.destinationChainId
        );
    }

    function _recordDestinationLockTx(
        bytes32 _txId,
        uint256 _amount,
        address _currencyFrom,
        address _currencyTo,
        address _from,
        address _to,
        address _srcChainConnector,
        uint64 _originAckDeadline,
        uint256 _nonce,
        uint256 _sourceChainId,
        uint64 _timestamp
    ) private {
        _txs[_txId] = CrossChainTx({
            txId: _txId,
            amount: _amount,
            currencyFrom: _currencyFrom,
            currencyTo: _currencyTo,
            from: _from,
            to: _to,
            srcChainConnector: _srcChainConnector,
            dstChainConnector: address(this),
            timestamp: _timestamp,
            finalizedAt: 0,
            mintedAt: _timestamp,
            ackDeadline: _originAckDeadline,
            status: Enums.TxStatus.MINTED_IN_HOLDING,
            nonce: _nonce,
            sourceChainId: _sourceChainId,
            destinationChainId: block.chainid
        });
        txStatus[_txId] = Enums.TxStatus.MINTED_IN_HOLDING;
    }

    function _emitFundsReleased(
        Enums.ProofType _proofType,
        bytes memory _proofPayload,
        bytes32 _txId,
        uint256 _amount,
        address _currencyFrom,
        address _currencyTo,
        address _from,
        address _to,
        address _srcChainConnector,
        uint64 _timestamp,
        bytes32 _proofHash,
        bytes32 _commitment
    ) private {
        emit FundsReleased(
            _txId,
            _amount,
            _currencyFrom,
            _currencyTo,
            _from,
            _to,
            _srcChainConnector,
            address(this),
            _timestamp,
            _proofType,
            _proofHash,
            _commitment,
            _proofPayload
        );
    }

    function _emitAckAccepted(
        CrossChainTx memory tx_,
        Enums.ProofType proofType,
        bytes32 proofHash,
        bytes32 commitment,
        bytes calldata proofPayload
    ) private {
        emit AckAccepted(
            tx_.txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp,
            proofType,
            proofHash,
            commitment,
            proofPayload,
            tx_.finalizedAt
        );
    }

    /// @dev For RISC0 proofs, asserts that the imageId embedded in the payload matches
    ///      the expected imageId stored for this route. Reverts with ImageIdRouteMismatch on mismatch.
    ///      No-op for non-RISC0 proof types.
    function _checkRouteImageId(Enums.VerifierRoute _route, Enums.ProofType _proofType, bytes memory _proofPayload)
        private
    {
        if (_proofType != Enums.ProofType.RISC0) return;
        (, bytes32 proofImageId,) = abi.decode(_proofPayload, (bytes, bytes32, bytes32));
        bytes32 expected = _risc0RouteImageIds[uint8(_route)];
        if (proofImageId != expected) {
            revert Errors.ImageIdRouteMismatch(uint8(_route), proofImageId, expected);
        }
    }

    function _requireStatus(bytes32 _txId, Enums.TxStatus _expected) private {
        if (txStatus[_txId] != _expected) {
            revert Errors.InvalidStateTransition(uint8(txStatus[_txId]), uint8(_expected));
        }
    }

    function _setStatus(bytes32 _txId, Enums.TxStatus _s) private {
        txStatus[_txId] = _s;
        _txs[_txId].status = _s;
    }

    function _enforceDestinationLockPreconditions(bytes32 _txId, uint64 _originAckDeadline) private {
        if (destinationLockAccepted[_txId]) revert Errors.DestinationLockAlreadyAccepted(_txId);
        if (txStatus[_txId] != Enums.TxStatus.NONE) revert Errors.TxAlreadyExists(_txId);
        if (!(block.timestamp < _originAckDeadline)) {
            revert Errors.AckWindowExpired(_originAckDeadline, uint64(block.timestamp));
        }
    }

    function _expectedDestinationLockCommitment(
        Enums.ProofType _proofType,
        bytes32 _txId,
        uint256 _amount,
        address _currencyFrom,
        address _currencyTo,
        address _from,
        address _to,
        address _srcChainConnector,
        uint64 _originAckDeadline,
        uint256 _nonce,
        uint256 _sourceChainId
    ) private returns (bytes32) {
        return _expectedCommitment(
            Enums.VerifierRoute.DEST_LOCK,
            _proofType,
            ProofOutputs.encodeLockProof(
                ProofOutputs.LockProofPublicInputs({
                    txId: _txId,
                    amount: _amount,
                    sender: _from,
                    receiver: _to,
                    currencyFrom: _currencyFrom,
                    currencyTo: _currencyTo,
                    srcChainConnector: _srcChainConnector,
                    dstChainConnector: address(this),
                    originAckDeadline: _originAckDeadline,
                    nonce: _nonce,
                    sourceChainId: _sourceChainId,
                    destinationChainId: block.chainid
                })
            )
        );
    }

    /// @dev Reverts unless `block.timestamp >= _earliestRemoteObservation + finalityDelay[_remoteChainId]`.
    ///      `_earliestRemoteObservation` is the lowest timestamp the guest proof could have been
    ///      taken against — typically `ackDeadline`, which the guest already enforces as a lower
    ///      bound on the observed remote block's timestamp.
    ///      When no finality delay is configured for the chain (default 0) this is a no-op.
    function _enforceFinality(uint256 _remoteChainId, uint64 _earliestRemoteObservation) private view {
        uint64 delay = _chainFinalityDelaySeconds[_remoteChainId];
        if (delay == 0) return;
        uint64 earliestAllowedAt = _earliestRemoteObservation + delay;
        if (uint64(block.timestamp) < earliestAllowedAt) {
            revert Errors.FinalityNotReached(_remoteChainId, earliestAllowedAt, uint64(block.timestamp));
        }
    }
}
