// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {ISnarkVerifier} from "../zk-proof/ISnarkJsVerifier.sol";
import {IERC20} from "openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "../libs/Errors.sol";
import {Enums} from "../libs/Enums.sol";
import {ConnectorStorage} from "./ConnectorStorage.sol";
import {IConnector} from "./IConnector.sol";

contract Connector is ConnectorStorage, IConnector {
    using SafeERC20 for IERC20;

    constructor(address _risc0, address _snark, bytes32 _allowedImageId, uint64 _ackWindowSeconds) {
        if (_risc0 == address(0)) revert Errors.RiscZeroVerifierIsZeroAddress();
        if (_snark == address(0)) revert Errors.SnarkJsVerifierIsZeroAddress();
        if (_allowedImageId == bytes32(0)) {
            revert Errors.AllowedImageIdsRiscZeroIsZeroAddress();
        }

        risc0 = IRiscZeroVerifier(_risc0);
        snark = ISnarkVerifier(_snark);
        imageIdRiscZero = _allowedImageId;

        ackWindowSeconds = _ackWindowSeconds;
    }

    modifier requireStatus(bytes32 _txId, Enums.TxStatus _expected) {
        _requireStatus(_txId, _expected);
        _;
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
        address _dstChainConnector
    ) external returns (bytes32 txId) {
        if (_amount == 0) revert Errors.ZeroAmount();
        if (_to == address(0)) revert Errors.ZeroAddress();
        if (_currencyFrom == address(0)) revert Errors.ZeroAddress();
        if (_currencyTo == address(0)) revert Errors.ZeroAddress();
        if (_dstChainConnector == address(0)) revert Errors.ZeroAddress();
        uint256 nonce = txNonce++;

        txId = keccak256(
            abi.encode(msg.sender, _to, _amount, _currencyFrom, _currencyTo, address(this), _dstChainConnector, nonce)
        );

        if (txStatus[txId] != Enums.TxStatus.NONE) {
            revert Errors.TxAlreadyExists(txId);
        }

        uint256 balanceBefore = IERC20(_currencyFrom).balanceOf(address(this));
        IERC20(_currencyFrom).safeTransferFrom(msg.sender, address(this), _amount);
        uint256 received = IERC20(_currencyFrom).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert Errors.ZeroAmount();

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
            ackDeadline: uint64(block.timestamp) + ackWindowSeconds,
            status: Enums.TxStatus.DEPOSIT_LOCKED
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
            uint64(block.timestamp)
        );
    }

    /// @inheritdoc IConnector
    function submitMintProof(Enums.ProofType _proofType, bytes calldata _proofPayload, bytes32 _txId)
        external
        requireStatus(_txId, Enums.TxStatus.DEPOSIT_LOCKED)
    {
        CrossChainTx storage tx_ = _txs[_txId];

        (bytes32 commitment, bytes32 proofHash) = _verifyProof(_proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(_proofType, abi.encode(_txId, tx_.dstChainConnector, tx_.amount, tx_.to));

        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        tx_.mintedAt = uint64(block.timestamp);
        _setStatus(_txId, Enums.TxStatus.MINT_PROOF_ACCEPTED);

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
    }

    /// @inheritdoc IConnector
    function initiateRefund(bytes32 _txId) external {
        Enums.TxStatus current = txStatus[_txId];
        CrossChainTx storage tx_ = _txs[_txId];

        if (current != Enums.TxStatus.DEPOSIT_LOCKED && current != Enums.TxStatus.MINT_PROOF_ACCEPTED) {
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
        requireStatus(_txId, Enums.TxStatus.REFUND_INITIATED)
    {
        CrossChainTx memory tx_ = _txs[_txId];

        (bytes32 commitment,) = _verifyProof(_proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(_proofType, abi.encode(_txId, tx_.dstChainConnector, tx_.amount));
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

    /// @inheritdoc IConnector
    function closeTx(bytes32 _txId) external requireStatus(_txId, Enums.TxStatus.MINT_PROOF_ACCEPTED) {
        CrossChainTx memory tx_ = _txs[_txId];

        if (msg.sender != tx_.from) {
            revert Errors.NotTxOriginator(_txId, msg.sender, tx_.from);
        }

        uint64 closeAfter = tx_.ackDeadline;
        if (block.timestamp < closeAfter) {
            revert Errors.DeadlineNotReached(closeAfter, uint64(block.timestamp));
        }

        _cleanupTx(_txId);
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
    function submitDepositProof(
        Enums.ProofType _proofType,
        bytes calldata _proofPayload,
        bytes32 _txId,
        uint256 _amount,
        address _currencyFrom,
        address _currencyTo,
        address _from,
        address _to,
        address _srcChainConnector,
        uint64 _originAckDeadline
    ) external {
        if (txStatus[_txId] != Enums.TxStatus.NONE) {
            revert Errors.TxAlreadyExists(_txId);
        }

        (bytes32 commitment, bytes32 proofHash) = _verifyProof(_proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(
            _proofType,
            abi.encode(
                _txId,
                _amount,
                _from,
                _to,
                _currencyFrom,
                _currencyTo,
                _srcChainConnector,
                address(this),
                _originAckDeadline
            )
        );
        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

        uint64 deadline = _originAckDeadline;

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
            status: Enums.TxStatus.MINTED_IN_HOLDING
        });
        txStatus[_txId] = Enums.TxStatus.MINTED_IN_HOLDING;

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
        requireStatus(_txId, Enums.TxStatus.MINTED_IN_HOLDING)
    {
        CrossChainTx memory tx_ = _txs[_txId];

        (bytes32 commitment, bytes32 proofHash) = _verifyProof(_proofType, _proofPayload, _txId);
        bytes32 expected =
            _expectedCommitment(_proofType, abi.encode(_txId, tx_.srcChainConnector, tx_.dstChainConnector));
        if (commitment != expected) {
            revert Errors.CommitmentMismatch(commitment, expected);
        }

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
        requireStatus(_txId, Enums.TxStatus.MINTED_IN_HOLDING)
    {
        CrossChainTx storage tx_ = _txs[_txId];

        if (block.timestamp < tx_.ackDeadline) {
            revert Errors.AckWindowNotExpired(tx_.ackDeadline, uint64(block.timestamp));
        }

        (bytes32 commitment, bytes32 proofHash) = _verifyProof(_proofType, _proofPayload, _txId);
        bytes32 expected = _expectedCommitment(_proofType, abi.encode(_txId, tx_.srcChainConnector, tx_.amount));
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
    function executeBurn(bytes32 _txId) external requireStatus(_txId, Enums.TxStatus.REFUND_CLAIM_ACCEPTED) {
        CrossChainTx memory tx_ = _txs[_txId];

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

    function _verifyProof(Enums.ProofType _proofType, bytes calldata _proofPayload, bytes32 _txId)
        internal
        returns (bytes32 commitment, bytes32 proofHash)
    {
        proofHash = keccak256(_proofPayload);
        if (txProofUsed[_txId][proofHash]) {
            revert Errors.ProofAlreadyProcessed(proofHash);
        }
        txProofUsed[_txId][proofHash] = true;
        txProofHashes[_txId].push(proofHash);

        if (_proofType == Enums.ProofType.RISC0) {
            (bytes memory seal, bytes32 imageId, bytes32 journalDigest) =
                abi.decode(_proofPayload, (bytes, bytes32, bytes32));

            if (imageIdRiscZero != imageId) {
                revert Errors.ImageIdNotAllowed(imageId);
            }
            risc0.verify(seal, imageId, journalDigest);
            commitment = journalDigest;
        } else if (_proofType == Enums.ProofType.SNARKJS) {
            (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory input) =
                abi.decode(_proofPayload, (uint256[2], uint256[2][2], uint256[2], uint256[]));

            if (!snark.verify(a, b, c, input)) {
                revert Errors.InvalidSnarkProof();
            }
            commitment = keccak256(abi.encodePacked(input));
        } else {
            revert Errors.InvalidProofType();
        }

        emit ProofVerified(_txId, _proofType, proofHash, commitment, _proofPayload);
    }

    function _expectedCommitment(Enums.ProofType _proofType, bytes memory _publicInputs)
        internal
        pure
        returns (bytes32)
    {
        if (_proofType == Enums.ProofType.RISC0) {
            return sha256(_publicInputs);
        }
        return _keccak(_publicInputs);
    }

    function _requireStatus(bytes32 _txId, Enums.TxStatus _expected) internal view {
        if (txStatus[_txId] != _expected) {
            revert Errors.InvalidStateTransition(uint8(txStatus[_txId]), uint8(_expected));
        }
    }

    function _keccak(bytes memory _input) internal pure returns (bytes32 result) {
        assembly ("memory-safe") {
            result := keccak256(add(_input, 0x20), mload(_input))
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
