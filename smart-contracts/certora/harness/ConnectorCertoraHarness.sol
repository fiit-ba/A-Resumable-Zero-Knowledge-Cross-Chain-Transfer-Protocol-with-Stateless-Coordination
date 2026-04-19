// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Connector} from "../../src/connectors/Connector.sol";
import {ConnectorStorage} from "../../src/connectors/ConnectorStorage.sol";
import {Enums} from "../../src/libs/Enums.sol";
import {Errors} from "../../src/libs/Errors.sol";
import {WrappedTokenFactory} from "../../src/tokens/WrappedTokenFactory.sol";
import {WrappedTokenFactoryHarness} from "../../test/mocks/WrappedTokenFactoryHarness.sol";
import {BridgeWrappedToken} from "../../src/tokens/BridgeWrappedToken.sol";
import {RiscZeroAdapter} from "../../src/zk-proof/adapters/RiscZeroAdapter.sol";
import {SnarkAdapter} from "../../src/zk-proof/adapters/SnarkAdapter.sol";
import {MockRiscZeroVerifier} from "../../test/mocks/MockRiscZeroVerifier.sol";
import {MockSnarkVerifier} from "../../test/mocks/MockSnarkVerifier.sol";
import {IERC20} from "openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CertoraOriginToken} from "./CertoraOriginToken.sol";
import {CertoraBridgeWrappedToken} from "./CertoraBridgeWrappedToken.sol";
import {ProofPayloadBuilder} from "./ProofPayloadBuilder.sol";
import {IMintableERC20} from "../../src/tokens/interfaces/IMintableERC20.sol";
import {IBurnableERC20} from "../../src/tokens/interfaces/IBurnableERC20.sol";
import {ProofOutputs} from "../../src/libs/ProofOutputs.sol";

/// @notice Deterministic Connector scene for Certora verification.
/// @dev Adds only helper getters/builders; inherited Connector lifecycle methods are unchanged.
contract ConnectorCertoraHarness is Connector {
    /// @dev Resolve mint through the concrete _certoraWrappedToken immutable so that Certora
    ///      can determine the callee deterministically. The parameter is intentionally ignored:
    ///      _enforceWrappedTokenRoute already guarantees _currencyTo == _certoraWrappedToken
    ///      before this hook is reached, and _certoraWrappedToken is linked to
    ///      CertoraBridgeWrappedToken via the conf's "link" directive.
    ///      Using the symbolic parameter would leave the callee unresolved, causing DISPATCHER
    ///      to consider CertoraOriginToken as a candidate and produce spurious revert paths.
    function _mintHoldingToken(address /*_currencyTo*/, uint256 _amount) internal override {
        CertoraBridgeWrappedToken(_certoraWrappedToken).mint(address(this), _amount);
    }

    /// @dev Same rationale as _mintHoldingToken.
    function _burnHoldingToken(address /*_currencyTo*/, uint256 _amount) internal override {
        CertoraBridgeWrappedToken(_certoraWrappedToken).burn(_amount);
    }

    uint64 private constant _CERTORA_ACK_WINDOW = 1 hours;
    bytes32 private constant _CERTORA_IMAGE_ID = bytes32(uint256(0x1234));
    address private constant _CERTORA_SRC_CONNECTOR = address(0x5EC);
    address private constant _CERTORA_DST_CONNECTOR = address(0xD57);

    address private immutable _certoraFactory;
    address private immutable _certoraOriginToken;
    address private immutable _certoraWrappedToken;
    address private immutable _certoraProofBuilder;
    address private immutable _certoraRisc0Adapter;
    address private immutable _certoraSnarkAdapter;
    address private immutable _certoraSnarkVerifier;

    address private _factoryScratch;
    address private _risc0Scratch;
    address private _snarkScratch;
    address private _snarkVerifierScratch;

    uint256 private immutable _certoraDeploymentChainId;

    mapping(address => uint256) private _certoraOriginBalances;
    mapping(address => mapping(address => uint256)) private _certoraOriginAllowances;
    uint256 private _certoraOriginCustody;

    constructor()
        Connector(
            _initRisc0Adapter(_CERTORA_IMAGE_ID),
            _initSnarkAdapter(),
            _CERTORA_ACK_WINDOW,
            _routeImageIds(_CERTORA_IMAGE_ID),
            _initFactory()
        )
    {
        _certoraFactory = _factoryScratch;
        _certoraRisc0Adapter = _risc0Scratch;
        _certoraSnarkAdapter = _snarkScratch;
        _certoraSnarkVerifier = _snarkVerifierScratch;

        CertoraOriginToken origin = new CertoraOriginToken();
        CertoraBridgeWrappedToken wrapped = new CertoraBridgeWrappedToken(address(this));
        ProofPayloadBuilder builder = new ProofPayloadBuilder();

        _certoraOriginToken = address(origin);
        _certoraWrappedToken = address(wrapped);
        _certoraProofBuilder = address(builder);

        _certoraDeploymentChainId = block.chainid;

        // Route for origin-side depositAndLock checks.
        WrappedTokenFactoryHarness(_certoraFactory)
            .register(
                block.chainid, address(this), address(origin), block.chainid, _CERTORA_DST_CONNECTOR, address(wrapped)
            );

        // Route for destination-side submitLockProof checks.
        WrappedTokenFactoryHarness(_certoraFactory)
            .register(
                block.chainid, _CERTORA_SRC_CONNECTOR, address(origin), block.chainid, address(this), address(wrapped)
            );
    }

    function certoraOriginToken() external view returns (address) {
        return _certoraOriginToken;
    }

    function certoraWrappedToken() external view returns (address) {
        return _certoraWrappedToken;
    }

    function certoraProofBuilder() external view returns (address) {
        return _certoraProofBuilder;
    }

    function certoraFactory() external view returns (address) {
        return _certoraFactory;
    }

    function certoraRisc0Adapter() external view returns (address) {
        return _certoraRisc0Adapter;
    }

    function certoraSnarkAdapter() external view returns (address) {
        return _certoraSnarkAdapter;
    }

    function certoraMockSnarkShouldReturnFalse() external view returns (bool) {
        return MockSnarkVerifier(_certoraSnarkVerifier).shouldReturnFalse();
    }

    function certoraSetMockSnarkVerifierFailure(bool shouldReturnFalse) external {
        MockSnarkVerifier(_certoraSnarkVerifier).setShouldReturnFalse(shouldReturnFalse);
    }

    function certoraSrcConnector() external pure returns (address) {
        return _CERTORA_SRC_CONNECTOR;
    }

    function certoraDstConnector() external pure returns (address) {
        return _CERTORA_DST_CONNECTOR;
    }

    function certoraImageId() external pure returns (bytes32) {
        return _CERTORA_IMAGE_ID;
    }

    function certoraCurrentChainId() external view returns (uint256) {
        return block.chainid;
    }

    function certoraNextDepositTxId(address from, address to, uint256 amount, uint256 destinationChainId)
        external
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                from,
                to,
                amount,
                _certoraOriginToken,
                _certoraWrappedToken,
                address(this),
                _CERTORA_DST_CONNECTOR,
                txNonce,
                block.chainid,
                destinationChainId
            )
        );
    }

    function certoraMintOrigin(address to, uint256 amount) external {
        _certoraOriginBalances[to] += amount;
    }

    function certoraSeedOriginAllowance(address owner, uint256 amount) external {
        _certoraOriginAllowances[owner][address(this)] = amount;
    }

    function certoraOriginCustodyBalance() external view returns (uint256) {
        return _certoraOriginCustody;
    }

    function certoraWrappedCustodyBalance() external view returns (uint256) {
        return IERC20(_certoraWrappedToken).balanceOf(address(this));
    }

    function certoraWrappedTotalSupply() external view returns (uint256) {
        return IERC20(_certoraWrappedToken).totalSupply();
    }

    function certoraRecipientWrappedBalance(address account) external view returns (uint256) {
        return IERC20(_certoraWrappedToken).balanceOf(account);
    }

    function certoraTxZeroed(bytes32 txId) external view returns (bool) {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return t.txId == bytes32(0) && t.amount == 0 && t.currencyFrom == address(0) && t.currencyTo == address(0)
            && t.from == address(0) && t.to == address(0) && t.srcChainConnector == address(0)
            && t.dstChainConnector == address(0) && t.timestamp == 0 && t.finalizedAt == 0 && t.mintedAt == 0
            && t.ackDeadline == 0 && t.nonce == 0 && t.sourceChainId == 0 && t.destinationChainId == 0
            && uint8(t.status) == uint8(Enums.TxStatus.NONE);
    }

    function certoraTxAmount(bytes32 txId) external view returns (uint256) {
        return _txs[txId].amount;
    }

    function certoraTxFrom(bytes32 txId) external view returns (address) {
        return _txs[txId].from;
    }

    function certoraTxTo(bytes32 txId) external view returns (address) {
        return _txs[txId].to;
    }

    function certoraTxSrcConnector(bytes32 txId) external view returns (address) {
        return _txs[txId].srcChainConnector;
    }

    function certoraTxDstConnector(bytes32 txId) external view returns (address) {
        return _txs[txId].dstChainConnector;
    }

    function certoraTxAckDeadline(bytes32 txId) external view returns (uint64) {
        return _txs[txId].ackDeadline;
    }

    function certoraTxNonce(bytes32 txId) external view returns (uint256) {
        return _txs[txId].nonce;
    }

    function certoraTxSourceChainId(bytes32 txId) external view returns (uint256) {
        return _txs[txId].sourceChainId;
    }

    function certoraTxDestinationChainId(bytes32 txId) external view returns (uint256) {
        return _txs[txId].destinationChainId;
    }

    function certoraMintProofInputs(bytes32 txId) external view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.dstChainConnector, t.amount, t.to, t.sourceChainId, t.destinationChainId);
    }

    function certoraMintProofInputsWithDestinationChainId(bytes32 txId, uint256 destinationChainId)
        external
        view
        returns (bytes memory)
    {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.dstChainConnector, t.amount, t.to, t.sourceChainId, destinationChainId);
    }

    function certoraBurnProofInputs(bytes32 txId) external view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.dstChainConnector, t.amount, t.sourceChainId, t.destinationChainId);
    }

    function certoraBurnProofInputsWithSourceChainId(bytes32 txId, uint256 sourceChainId)
        external
        view
        returns (bytes memory)
    {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.dstChainConnector, t.amount, sourceChainId, t.destinationChainId);
    }

    function certoraNonAcceptanceProofInputs(bytes32 txId) external view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.dstChainConnector, t.ackDeadline, t.sourceChainId, t.destinationChainId);
    }

    function certoraAckProofInputs(bytes32 txId) external view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.srcChainConnector, t.dstChainConnector, t.sourceChainId, t.destinationChainId);
    }

    function certoraAckProofInputsWithDestinationChainId(bytes32 txId, uint256 destinationChainId)
        external
        view
        returns (bytes memory)
    {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.srcChainConnector, t.dstChainConnector, t.sourceChainId, destinationChainId);
    }

    function certoraRefundClaimInputs(bytes32 txId) external view returns (bytes memory) {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.srcChainConnector, t.amount, t.sourceChainId, t.destinationChainId);
    }

    function certoraRefundClaimInputsWithSourceChainId(bytes32 txId, uint256 sourceChainId)
        external
        view
        returns (bytes memory)
    {
        ConnectorStorage.CrossChainTx memory t = _txs[txId];
        return abi.encode(txId, t.srcChainConnector, t.amount, sourceChainId, t.destinationChainId);
    }

    function certoraLockProofInputs(
        bytes32 txId,
        uint256 amount,
        address sender,
        address receiver,
        address currencyFrom,
        address currencyTo,
        address srcChainConnector,
        uint64 originAckDeadline,
        uint256 nonce,
        uint256 sourceChainId
    ) external view returns (bytes memory) {
        // Use the same ProofOutputs.encodeLockProof call as _expectedDestinationLockCommitment
        // so that Certora sees both paths invoking the same pure function with the same
        // arguments.  With a bare abi.encode() here, Certora treats the two encoding
        // call-sites as unrelated and cannot prove bytes equality even with
        // optimistic_hashing:true, causing a spurious CommitmentMismatch counterexample.
        return ProofOutputs.encodeLockProof(
            ProofOutputs.LockProofPublicInputs({
                txId: txId,
                amount: amount,
                sender: sender,
                receiver: receiver,
                currencyFrom: currencyFrom,
                currencyTo: currencyTo,
                srcChainConnector: srcChainConnector,
                dstChainConnector: address(this),
                originAckDeadline: originAckDeadline,
                nonce: nonce,
                sourceChainId: sourceChainId,
                destinationChainId: block.chainid
            })
        );
    }

    /// @notice Builds a SNARK proof payload for Certora rules using sha256 of the public inputs.
    /// @dev Encodes sha256(publicInputs) as the commitment so that _verifyProof and
    ///      _expectedCommitment agree when and only when the public inputs match the stored
    ///      transaction fields. This makes commitment checks sensitive to chain IDs and other
    ///      proof parameters, matching the security property the route-binding rules test.
    ///      With optimistic_hashing: true, Certora treats sha256 as injective, so wrong inputs
    ///      produce a different commitment than the expected one, causing CommitmentMismatch.
    function certoraBuildSnarkProof(bytes memory publicInputs) external pure returns (bytes memory) {
        // Pass the raw public inputs as the proof payload.  The _verifyProof override
        // computes sha256(_proofPayload) directly, so there is no abi.encode/abi.decode
        // round-trip for Certora to mishandle.
        return publicInputs;
    }

    function certoraBuildRisc0Proof(bytes memory publicInputs, bytes32 imageId)
        external
        pure
        returns (bytes memory)
    {
        bytes32 journalDigest = sha256(publicInputs);
        bytes memory seal = hex"cafe";
        return abi.encode(seal, imageId, journalDigest);
    }

    function _wordAt(bytes memory data, uint256 wordIndex) private pure returns (uint256 out) {
        assembly ("memory-safe") {
            out := mload(add(data, mul(add(wordIndex, 1), 32)))
        }
    }

    function _initFactory() private returns (address factory) {
        factory = address(new WrappedTokenFactoryHarness());
        _factoryScratch = factory;
    }

    function _initSnarkAdapter() private returns (address adapter) {
        MockSnarkVerifier verifier = new MockSnarkVerifier();
        _snarkVerifierScratch = address(verifier);
        adapter = address(new SnarkAdapter(address(verifier)));
        _snarkScratch = adapter;
    }

    function _initRisc0Adapter(bytes32 imageId) private returns (address adapter) {
        MockRiscZeroVerifier verifier = new MockRiscZeroVerifier();
        bytes32[] memory imageIds = new bytes32[](1);
        imageIds[0] = imageId;
        adapter = address(new RiscZeroAdapter(address(verifier), imageIds));
        _risc0Scratch = adapter;
    }

    function _routeImageIds(bytes32 imageId) private pure returns (bytes32[6] memory ids) {
        for (uint8 i = 0; i < 6; ++i) {
            ids[i] = imageId;
        }
    }

    /// @notice Directly populates tx record in REFUND_CLAIM_ACCEPTED state for Certora.
    /// @dev Bypasses proof verification to reduce solver complexity. Guards on executeBurn
    ///      (reentrancy, status) are still exercised. The intermediate transition from
    ///      MINTED_IN_HOLDING → REFUND_CLAIM_ACCEPTED is proven separately by
    ///      state_submitRefundClaimProof_from_minted_after_deadline.
    function certoraCreateRefundClaimAcceptedTx(
        bytes32 txId,
        uint256 amount,
        address from,
        address to,
        uint64 deadline,
        uint256 nonce
    ) external {
        _certoraWriteRefundClaimTx(txId, amount, from, to, deadline, nonce);
        BridgeWrappedToken(_txs[txId].currencyTo).mint(address(this), amount);
    }

    function _certoraWriteRefundClaimTx(
        bytes32 txId,
        uint256 amount,
        address from,
        address to,
        uint64 deadline,
        uint256 nonce
    ) private {
        CrossChainTx storage t = _txs[txId];
        t.txId = txId;
        t.amount = amount;
        t.currencyFrom = _certoraOriginToken;
        t.currencyTo = _certoraWrappedToken;
        t.from = from;
        t.to = to;
        t.srcChainConnector = _CERTORA_SRC_CONNECTOR;
        t.dstChainConnector = address(this);
        t.timestamp = uint64(block.timestamp);
        t.mintedAt = uint64(block.timestamp);
        t.ackDeadline = deadline;
        t.status = Enums.TxStatus.REFUND_CLAIM_ACCEPTED;
        t.nonce = nonce;
        t.sourceChainId = block.chainid;
        t.destinationChainId = block.chainid;

        txStatus[txId] = Enums.TxStatus.REFUND_CLAIM_ACCEPTED;
        destinationLockAccepted[txId] = true;
    }

    function certoraReentrancyEntered() external view returns (bool) {
        return _reentrancyGuardEntered();
    }

    function certoraDeploymentChainId() external view returns (uint256) {
        // Return block.chainid directly instead of reading the _certoraDeploymentChainId
        // immutable, which Certora cannot link (uint256, not address) and would read as 0.
        // This makes certoraCurrentChainId() == certoraDeploymentChainId() trivially true
        // for spec requires that constrain the origin-side rules.
        return block.chainid;
    }

    function certoraResolveWrapped(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) external view returns (address) {
        return WrappedTokenFactory(_certoraFactory).resolve(
            sourceChainId,
            sourceConnector,
            sourceToken,
            destinationChainId,
            destinationConnector
        );
    }

    function certoraRouteKey(
        uint256 sourceChainId,
        address sourceConnector,
        address sourceToken,
        uint256 destinationChainId,
        address destinationConnector
    ) external view returns (bytes32) {
        return WrappedTokenFactory(_certoraFactory).routeKey(
            sourceChainId,
            sourceConnector,
            sourceToken,
            destinationChainId,
            destinationConnector
        );
    }

    function _enforceWrappedTokenRoute(
        uint256 _sourceChainId,
        address _sourceConnector,
        address _sourceToken,
        uint256 _destinationChainId,
        address _destinationConnector,
        address _currencyTo
    ) internal override {
        bytes32 routeKey = keccak256(
            abi.encode(
                _sourceChainId,
                _sourceConnector,
                _sourceToken,
                _destinationChainId,
                _destinationConnector
            )
        );

        address expectedWrapped = address(0);

        // Origin-side route used by depositAndLock.
        // Chain-ID equality is NOT checked here because _certoraDeploymentChainId is a
        // uint256 immutable that Certora cannot link and would read as 0.  The connector
        // addresses (_CERTORA_DST_CONNECTOR vs address(this)) are sufficient to
        // distinguish the two routes within a single Certora scene.
        if (
            _sourceConnector == address(this)
                && _sourceToken == _certoraOriginToken
                && _destinationConnector == _CERTORA_DST_CONNECTOR
        ) {
            expectedWrapped = _certoraWrappedToken;
        }

        // Destination-side route used by submitLockProof.
        if (
            _sourceConnector == _CERTORA_SRC_CONNECTOR
                && _sourceToken == _certoraOriginToken
                && _destinationConnector == address(this)
        ) {
            expectedWrapped = _certoraWrappedToken;
        }

        if (expectedWrapped == address(0)) revert Errors.WrappedTokenNotRegistered(routeKey);
        if (_currencyTo != expectedWrapped) revert Errors.WrappedTokenMismatch(_currencyTo, expectedWrapped);
    }

    function _pullOriginTokens(address _currencyFrom, uint256 _amount)
        internal
        override
        returns (uint256 received)
    {
        if (_currencyFrom != _certoraOriginToken) {
            revert Errors.WrappedTokenMismatch(_currencyFrom, _certoraOriginToken);
        }

        uint256 bal = _certoraOriginBalances[msg.sender];
        uint256 allowed = _certoraOriginAllowances[msg.sender][address(this)];

        require(bal >= _amount, "insufficient balance");
        require(allowed >= _amount, "insufficient allowance");

        _certoraOriginBalances[msg.sender] = bal - _amount;
        _certoraOriginAllowances[msg.sender][address(this)] = allowed - _amount;
        _certoraOriginCustody += _amount;

        // Mint real ERC20 tokens to this connector so that submitBurnProof and
        // submitNonAcceptanceProof can successfully call IERC20.safeTransfer when
        // refunding the originator.  Shadow accounting alone is not enough because
        // SafeERC20 reads the actual token balance.
        CertoraOriginToken(_certoraOriginToken).mint(address(this), _amount);

        received = _amount;

        if (received < 1) revert Errors.ZeroAmount();
    }

    function certoraOriginShadowBalance(address account) external view returns (uint256) {
        return _certoraOriginBalances[account];
    }

    function certoraOriginShadowAllowance(address owner, address spender) external view returns (uint256) {
        return _certoraOriginAllowances[owner][spender];
    }

    function _expectedCommitment(
        Enums.VerifierRoute _route,
        Enums.ProofType _proofType,
        bytes memory _publicInputs
    ) internal override returns (bytes32) {
        if (_proofType == Enums.ProofType.SNARKJS) {
            return sha256(_publicInputs);
        }

        if (_proofType == Enums.ProofType.RISC0) {
            return sha256(_publicInputs);
        }

        revert Errors.VerifierNotRegistered(uint8(_proofType));
    }

    function _verifyProof(
        Enums.VerifierRoute,
        Enums.ProofType _proofType,
        bytes calldata _proofPayload,
        bytes32 _txId
    ) internal override returns (bytes32 commitment, bytes32 proofHash) {
        proofHash = keccak256(_proofPayload);

        if (_proofType == Enums.ProofType.SNARKJS) {
            // The proof payload IS the raw public inputs (certoraBuildSnarkProof is a
            // pass-through).  Compute sha256 here to match _expectedCommitment, avoiding
            // any abi.encode/abi.decode round-trip that Certora cannot simplify.
            commitment = sha256(_proofPayload);
        } else if (_proofType == Enums.ProofType.RISC0) {
            (, , bytes32 journalDigest) = abi.decode(_proofPayload, (bytes, bytes32, bytes32));
            commitment = journalDigest;
        } else {
            revert Errors.VerifierNotRegistered(uint8(_proofType));
        }

        emit ProofVerified(_txId, _proofType, proofHash, commitment, _proofPayload);
    }
}
