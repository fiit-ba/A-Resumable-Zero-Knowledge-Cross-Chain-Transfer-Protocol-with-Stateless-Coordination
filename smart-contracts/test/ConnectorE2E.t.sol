// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {Connector} from "../src/connectors/Connector.sol";
import {ConnectorStorage} from "../src/connectors/ConnectorStorage.sol";
import {Enums} from "../src/libs/Enums.sol";
import {ProofOutputs} from "../src/libs/ProofOutputs.sol";
import {WrappedTokenFactory} from "../src/tokens/WrappedTokenFactory.sol";
import {BridgeWrappedToken} from "../src/tokens/BridgeWrappedToken.sol";
import {RiscZeroAdapter} from "../src/zk-proof/adapters/RiscZeroAdapter.sol";
import {SnarkAdapter} from "../src/zk-proof/adapters/SnarkAdapter.sol";
import {ISnarkVerifier} from "../src/zk-proof/ISnarkJsVerifier.sol";
import {IRiscZeroVerifier, Receipt} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {ERC20} from "openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRiscZeroVerifierE2E is IRiscZeroVerifier {
    function verify(bytes calldata _seal, bytes32 _imageId, bytes32 _journalDigest) external view override {
        _seal;
        _imageId;
        _journalDigest;
    }

    function verifyIntegrity(Receipt calldata _receipt) external view override {
        _receipt;
    }
}

contract MockSnarkVerifierE2E is ISnarkVerifier {
    function verify(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata)
        external
        view
        override
        returns (bool)
    {
        return true;
    }
}

contract MockERC20E2E is ERC20 {
    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {}

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}

contract ConnectorE2ETest is Test {
    uint256 internal constant _SRC_CHAIN_ID = 11_111_111;
    uint256 internal constant _DST_CHAIN_ID = 22_222_222;
    uint64 internal constant _ACK_WINDOW = 1 hours;
    uint256 internal constant _AMOUNT = 1000e18;
    bytes32 internal constant _IMAGE_ID = bytes32(uint256(0x1234));

    address internal constant _ALICE = address(0xA11CE);
    address internal constant _BOB = address(0xB0B);

    Connector internal _originConnector;
    Connector internal _destinationConnector;
    WrappedTokenFactory internal _originFactory;
    WrappedTokenFactory internal _destinationFactory;
    MockERC20E2E internal _sourceToken;
    BridgeWrappedToken internal _destinationWrappedToken;
    RiscZeroAdapter internal _risc0Adapter;
    SnarkAdapter internal _snarkAdapter;

    function setUp() public {
        MockRiscZeroVerifierE2E risc0Verifier = new MockRiscZeroVerifierE2E();
        MockSnarkVerifierE2E snarkVerifier = new MockSnarkVerifierE2E();

        bytes32[] memory allowedIds = new bytes32[](1);
        allowedIds[0] = _IMAGE_ID;
        _risc0Adapter = new RiscZeroAdapter(address(risc0Verifier), allowedIds);
        _snarkAdapter = new SnarkAdapter(address(snarkVerifier));

        bytes32[5] memory routeImageIds;
        for (uint8 i = 0; i < 5; ++i) {
            routeImageIds[i] = _IMAGE_ID;
        }

        _originFactory = new WrappedTokenFactory();
        _destinationFactory = new WrappedTokenFactory();
        _originConnector = new Connector(
            address(_risc0Adapter), address(_snarkAdapter), _ACK_WINDOW, routeImageIds, address(_originFactory)
        );
        _destinationConnector = new Connector(
            address(_risc0Adapter), address(_snarkAdapter), _ACK_WINDOW, routeImageIds, address(_destinationFactory)
        );

        _sourceToken = new MockERC20E2E("Source Token", "SRC");
        _destinationWrappedToken =
            new BridgeWrappedToken("Wrapped Source Token", "wSRC", address(_destinationConnector));

        _originFactory.register(
            _SRC_CHAIN_ID,
            address(_originConnector),
            address(_sourceToken),
            _DST_CHAIN_ID,
            address(_destinationConnector),
            address(_destinationWrappedToken)
        );
        _destinationFactory.register(
            _SRC_CHAIN_ID,
            address(_originConnector),
            address(_sourceToken),
            _DST_CHAIN_ID,
            address(_destinationConnector),
            address(_destinationWrappedToken)
        );
    }

    function test_e2e_HappyPath_DepositLockMintAckRelease() public {
        (bytes32 txId, ConnectorStorage.CrossChainTx memory originTx) = _depositOnOrigin(_AMOUNT);
        assertEq(uint8(_originConnector.txStatus(txId)), uint8(Enums.TxStatus.DEPOSIT_LOCKED));

        _submitLockProofOnDestination(txId, originTx);
        assertEq(uint8(_destinationConnector.txStatus(txId)), uint8(Enums.TxStatus.MINTED_IN_HOLDING));
        assertEq(_destinationWrappedToken.balanceOf(address(_destinationConnector)), _AMOUNT);

        _submitMintProofOnOrigin(txId, originTx);
        assertEq(uint8(_originConnector.txStatus(txId)), uint8(Enums.TxStatus.NONE));

        _submitAckProofOnDestination(txId);
        assertEq(uint8(_destinationConnector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
        assertEq(_destinationWrappedToken.balanceOf(address(_destinationConnector)), 0);
        assertEq(_destinationWrappedToken.balanceOf(_BOB), _AMOUNT);
        assertTrue(_destinationConnector.destinationLockAccepted(txId));
    }

    function test_e2e_RefundPath_RefundClaimExecuteBurnAndOriginRefund() public {
        (bytes32 txId, ConnectorStorage.CrossChainTx memory originTx) = _depositOnOrigin(_AMOUNT);

        _submitLockProofOnDestination(txId, originTx);

        _setSourceChain();
        vm.warp(originTx.ackDeadline + 1);
        vm.prank(_ALICE);
        _originConnector.initiateRefund(txId);
        assertEq(uint8(_originConnector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_INITIATED));

        _submitRefundClaimProofOnDestination(txId);
        assertEq(uint8(_destinationConnector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_CLAIM_ACCEPTED));

        _setDestinationChain();
        _destinationConnector.executeBurn(txId);
        assertEq(uint8(_destinationConnector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
        assertEq(_destinationWrappedToken.totalSupply(), 0);

        _submitBurnProofOnOrigin(txId, originTx);
        assertEq(uint8(_originConnector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
        assertEq(_sourceToken.balanceOf(_ALICE), _AMOUNT);
        assertEq(_sourceToken.balanceOf(address(_originConnector)), 0);
    }

    function _setSourceChain() internal {
        vm.chainId(_SRC_CHAIN_ID);
    }

    function _setDestinationChain() internal {
        vm.chainId(_DST_CHAIN_ID);
    }

    function _depositOnOrigin(uint256 _amount)
        internal
        returns (bytes32 txId, ConnectorStorage.CrossChainTx memory tx_)
    {
        _setSourceChain();
        _sourceToken.mint(_ALICE, _amount);

        vm.startPrank(_ALICE);
        _sourceToken.approve(address(_originConnector), _amount);
        txId = _originConnector.depositAndLock(
            address(_sourceToken),
            address(_destinationWrappedToken),
            _BOB,
            _amount,
            address(_destinationConnector),
            _DST_CHAIN_ID
        );
        vm.stopPrank();

        tx_ = _originConnector.getTx(txId);
    }

    function _submitLockProofOnDestination(bytes32 _txId, ConnectorStorage.CrossChainTx memory _originTx) internal {
        _setDestinationChain();

        bytes memory lockPublicInputs = ProofOutputs.encodeLockProof(
            ProofOutputs.LockProofPublicInputs({
                txId: _txId,
                amount: _originTx.amount,
                sender: _originTx.from,
                receiver: _originTx.to,
                currencyFrom: _originTx.currencyFrom,
                currencyTo: _originTx.currencyTo,
                srcChainConnector: _originTx.srcChainConnector,
                dstChainConnector: _originTx.dstChainConnector,
                originAckDeadline: _originTx.ackDeadline,
                nonce: _originTx.nonce,
                sourceChainId: _originTx.sourceChainId,
                destinationChainId: _originTx.destinationChainId
            })
        );

        _destinationConnector.submitLockProof(
            Enums.ProofType.SNARKJS,
            _buildSnarkProof(lockPublicInputs),
            _txId,
            _originTx.amount,
            _originTx.currencyFrom,
            _originTx.currencyTo,
            _originTx.from,
            _originTx.to,
            _originTx.srcChainConnector,
            _originTx.ackDeadline,
            _originTx.nonce,
            _originTx.sourceChainId
        );
    }

    function _submitMintProofOnOrigin(bytes32 _txId, ConnectorStorage.CrossChainTx memory _originTx) internal {
        _setSourceChain();
        bytes memory mintPublicInputs = abi.encode(
            _txId,
            _originTx.dstChainConnector,
            _originTx.amount,
            _originTx.to,
            _originTx.sourceChainId,
            _originTx.destinationChainId
        );
        _originConnector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(mintPublicInputs), _txId);
    }

    function _submitAckProofOnDestination(bytes32 _txId) internal {
        _setDestinationChain();
        ConnectorStorage.CrossChainTx memory destinationTx = _destinationConnector.getTx(_txId);
        bytes memory ackPublicInputs = abi.encode(
            _txId,
            destinationTx.srcChainConnector,
            destinationTx.dstChainConnector,
            destinationTx.sourceChainId,
            destinationTx.destinationChainId
        );
        _destinationConnector.submitAckProof(Enums.ProofType.SNARKJS, _buildSnarkProof(ackPublicInputs), _txId);
    }

    function _submitRefundClaimProofOnDestination(bytes32 _txId) internal {
        _setDestinationChain();
        ConnectorStorage.CrossChainTx memory destinationTx = _destinationConnector.getTx(_txId);
        bytes memory refundClaimPublicInputs = abi.encode(
            _txId,
            destinationTx.srcChainConnector,
            destinationTx.amount,
            destinationTx.sourceChainId,
            destinationTx.destinationChainId
        );
        _destinationConnector.submitRefundClaimProof(
            Enums.ProofType.SNARKJS, _buildSnarkProof(refundClaimPublicInputs), _txId
        );
    }

    function _submitBurnProofOnOrigin(bytes32 _txId, ConnectorStorage.CrossChainTx memory _originTx) internal {
        _setSourceChain();
        bytes memory burnPublicInputs = abi.encode(
            _txId, _originTx.dstChainConnector, _originTx.amount, _originTx.sourceChainId, _originTx.destinationChainId
        );
        _originConnector.submitBurnProof(Enums.ProofType.SNARKJS, _buildSnarkProof(burnPublicInputs), _txId);
    }

    function _buildSnarkProof(bytes memory _publicInputs) internal pure returns (bytes memory) {
        uint256 words = _publicInputs.length / 32;
        uint256[] memory input = new uint256[](words);
        for (uint256 i = 0; i < words; ++i) {
            input[i] = _wordAt(_publicInputs, i);
        }
        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];
        return abi.encode(a, b, c, input);
    }

    function _wordAt(bytes memory _data, uint256 _wordIndex) internal pure returns (uint256 out) {
        uint256 start = _wordIndex * 32;
        for (uint256 j = 0; j < 32; ++j) {
            out = (out << 8) | uint8(_data[start + j]);
        }
    }
}
