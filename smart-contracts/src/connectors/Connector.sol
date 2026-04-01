// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IZKVerifier} from "../zk-proof/IZKVerifier.sol";
import {IERC20} from "openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../libs/Errors.sol";
import {Enums} from "../libs/Enums.sol";
import {ProofOutputs} from "../libs/ProofOutputs.sol";
import {ConnectorStorage} from "./ConnectorStorage.sol";
import {IConnector} from "./IConnector.sol";

interface IBurnableERC20 {
    function burn(uint256 amount) external;
}

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

contract Connector is ConnectorStorage, IConnector, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private immutable ADMIN;
    uint64 private immutable ACK_WINDOW_SECONDS;

    /// @param _risc0Adapter   Single RiscZeroAdapter allowlisting all image IDs used on this chain.
    /// @param _snarkAdapter   SnarkAdapter for SNARKJS proof routes.
    /// @param _ackWindowSeconds  Ack window duration in seconds.
    /// @param risc0RouteImageIds  Expected RISC Zero image ID per VerifierRoute (index == uint8 route).
    ///        Routes unused on this chain should be set to bytes32(0); they will never be checked.
    constructor(
        address _risc0Adapter,
        address _snarkAdapter,
        uint64 _ackWindowSeconds,
        bytes32[5] memory risc0RouteImageIds
    ) {
        if (_risc0Adapter == address(0)) revert Errors.ZeroAddress();
        if (_snarkAdapter == address(0)) revert Errors.ZeroAddress();
        if (_ackWindowSeconds == 0) revert Errors.ZeroAckWindow();

        ADMIN = msg.sender;
        ACK_WINDOW_SECONDS = _ackWindowSeconds;

        // Seed every route with the same default adapters so existing flows
        // work out of the box without an explicit setVerifier call.
        uint8 numRoutes = 5;
        for (uint8 r = 0; r < numRoutes; r++) {
            _verifiers[r][uint8(Enums.ProofType.RISC0)] = _risc0Adapter;
            _verifiers[r][uint8(Enums.ProofType.SNARKJS)] = _snarkAdapter;
            _risc0RouteImageIds[r] = risc0RouteImageIds[r];
        }
    }

    modifier requireStatus(bytes32 _txId, Enums.TxStatus _expected) {
        _requireStatus(_txId, _expected);
        _;
    }

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    /// @notice Backwards-compatible getter for the connector admin.
    function admin() external view returns (address) {
        return ADMIN;
    }

    /// @notice Returns the configured ACK window duration in seconds.
    function ackWindowSeconds() external view returns (uint64) {
        return ACK_WINDOW_SECONDS;
    }

    function _onlyAdmin() internal view {
        if (msg.sender != ADMIN) revert Errors.NotAdmin();
    }

    /// @inheritdoc IConnector
    function setVerifier(Enums.VerifierRoute _route, Enums.ProofType _proofType, address _verifier) external onlyAdmin {
        if (_verifier == address(0)) revert Errors.ZeroAddress();
        _verifiers[uint8(_route)][uint8(_proofType)] = _verifier;
        emit VerifierUpdated(_route, _proofType, _verifier);
    }

    /// @inheritdoc IConnector
    function getVerifier(Enums.VerifierRoute _route, Enums.ProofType _proofType) external view returns (address) {
        return _verifiers[uint8(_route)][uint8(_proofType)];
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
        if (_amount == 0) revert Errors.ZeroAmount();
        if (_to == address(0)) revert Errors.ZeroAddress();
        if (_currencyFrom == address(0)) revert Errors.ZeroAddress();
        if (_currencyTo == address(0)) revert Errors.ZeroAddress();
        if (_dstChainConnector == address(0)) revert Errors.ZeroAddress();
        uint256 nonce = txNonce++;

        txId = keccak256(
            abi.encode(
                msg.sender,
                _to,
                _amount,
                _currencyFrom,
                _currencyTo,
                address(this),
                _dstChainConnector,
                nonce,
                block.chainid,
                _destinationChainId
            )
        );

        if (txStatus[txId] != Enums.TxStatus.NONE) {
            revert Errors.TxAlreadyExists(txId);
        }

        uint256 balanceBefore = IERC20(_currencyFrom).balanceOf(address(this));
        IERC20(_currencyFrom).safeTransferFrom(msg.sender, address(this), _amount);
        uint256 received = IERC20(_currencyFrom).balanceOf(address(this)) - balanceBefore;
        if (received < 1) revert Errors.ZeroAmount();

        _txs[txId] = CrossChainTx({
            txId: txId,
            amount: received,
            currencyFrom: _currencyFrom,
            currencyTo: _currencyTo,
            from: msg.sender,
            to: _to,
            srcChainConnector: address(this),
            dstChainConnector: _dstChainConnector,
            timestamp: uint64(block.timestamp),
            finalizedAt: 0,
            mintedAt: 0,
            ackDeadline: uint64(block.timestamp) + ACK_WINDOW_SECONDS,
            status: Enums.TxStatus.DEPOSIT_LOCKED,
            nonce: nonce,
            sourceChainId: block.chainid,
            destinationChainId: _destinationChainId
        });
        txStatus[txId] = Enums.TxStatus.DEPOSIT_LOCKED;

        emit DepositLocked(
            txId,
            msg.sender,
            _to,
            received,
            _currencyFrom,
            _currencyTo,
            address(this),
            _dstChainConnector,
            uint64(block.timestamp),
            nonce,
            block.chainid,
            _destinationChainId
        );
    }

    /// @inheritdoc IConnector
    function getExpectedRisc0ImageId(Enums.VerifierRoute _route) external view returns (bytes32) {
        return _risc0RouteImageIds[uint8(_route)];
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
        if (block.timestamp >= tx_.ackDeadline) {
            revert Errors.AckWindowExpired(tx_.ackDeadline, uint64(block.timestamp));
        }

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

        _cleanupTx(_txId);

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
            tx_.timestamp
        );
    }

    /// @inheritdoc IConnector
    function initiateRefund(bytes32 _txId) external nonReentrant {
        Enums.TxStatus current = txStatus[_txId];
        CrossChainTx storage tx_ = _txs[_txId];

        // Spec note — Figure 4 vs. page 8 conflict:
        //   Figure 4 depicts a "No ACK event" refund flow that begins AFTER the mint proof
        //   arrives on origin, implying initiateRefund should be callable from
        //   MINT_PROOF_ACCEPTED once ackDeadline expires.
        //   Page 8 text, however, states: "Once the mint proof is received, the dispute
        //   mechanism on the origin connector is disabled." We follow page 8: submitMintProof
        //   erases origin storage immediately (MINT_PROOF_ACCEPTED state never persists), so
        //   this function can only be reached while the tx is still in DEPOSIT_LOCKED. Users
        //   who experience transient client downtime after a successful mint should submit the
        //   ACK proof instead — submitAckProof has no hard deadline (see HIGH-3 fix).
        if (current != Enums.TxStatus.DEPOSIT_LOCKED) {
            revert Errors.InvalidStateTransition(uint8(current), uint8(Enums.TxStatus.REFUND_INITIATED));
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

        _cleanupTx(_txId);

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
            tx_.timestamp
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
        _checkRouteImageId(Enums.VerifierRoute.DEST_LOCK, _proofType, _proofPayload);
        if (txStatus[_txId] != Enums.TxStatus.NONE) {
            revert Errors.TxAlreadyExists(_txId);
        }

        (bytes32 commitment, bytes32 proofHash) =
            _verifyProof(Enums.VerifierRoute.DEST_LOCK, _proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(
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
        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        uint64 deadline = _originAckDeadline;
        if (block.timestamp >= deadline) {
            revert Errors.AckWindowExpired(deadline, uint64(block.timestamp));
        }

        _txs[_txId] = CrossChainTx({
            txId: _txId,
            amount: _amount,
            currencyFrom: _currencyFrom,
            currencyTo: _currencyTo,
            from: _from,
            to: _to,
            srcChainConnector: _srcChainConnector,
            dstChainConnector: address(this),
            timestamp: uint64(block.timestamp),
            finalizedAt: 0,
            mintedAt: uint64(block.timestamp),
            ackDeadline: deadline,
            status: Enums.TxStatus.MINTED_IN_HOLDING,
            nonce: _nonce,
            sourceChainId: _sourceChainId,
            destinationChainId: block.chainid
        });
        txStatus[_txId] = Enums.TxStatus.MINTED_IN_HOLDING;

        // TODO: Currently, we can mint every token, that allow it. But in our case, we need to have our token
        //       and that why, we need to grant some roles for this connector, to burn and mint.

        // Destination flow is lock-and-mint: mint wrapped tokens into connector
        // custody at lock-proof acceptance, then release to receiver on ACK.
        IMintableERC20(_currencyTo).mint(address(this), _amount);

        emit FundsReleased(
            _txId,
            _amount,
            _currencyFrom,
            _currencyTo,
            _from,
            _to,
            _srcChainConnector,
            address(this),
            uint64(block.timestamp),
            _proofType,
            proofHash,
            commitment,
            _proofPayload
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
        // Spec (p.8): "the protocol allows it to submit the proofs at any point, finishing
        // the transaction after the client's functionality is restored." No hard deadline
        // is enforced here. submitRefundClaimProof has the inverse guard (requires
        // block.timestamp >= ackDeadline), so ACK and refund-claim are mutually exclusive:
        // whichever valid proof is submitted first wins.

        (bytes32 commitment, bytes32 proofHash) =
            _verifyProof(Enums.VerifierRoute.DEST_ACK, _proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(
            Enums.VerifierRoute.DEST_ACK,
            _proofType,
            abi.encode(_txId, tx_.srcChainConnector, tx_.dstChainConnector, tx_.sourceChainId, tx_.destinationChainId)
        );
        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        IERC20(tx_.currencyTo).safeTransfer(tx_.to, tx_.amount);
        _cleanupTx(_txId);

        emit AckAccepted(
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

        _setStatus(_txId, Enums.TxStatus.REFUND_CLAIM_ACCEPTED);

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

        // TODO: Currently, we can mint every token, that allow it. But in our case, we need to have our token
        //       and that why, we need to grant some roles for this connector, to burn and mint.

        // Burn the held destination wrapped tokens before cleanup.
        IBurnableERC20(tx_.currencyTo).burn(tx_.amount);

        _cleanupTx(_txId);

        emit DestTxClosed(
            _txId,
            tx_.amount,
            tx_.currencyFrom,
            tx_.currencyTo,
            tx_.from,
            tx_.to,
            tx_.srcChainConnector,
            tx_.dstChainConnector,
            tx_.timestamp
        );
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @dev For RISC0 proofs, asserts that the imageId embedded in the payload matches
    ///      the expected imageId stored for this route. Reverts with ImageIdRouteMismatch on mismatch.
    ///      No-op for non-RISC0 proof types.
    function _checkRouteImageId(Enums.VerifierRoute _route, Enums.ProofType _proofType, bytes calldata _proofPayload)
        internal
        view
    {
        if (_proofType != Enums.ProofType.RISC0) return;
        (, bytes32 proofImageId,) = abi.decode(_proofPayload, (bytes, bytes32, bytes32));
        bytes32 expected = _risc0RouteImageIds[uint8(_route)];
        if (proofImageId != expected) {
            revert Errors.ImageIdRouteMismatch(uint8(_route), proofImageId, expected);
        }
    }

    function _verifyProof(
        Enums.VerifierRoute _route,
        Enums.ProofType _proofType,
        bytes calldata _proofPayload,
        bytes32 _txId
    ) internal returns (bytes32 commitment, bytes32 proofHash) {
        proofHash = keccak256(_proofPayload);
        if (txProofUsed[_txId][proofHash]) { // TODO: Do we really need to make this if? Ked nie su ten proof v database tak vtedy... ;ked chcu s tym hrat
            revert Errors.ProofAlreadyProcessed(proofHash);
        }
        txProofUsed[_txId][proofHash] = true;
        txProofHashes[_txId].push(proofHash);

        address verifier = _verifiers[uint8(_route)][uint8(_proofType)];
        if (verifier == address(0)) revert Errors.VerifierNotRegistered(uint8(_proofType));

        commitment = IZKVerifier(verifier).verify(_proofPayload);

        emit ProofVerified(_txId, _proofType, proofHash, commitment, _proofPayload);
    }

    function _expectedCommitment(Enums.VerifierRoute _route, Enums.ProofType _proofType, bytes memory _publicInputs)
        internal
        view
        returns (bytes32)
    {
        address verifier = _verifiers[uint8(_route)][uint8(_proofType)];
        if (verifier == address(0)) revert Errors.VerifierNotRegistered(uint8(_proofType));
        return IZKVerifier(verifier).computeCommitment(_publicInputs);
    }

    function _requireStatus(bytes32 _txId, Enums.TxStatus _expected) internal view {
        if (txStatus[_txId] != _expected) {
            revert Errors.InvalidStateTransition(uint8(txStatus[_txId]), uint8(_expected));
        }
    }

    function _setStatus(bytes32 _txId, Enums.TxStatus _s) internal {
        txStatus[_txId] = _s;
        _txs[_txId].status = _s;
    }

    function _cleanupProofsForTx(bytes32 _txId) internal {
        bytes32[] storage hashes = txProofHashes[_txId];
        uint256 len = hashes.length;
        for (uint256 i = 0; i < len; i++) {
            delete txProofUsed[_txId][hashes[i]];
        }
        delete txProofHashes[_txId];
    }

    function _cleanupTx(bytes32 _txId) internal {
        if (txStatus[_txId] == Enums.TxStatus.NONE) {
            revert Errors.TxNotFound(_txId);
        }

        _cleanupProofsForTx(_txId);
        delete _txs[_txId];
        delete txStatus[_txId];
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getTx(bytes32 _txId) external view returns (CrossChainTx memory) {
        return _txs[_txId];
    }
}
