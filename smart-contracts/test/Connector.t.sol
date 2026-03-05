// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Connector} from "../src/connectors/Connector.sol";
import {ConnectorStorage} from "../src/connectors/ConnectorStorage.sol";
import {Enums} from "../src/libs/Enums.sol";
import {Errors} from "../src/libs/Errors.sol";
import {IRiscZeroVerifier, Receipt} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {ISnarkVerifier} from "../src/zk-proof/ISnarkJsVerifier.sol";
import {ERC20} from "openzeppelin/contracts/token/ERC20/ERC20.sol";

/*//////////////////////////////////////////////////////////////
                              MOCKS
//////////////////////////////////////////////////////////////*/

contract MockRiscZeroVerifier is IRiscZeroVerifier {
    bool public shouldRevert;

    function setShouldRevert(bool _val) external {
        shouldRevert = _val;
    }

    function verify(bytes calldata, bytes32, bytes32) external view override {
        if (shouldRevert) revert("risc0:fail");
    }

    function verifyIntegrity(Receipt calldata) external view override {
        if (shouldRevert) revert("risc0:fail");
    }
}

contract MockSnarkVerifier is ISnarkVerifier {
    bool public shouldReturnFalse;

    function setShouldReturnFalse(bool _val) external {
        shouldReturnFalse = _val;
    }

    function verify(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata)
        external
        view
        override
        returns (bool)
    {
        return !shouldReturnFalse;
    }
}

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/*//////////////////////////////////////////////////////////////
                          TEST CONTRACT
//////////////////////////////////////////////////////////////*/

contract ConnectorTest is Test {
    Connector public connector;
    MockRiscZeroVerifier public risc0Mock;
    MockSnarkVerifier public snarkMock;
    MockERC20 public token;
    MockERC20 public dstTokenMock;

    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant DST_CONNECTOR = address(0xD57);
    address constant SRC_CONNECTOR = address(0x5EC);
    uint256 constant AMOUNT = 1000e18;
    uint64 constant ACK_WINDOW = 1 hours;
    bytes32 constant IMAGE_ID = bytes32(uint256(0x1234));

    function setUp() public {
        risc0Mock = new MockRiscZeroVerifier();
        snarkMock = new MockSnarkVerifier();
        token = new MockERC20("TUSD", "TUSD");
        dstTokenMock = new MockERC20("USDC", "USDC");

        connector = new Connector(address(risc0Mock), address(snarkMock), IMAGE_ID, ACK_WINDOW);
    }

    /*//////////////////////////////////////////////////////////////
                          PROOF HELPERS
    //////////////////////////////////////////////////////////////*/

    function _buildRisc0Proof(bytes memory publicInputs) internal pure returns (bytes memory) {
        bytes32 journalDigest = sha256(publicInputs);
        bytes memory seal = hex"cafe";
        return abi.encode(seal, IMAGE_ID, journalDigest);
    }

    function _buildRisc0ProofBadImageId(bytes memory publicInputs) internal pure returns (bytes memory) {
        bytes32 journalDigest = sha256(publicInputs);
        bytes memory seal = hex"cafe";
        bytes32 bad = bytes32(uint256(0xDEAD));
        return abi.encode(seal, bad, journalDigest);
    }

    function _buildRisc0ProofBadCommitment() internal pure returns (bytes memory) {
        bytes32 journalDigest = sha256("notcorrect");
        bytes memory seal = hex"cafe";
        return abi.encode(seal, IMAGE_ID, journalDigest);
    }

    function _buildSnarkProof(bytes memory publicInputs) internal pure returns (bytes memory) {
        uint256 words = publicInputs.length / 32;
        uint256[] memory input = new uint256[](words);
        for (uint256 i = 0; i < words; i++) {
            bytes32 w;
            assembly {
                w := mload(add(publicInputs, add(32, mul(i, 32))))
            }
            input[i] = uint256(w);
        }
        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];
        return abi.encode(a, b, c, input);
    }

    function _buildSnarkProofBadCommitment() internal pure returns (bytes memory) {
        uint256[] memory input = new uint256[](1);
        input[0] = 0xBAD;
        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];
        return abi.encode(a, b, c, input);
    }

    /*//////////////////////////////////////////////////////////////
                       TX SETUP HELPERS
    //////////////////////////////////////////////////////////////*/

    function _doDeposit() internal returns (bytes32 txId) {
        token.mint(ALICE, AMOUNT);
        vm.startPrank(ALICE);
        token.approve(address(connector), AMOUNT);
        txId = connector.depositAndLock(address(token), address(dstTokenMock), BOB, AMOUNT, DST_CONNECTOR);
        vm.stopPrank();
    }

    function _mintProofInputs(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        return abi.encode(txId, t.dstChainConnector, t.amount, t.to);
    }

    function _burnProofInputs(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        return abi.encode(txId, t.dstChainConnector, t.amount);
    }

    function _doDestDeposit(bytes32 txId, uint64 originAckDeadline) internal {
        bytes memory pub = abi.encode(
            txId,
            AMOUNT,
            ALICE,
            BOB,
            address(token),
            address(dstTokenMock),
            SRC_CONNECTOR,
            address(connector),
            originAckDeadline
        );
        bytes memory proof = _buildSnarkProof(pub);
        connector.submitDepositProof(
            Enums.ProofType.SNARKJS,
            proof,
            txId,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            ALICE,
            BOB,
            SRC_CONNECTOR,
            originAckDeadline
        );
    }

    function _ackProofInputs(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        return abi.encode(txId, t.srcChainConnector, t.dstChainConnector);
    }

    function _refundClaimInputs(bytes32 txId) internal view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        return abi.encode(txId, t.srcChainConnector, t.amount);
    }

    /// txStatus mapping lives at storage slot 6 in ConnectorStorage
    uint256 constant TX_STATUS_SLOT = 6;

    function _forceTxStatus(bytes32 txId, Enums.TxStatus s) internal {
        bytes32 slot = keccak256(abi.encode(txId, TX_STATUS_SLOT));
        vm.store(address(connector), slot, bytes32(uint256(uint8(s))));
    }

    /*//////////////////////////////////////////////////////////////
                        CONSTRUCTOR TESTS
    //////////////////////////////////////////////////////////////*/

    function test_constructor_SetsParameters() public view {
        assertEq(address(connector.risc0()), address(risc0Mock));
        assertEq(address(connector.snark()), address(snarkMock));
        assertEq(connector.imageIdRiscZero(), IMAGE_ID);
        assertEq(connector.ackWindowSeconds(), ACK_WINDOW);
    }

    function test_constructor_RevertsWhen_Risc0Zero() public {
        vm.expectRevert(Errors.RiscZeroVerifierIsZeroAddress.selector);
        new Connector(address(0), address(snarkMock), IMAGE_ID, ACK_WINDOW);
    }

    function test_constructor_RevertsWhen_SnarkZero() public {
        vm.expectRevert(Errors.SnarkJsVerifierIsZeroAddress.selector);
        new Connector(address(risc0Mock), address(0), IMAGE_ID, ACK_WINDOW);
    }

    function test_constructor_RevertsWhen_ImageIdZero() public {
        vm.expectRevert(Errors.AllowedImageIdsRiscZeroIsZeroAddress.selector);
        new Connector(address(risc0Mock), address(snarkMock), bytes32(0), ACK_WINDOW);
    }

    /*//////////////////////////////////////////////////////////////
                      depositAndLock TESTS
    //////////////////////////////////////////////////////////////*/

    function test_depositAndLock_HappyPath() public {
        token.mint(ALICE, AMOUNT);
        vm.startPrank(ALICE);
        token.approve(address(connector), AMOUNT);

        bytes32 expectedTxId = keccak256(
            abi.encode(
                ALICE, BOB, AMOUNT, address(token), address(dstTokenMock), address(connector), DST_CONNECTOR, uint256(0)
            )
        );

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.DepositLocked(
            expectedTxId,
            ALICE,
            BOB,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            address(connector),
            DST_CONNECTOR,
            uint64(block.timestamp)
        );

        bytes32 txId = connector.depositAndLock(address(token), address(dstTokenMock), BOB, AMOUNT, DST_CONNECTOR);
        vm.stopPrank();

        assertEq(txId, expectedTxId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.DEPOSIT_LOCKED));

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        assertEq(t.amount, AMOUNT);
        assertEq(t.from, ALICE);
        assertEq(t.to, BOB);
        assertEq(t.currencyFrom, address(token));
        assertEq(t.currencyTo, address(dstTokenMock));
        assertEq(t.srcChainConnector, address(connector));
        assertEq(t.dstChainConnector, DST_CONNECTOR);
        assertEq(t.ackDeadline, uint64(block.timestamp) + ACK_WINDOW);
        assertEq(uint8(t.status), uint8(Enums.TxStatus.DEPOSIT_LOCKED));
    }

    function test_depositAndLock_TransfersTokens() public {
        _doDeposit();
        assertEq(token.balanceOf(address(connector)), AMOUNT);
        assertEq(token.balanceOf(ALICE), 0);
    }

    function test_depositAndLock_IncrementsNonce() public {
        assertEq(connector.txNonce(), 0);
        _doDeposit();
        assertEq(connector.txNonce(), 1);
    }

    function test_depositAndLock_RevertsWhen_ZeroAmount() public {
        vm.expectRevert(Errors.ZeroAmount.selector);
        connector.depositAndLock(address(token), address(dstTokenMock), BOB, 0, DST_CONNECTOR);
    }

    function test_depositAndLock_RevertsWhen_ZeroTo() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        connector.depositAndLock(address(token), address(dstTokenMock), address(0), AMOUNT, DST_CONNECTOR);
    }

    function test_depositAndLock_RevertsWhen_ZeroCurrencyFrom() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        connector.depositAndLock(address(0), address(dstTokenMock), BOB, AMOUNT, DST_CONNECTOR);
    }

    function test_depositAndLock_RevertsWhen_ZeroCurrencyTo() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        connector.depositAndLock(address(token), address(0), BOB, AMOUNT, DST_CONNECTOR);
    }

    function test_depositAndLock_RevertsWhen_ZeroDstConnector() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        connector.depositAndLock(address(token), address(dstTokenMock), BOB, AMOUNT, address(0));
    }

    /*//////////////////////////////////////////////////////////////
                      submitMintProof TESTS
    //////////////////////////////////////////////////////////////*/

    function test_submitMintProof_Risc0_HappyPath() public {
        bytes32 txId = _doDeposit();
        bytes memory pub = _mintProofInputs(txId);
        bytes memory proof = _buildRisc0Proof(pub);
        bytes32 proofHash = keccak256(proof);
        bytes32 commitment = sha256(pub);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.ProofVerified(txId, Enums.ProofType.RISC0, proofHash, commitment, proof);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.AckReady(
            txId,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            ALICE,
            BOB,
            address(connector),
            DST_CONNECTOR,
            uint64(block.timestamp),
            Enums.ProofType.RISC0,
            proofHash,
            commitment,
            proof
        );

        connector.submitMintProof(Enums.ProofType.RISC0, proof, txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINT_PROOF_ACCEPTED));
        assertTrue(connector.txProofUsed(txId, proofHash));
    }

    function test_submitMintProof_Snarkjs_HappyPath() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildSnarkProof(_mintProofInputs(txId));

        connector.submitMintProof(Enums.ProofType.SNARKJS, proof, txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINT_PROOF_ACCEPTED));
    }

    function test_submitMintProof_SetsMintedAt() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildSnarkProof(_mintProofInputs(txId));

        uint64 ts = uint64(block.timestamp);
        connector.submitMintProof(Enums.ProofType.SNARKJS, proof, txId);

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        assertEq(t.mintedAt, ts);
    }

    function test_submitMintProof_RevertsWhen_NotDepositLocked() public {
        bytes32 fake = bytes32(uint256(0x999));
        bytes memory proof = _buildSnarkProof(abi.encode(fake, DST_CONNECTOR, AMOUNT, BOB));

        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.InvalidStateTransition.selector, uint8(Enums.TxStatus.NONE), uint8(Enums.TxStatus.DEPOSIT_LOCKED)
            )
        );
        connector.submitMintProof(Enums.ProofType.SNARKJS, proof, fake);
    }

    function test_submitMintProof_RevertsWhen_CommitmentMismatch_Risc0() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildRisc0ProofBadCommitment();

        vm.expectRevert();
        connector.submitMintProof(Enums.ProofType.RISC0, proof, txId);
    }

    function test_submitMintProof_RevertsWhen_CommitmentMismatch_Snarkjs() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildSnarkProofBadCommitment();

        vm.expectRevert();
        connector.submitMintProof(Enums.ProofType.SNARKJS, proof, txId);
    }

    function test_submitMintProof_RevertsWhen_WrongImageId() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildRisc0ProofBadImageId(_mintProofInputs(txId));

        vm.expectRevert(abi.encodeWithSelector(Errors.ImageIdNotAllowed.selector, bytes32(uint256(0xDEAD))));
        connector.submitMintProof(Enums.ProofType.RISC0, proof, txId);
    }

    function test_submitMintProof_RevertsWhen_SnarkReturnsFalse() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildSnarkProof(_mintProofInputs(txId));

        snarkMock.setShouldReturnFalse(true);
        vm.expectRevert(Errors.InvalidSnarkProof.selector);
        connector.submitMintProof(Enums.ProofType.SNARKJS, proof, txId);
    }

    function test_submitMintProof_RevertsWhen_Risc0Reverts() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildRisc0Proof(_mintProofInputs(txId));

        risc0Mock.setShouldRevert(true);
        vm.expectRevert();
        connector.submitMintProof(Enums.ProofType.RISC0, proof, txId);
    }

    function test_submitMintProof_RevertsWhen_ProofReplay() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildSnarkProof(_mintProofInputs(txId));

        connector.submitMintProof(Enums.ProofType.SNARKJS, proof, txId);

        _forceTxStatus(txId, Enums.TxStatus.DEPOSIT_LOCKED);

        bytes32 proofHash = keccak256(proof);
        vm.expectRevert(abi.encodeWithSelector(Errors.ProofAlreadyProcessed.selector, proofHash));
        connector.submitMintProof(Enums.ProofType.SNARKJS, proof, txId);
    }

    /*//////////////////////////////////////////////////////////////
                      initiateRefund TESTS
    //////////////////////////////////////////////////////////////*/

    function test_initiateRefund_FromDepositLocked() public {
        bytes32 txId = _doDeposit();
        vm.warp(block.timestamp + ACK_WINDOW + 1);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.RefundClaimed(txId, ALICE, AMOUNT, address(connector));

        connector.initiateRefund(txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_INITIATED));
    }

    function test_initiateRefund_FromMintProofAccepted() public {
        bytes32 txId = _doDeposit();
        connector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_mintProofInputs(txId)), txId);

        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_INITIATED));
    }

    function test_initiateRefund_RevertsWhen_AckWindowNotExpired() public {
        bytes32 txId = _doDeposit();
        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);

        vm.expectRevert(
            abi.encodeWithSelector(Errors.AckWindowNotExpired.selector, t.ackDeadline, uint64(block.timestamp))
        );
        connector.initiateRefund(txId);
    }

    function test_initiateRefund_RevertsWhen_InvalidStatus() public {
        bytes32 fake = bytes32(uint256(0x999));
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.InvalidStateTransition.selector,
                uint8(Enums.TxStatus.NONE),
                uint8(Enums.TxStatus.REFUND_INITIATED)
            )
        );
        connector.initiateRefund(fake);
    }

    /*//////////////////////////////////////////////////////////////
                       submitBurnProof TESTS
    //////////////////////////////////////////////////////////////*/

    function test_submitBurnProof_HappyPath() public {
        bytes32 txId = _doDeposit();
        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);

        bytes memory proof = _buildSnarkProof(_burnProofInputs(txId));

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.RefundExecuted(txId, ALICE, AMOUNT);

        connector.submitBurnProof(Enums.ProofType.SNARKJS, proof, txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }

    function test_submitBurnProof_TransfersRefund() public {
        bytes32 txId = _doDeposit();
        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);

        connector.submitBurnProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_burnProofInputs(txId)), txId);

        assertEq(token.balanceOf(ALICE), AMOUNT);
        assertEq(token.balanceOf(address(connector)), 0);
    }

    function test_submitBurnProof_EmitsOriginTxClosed() public {
        bytes32 txId = _doDeposit();
        ConnectorStorage.CrossChainTx memory snap = connector.getTx(txId);
        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);

        bytes memory proof = _buildSnarkProof(_burnProofInputs(txId));

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.OriginTxClosed(
            txId,
            snap.amount,
            snap.currencyFrom,
            snap.currencyTo,
            snap.from,
            snap.to,
            snap.srcChainConnector,
            snap.dstChainConnector,
            snap.timestamp
        );
        connector.submitBurnProof(Enums.ProofType.SNARKJS, proof, txId);
    }

    function test_submitBurnProof_RevertsWhen_NotRefundInitiated() public {
        bytes32 txId = _doDeposit();
        bytes memory proof = _buildSnarkProof(abi.encode(txId, DST_CONNECTOR, AMOUNT));

        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.InvalidStateTransition.selector,
                uint8(Enums.TxStatus.DEPOSIT_LOCKED),
                uint8(Enums.TxStatus.REFUND_INITIATED)
            )
        );
        connector.submitBurnProof(Enums.ProofType.SNARKJS, proof, txId);
    }

    function test_submitBurnProof_RevertsWhen_CommitmentMismatch() public {
        bytes32 txId = _doDeposit();
        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);

        vm.expectRevert();
        connector.submitBurnProof(Enums.ProofType.SNARKJS, _buildSnarkProofBadCommitment(), txId);
    }

    function test_submitBurnProof_CleansProofTracking() public {
        bytes32 txId = _doDeposit();
        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);

        bytes memory proof = _buildSnarkProof(_burnProofInputs(txId));
        bytes32 proofHash = keccak256(proof);

        connector.submitBurnProof(Enums.ProofType.SNARKJS, proof, txId);

        assertFalse(connector.txProofUsed(txId, proofHash));
    }

    function test_submitBurnProof_CleansTxData() public {
        bytes32 txId = _doDeposit();
        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);

        connector.submitBurnProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_burnProofInputs(txId)), txId);

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        assertEq(t.txId, bytes32(0));
        assertEq(t.amount, 0);
        assertEq(t.from, address(0));
    }

    /*//////////////////////////////////////////////////////////////
                          closeTx TESTS
    //////////////////////////////////////////////////////////////*/

    function test_closeTx_HappyPath() public {
        bytes32 txId = _doDeposit();
        connector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_mintProofInputs(txId)), txId);

        ConnectorStorage.CrossChainTx memory snap = connector.getTx(txId);
        vm.warp(block.timestamp + ACK_WINDOW + 1);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.OriginTxClosed(
            txId,
            snap.amount,
            snap.currencyFrom,
            snap.currencyTo,
            snap.from,
            snap.to,
            snap.srcChainConnector,
            snap.dstChainConnector,
            snap.timestamp
        );

        vm.prank(ALICE);
        connector.closeTx(txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }

    function test_closeTx_RevertsWhen_NotOriginator() public {
        bytes32 txId = _doDeposit();
        connector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_mintProofInputs(txId)), txId);
        vm.warp(block.timestamp + ACK_WINDOW + 1);

        vm.expectRevert(abi.encodeWithSelector(Errors.NotTxOriginator.selector, txId, BOB, ALICE));
        vm.prank(BOB);
        connector.closeTx(txId);
    }

    function test_closeTx_RevertsWhen_DeadlineNotReached() public {
        bytes32 txId = _doDeposit();
        connector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_mintProofInputs(txId)), txId);

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.DeadlineNotReached.selector, t.ackDeadline, uint64(block.timestamp))
        );
        vm.prank(ALICE);
        connector.closeTx(txId);
    }

    function test_closeTx_RevertsWhen_NotMintProofAccepted() public {
        bytes32 txId = _doDeposit();

        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.InvalidStateTransition.selector,
                uint8(Enums.TxStatus.DEPOSIT_LOCKED),
                uint8(Enums.TxStatus.MINT_PROOF_ACCEPTED)
            )
        );
        vm.prank(ALICE);
        connector.closeTx(txId);
    }

    function test_closeTx_CleansTxData() public {
        bytes32 txId = _doDeposit();
        connector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_mintProofInputs(txId)), txId);
        vm.warp(block.timestamp + ACK_WINDOW + 1);

        vm.prank(ALICE);
        connector.closeTx(txId);

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        assertEq(t.txId, bytes32(0));
        assertEq(t.amount, 0);
        assertEq(t.from, address(0));
    }

    /*//////////////////////////////////////////////////////////////
                    submitDepositProof TESTS
    //////////////////////////////////////////////////////////////*/

    function test_submitDepositProof_Snarkjs_HappyPath() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        bytes memory pub = abi.encode(
            txId, AMOUNT, ALICE, BOB, address(token), address(dstTokenMock), SRC_CONNECTOR, address(connector), deadline
        );
        bytes memory proof = _buildSnarkProof(pub);
        bytes32 proofHash = keccak256(proof);
        bytes32 commitment = keccak256(pub);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.FundsReleased(
            txId,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            ALICE,
            BOB,
            SRC_CONNECTOR,
            address(connector),
            uint64(block.timestamp),
            Enums.ProofType.SNARKJS,
            proofHash,
            commitment,
            proof
        );

        connector.submitDepositProof(
            Enums.ProofType.SNARKJS,
            proof,
            txId,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            ALICE,
            BOB,
            SRC_CONNECTOR,
            deadline
        );

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINTED_IN_HOLDING));

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        assertEq(t.amount, AMOUNT);
        assertEq(t.from, ALICE);
        assertEq(t.to, BOB);
        assertEq(t.srcChainConnector, SRC_CONNECTOR);
        assertEq(t.dstChainConnector, address(connector));
        assertEq(t.ackDeadline, deadline);
        assertEq(uint8(t.status), uint8(Enums.TxStatus.MINTED_IN_HOLDING));
    }

    function test_submitDepositProof_Risc0_HappyPath() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        bytes memory pub = abi.encode(
            txId, AMOUNT, ALICE, BOB, address(token), address(dstTokenMock), SRC_CONNECTOR, address(connector), deadline
        );
        bytes memory proof = _buildRisc0Proof(pub);

        connector.submitDepositProof(
            Enums.ProofType.RISC0,
            proof,
            txId,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            ALICE,
            BOB,
            SRC_CONNECTOR,
            deadline
        );

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINTED_IN_HOLDING));
    }

    function test_submitDepositProof_RevertsWhen_TxAlreadyExists() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);

        bytes memory pub2 = abi.encode(
            txId, AMOUNT, ALICE, BOB, address(token), address(dstTokenMock), SRC_CONNECTOR, address(connector), deadline
        );
        bytes memory proof2 = _buildSnarkProof(pub2);

        vm.expectRevert(abi.encodeWithSelector(Errors.TxAlreadyExists.selector, txId));
        connector.submitDepositProof(
            Enums.ProofType.SNARKJS,
            proof2,
            txId,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            ALICE,
            BOB,
            SRC_CONNECTOR,
            deadline
        );
    }

    function test_submitDepositProof_RevertsWhen_CommitmentMismatch() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;

        vm.expectRevert();
        connector.submitDepositProof(
            Enums.ProofType.SNARKJS,
            _buildSnarkProofBadCommitment(),
            txId,
            AMOUNT,
            address(token),
            address(dstTokenMock),
            ALICE,
            BOB,
            SRC_CONNECTOR,
            deadline
        );
    }

    /*//////////////////////////////////////////////////////////////
                      submitAckProof TESTS
    //////////////////////////////////////////////////////////////*/

    function test_submitAckProof_HappyPath() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);

        bytes memory pub = _ackProofInputs(txId);
        bytes memory proof = _buildSnarkProof(pub);
        bytes32 proofHash = keccak256(proof);
        bytes32 commitment = keccak256(pub);

        ConnectorStorage.CrossChainTx memory snap = connector.getTx(txId);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.AckAccepted(
            txId,
            snap.amount,
            snap.currencyFrom,
            snap.currencyTo,
            snap.from,
            snap.to,
            snap.srcChainConnector,
            snap.dstChainConnector,
            snap.timestamp,
            Enums.ProofType.SNARKJS,
            proofHash,
            commitment,
            proof
        );

        connector.submitAckProof(Enums.ProofType.SNARKJS, proof, txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }

    function test_submitAckProof_Risc0_HappyPath() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);

        bytes memory proof = _buildRisc0Proof(_ackProofInputs(txId));
        connector.submitAckProof(Enums.ProofType.RISC0, proof, txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }

    function test_submitAckProof_RevertsWhen_NotMintedInHolding() public {
        bytes32 fake = bytes32(uint256(0x999));
        bytes memory proof = _buildSnarkProof(abi.encode(fake, SRC_CONNECTOR, address(connector)));

        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.InvalidStateTransition.selector,
                uint8(Enums.TxStatus.NONE),
                uint8(Enums.TxStatus.MINTED_IN_HOLDING)
            )
        );
        connector.submitAckProof(Enums.ProofType.SNARKJS, proof, fake);
    }

    function test_submitAckProof_RevertsWhen_CommitmentMismatch() public {
        bytes32 txId = bytes32(uint256(0xABC));
        _doDestDeposit(txId, uint64(block.timestamp) + ACK_WINDOW);

        vm.expectRevert();
        connector.submitAckProof(Enums.ProofType.SNARKJS, _buildSnarkProofBadCommitment(), txId);
    }

    function test_submitAckProof_CleansTxData() public {
        bytes32 txId = bytes32(uint256(0xABC));
        _doDestDeposit(txId, uint64(block.timestamp) + ACK_WINDOW);

        connector.submitAckProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_ackProofInputs(txId)), txId);

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        assertEq(t.txId, bytes32(0));
        assertEq(t.amount, 0);
    }

    function test_submitAckProof_CleansProofTracking() public {
        bytes32 txId = bytes32(uint256(0xABC));
        _doDestDeposit(txId, uint64(block.timestamp) + ACK_WINDOW);

        bytes memory proof = _buildSnarkProof(_ackProofInputs(txId));
        bytes32 depositProofHash = keccak256(
            _buildSnarkProof(
                abi.encode(
                    txId,
                    AMOUNT,
                    ALICE,
                    BOB,
                    address(token),
                    address(dstTokenMock),
                    SRC_CONNECTOR,
                    address(connector),
                    uint64(block.timestamp) + ACK_WINDOW
                )
            )
        );

        connector.submitAckProof(Enums.ProofType.SNARKJS, proof, txId);

        assertFalse(connector.txProofUsed(txId, depositProofHash));
    }

    /*//////////////////////////////////////////////////////////////
                  submitRefundClaimProof TESTS
    //////////////////////////////////////////////////////////////*/

    function test_submitRefundClaimProof_HappyPath() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);

        vm.warp(deadline + 1);

        bytes memory pub = _refundClaimInputs(txId);
        bytes memory proof = _buildSnarkProof(pub);
        bytes32 proofHash = keccak256(proof);
        bytes32 commitment = keccak256(pub);

        ConnectorStorage.CrossChainTx memory snap = connector.getTx(txId);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.RefundClaimAccepted(
            txId,
            snap.amount,
            snap.currencyFrom,
            snap.currencyTo,
            snap.from,
            snap.to,
            snap.srcChainConnector,
            snap.dstChainConnector,
            snap.timestamp,
            Enums.ProofType.SNARKJS,
            proofHash,
            commitment,
            proof
        );

        connector.submitRefundClaimProof(Enums.ProofType.SNARKJS, proof, txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_CLAIM_ACCEPTED));
    }

    function test_submitRefundClaimProof_RevertsWhen_NotMintedInHolding() public {
        bytes32 fake = bytes32(uint256(0x999));
        bytes memory proof = _buildSnarkProof(abi.encode(fake, SRC_CONNECTOR, AMOUNT));

        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.InvalidStateTransition.selector,
                uint8(Enums.TxStatus.NONE),
                uint8(Enums.TxStatus.MINTED_IN_HOLDING)
            )
        );
        connector.submitRefundClaimProof(Enums.ProofType.SNARKJS, proof, fake);
    }

    function test_submitRefundClaimProof_RevertsWhen_AckWindowNotExpired() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);

        bytes memory proof = _buildSnarkProof(_refundClaimInputs(txId));

        vm.expectRevert(abi.encodeWithSelector(Errors.AckWindowNotExpired.selector, deadline, uint64(block.timestamp)));
        connector.submitRefundClaimProof(Enums.ProofType.SNARKJS, proof, txId);
    }

    function test_submitRefundClaimProof_RevertsWhen_CommitmentMismatch() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);

        vm.warp(deadline + 1);

        vm.expectRevert();
        connector.submitRefundClaimProof(Enums.ProofType.SNARKJS, _buildSnarkProofBadCommitment(), txId);
    }

    /*//////////////////////////////////////////////////////////////
                        executeBurn TESTS
    //////////////////////////////////////////////////////////////*/

    function test_executeBurn_HappyPath() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);
        vm.warp(deadline + 1);
        connector.submitRefundClaimProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_refundClaimInputs(txId)), txId);

        ConnectorStorage.CrossChainTx memory snap = connector.getTx(txId);

        vm.expectEmit(true, true, true, true);
        emit ConnectorStorage.DestTxClosed(
            txId,
            snap.amount,
            snap.currencyFrom,
            snap.currencyTo,
            snap.from,
            snap.to,
            snap.srcChainConnector,
            snap.dstChainConnector,
            snap.timestamp
        );

        connector.executeBurn(txId);

        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }

    function test_executeBurn_RevertsWhen_NotRefundClaimAccepted() public {
        bytes32 txId = bytes32(uint256(0xABC));
        _doDestDeposit(txId, uint64(block.timestamp) + ACK_WINDOW);

        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.InvalidStateTransition.selector,
                uint8(Enums.TxStatus.MINTED_IN_HOLDING),
                uint8(Enums.TxStatus.REFUND_CLAIM_ACCEPTED)
            )
        );
        connector.executeBurn(txId);
    }

    function test_executeBurn_CleansTxData() public {
        bytes32 txId = bytes32(uint256(0xABC));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);
        vm.warp(deadline + 1);
        connector.submitRefundClaimProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_refundClaimInputs(txId)), txId);

        connector.executeBurn(txId);

        ConnectorStorage.CrossChainTx memory t = connector.getTx(txId);
        assertEq(t.txId, bytes32(0));
        assertEq(t.amount, 0);
        assertEq(t.from, address(0));
    }

    /*//////////////////////////////////////////////////////////////
                    FULL FLOW INTEGRATION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_flow_OriginHappyPath() public {
        bytes32 txId = _doDeposit();
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.DEPOSIT_LOCKED));

        connector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_mintProofInputs(txId)), txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINT_PROOF_ACCEPTED));

        vm.warp(block.timestamp + ACK_WINDOW + 1);
        vm.prank(ALICE);
        connector.closeTx(txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }

    function test_flow_OriginRefundFromDeposit() public {
        bytes32 txId = _doDeposit();

        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_INITIATED));

        connector.submitBurnProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_burnProofInputs(txId)), txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
        assertEq(token.balanceOf(ALICE), AMOUNT);
    }

    function test_flow_OriginRefundFromMintProof() public {
        bytes32 txId = _doDeposit();

        connector.submitMintProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_mintProofInputs(txId)), txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINT_PROOF_ACCEPTED));

        vm.warp(block.timestamp + ACK_WINDOW + 1);
        connector.initiateRefund(txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_INITIATED));

        connector.submitBurnProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_burnProofInputs(txId)), txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
        assertEq(token.balanceOf(ALICE), AMOUNT);
    }

    function test_flow_DestinationHappyPath() public {
        bytes32 txId = bytes32(uint256(0xF100));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINTED_IN_HOLDING));

        connector.submitAckProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_ackProofInputs(txId)), txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }

    function test_flow_DestinationRefundPath() public {
        bytes32 txId = bytes32(uint256(0xF100));
        uint64 deadline = uint64(block.timestamp) + ACK_WINDOW;
        _doDestDeposit(txId, deadline);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.MINTED_IN_HOLDING));

        vm.warp(deadline + 1);
        connector.submitRefundClaimProof(Enums.ProofType.SNARKJS, _buildSnarkProof(_refundClaimInputs(txId)), txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.REFUND_CLAIM_ACCEPTED));

        connector.executeBurn(txId);
        assertEq(uint8(connector.txStatus(txId)), uint8(Enums.TxStatus.NONE));
    }
}
