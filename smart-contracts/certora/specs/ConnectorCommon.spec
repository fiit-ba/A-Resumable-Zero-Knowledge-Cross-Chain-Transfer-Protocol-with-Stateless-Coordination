using ConnectorCertoraHarness as connector;

methods {
    function depositAndLock(address,address,address,uint256,address,uint256) external returns (bytes32);
    function submitMintProof(Enums.ProofType,bytes,bytes32) external;
    function initiateRefund(bytes32) external;
    function submitBurnProof(Enums.ProofType,bytes,bytes32) external;
    function submitNonAcceptanceProof(Enums.ProofType,bytes,bytes32) external;
    function submitLockProof(Enums.ProofType,bytes,bytes32,uint256,address,address,address,address,address,uint64,uint256,uint256) external;
    function submitAckProof(Enums.ProofType,bytes,bytes32) external;
    function submitRefundClaimProof(Enums.ProofType,bytes,bytes32) external;
    function executeBurn(bytes32) external;

    // External token calls made by Connector must be concretely dispatched in Certora runs.
    function CertoraBridgeWrappedToken.mint(address,uint256) external;
    function CertoraBridgeWrappedToken.burn(uint256) external;
    function CertoraBridgeWrappedToken.transfer(address,uint256) external returns (bool);
    function CertoraBridgeWrappedToken.balanceOf(address) external returns (uint256) envfree;
    function CertoraBridgeWrappedToken.totalSupply() external returns (uint256) envfree;

    // IMintableERC20 / IBurnableERC20 are not scene contracts so they cannot appear as
    // explicit receivers here. The wildcard entries below (_.mint, _.burn) already dispatch
    // those interface calls to CertoraBridgeWrappedToken via DISPATCHER(true).

    function CertoraOriginToken.transfer(address,uint256) external returns (bool);
    function CertoraOriginToken.balanceOf(address) external returns (uint256) envfree;
    function CertoraOriginToken.totalSupply() external returns (uint256) envfree;

    function txStatus(bytes32) external returns (Enums.TxStatus) envfree;
    function destinationLockAccepted(bytes32) external returns (bool) envfree;
    function ackWindowSeconds() external returns (uint64) envfree;
    function txNonce() external returns (uint256) envfree;
    function getExpectedRisc0ImageId(Enums.VerifierRoute) external returns (bytes32) envfree;

    function certoraOriginToken() external returns (address) envfree;
    function certoraWrappedToken() external returns (address) envfree;
    function certoraFactory() external returns (address) envfree;
    function certoraRisc0Adapter() external returns (address) envfree;
    function certoraSnarkAdapter() external returns (address) envfree;
    function certoraSrcConnector() external returns (address) envfree;
    function certoraDstConnector() external returns (address) envfree;
    function certoraImageId() external returns (bytes32) envfree;
    function certoraCurrentChainId() external returns (uint256) envfree;
    function certoraNextDepositTxId(address,address,uint256,uint256) external returns (bytes32) envfree;
    function certoraTxZeroed(bytes32) external returns (bool) envfree;
    function certoraTxAmount(bytes32) external returns (uint256) envfree;
    function certoraTxFrom(bytes32) external returns (address) envfree;
    function certoraTxTo(bytes32) external returns (address) envfree;
    function certoraTxSrcConnector(bytes32) external returns (address) envfree;
    function certoraTxDstConnector(bytes32) external returns (address) envfree;
    function certoraTxAckDeadline(bytes32) external returns (uint64) envfree;
    function certoraTxNonce(bytes32) external returns (uint256) envfree;
    function certoraTxSourceChainId(bytes32) external returns (uint256) envfree;
    function certoraTxDestinationChainId(bytes32) external returns (uint256) envfree;
    function certoraMintOrigin(address,uint256) external;
    function certoraSeedOriginAllowance(address,uint256) external;
    function certoraOriginCustodyBalance() external returns (uint256) envfree;
    function certoraWrappedCustodyBalance() external returns (uint256) envfree;
    function certoraWrappedTotalSupply() external returns (uint256) envfree;
    function certoraRecipientWrappedBalance(address) external returns (uint256) envfree;
    function certoraMintProofInputs(bytes32) external returns (bytes) envfree;
    function certoraMintProofInputsWithDestinationChainId(bytes32,uint256) external returns (bytes) envfree;
    function certoraBurnProofInputs(bytes32) external returns (bytes) envfree;
    function certoraBurnProofInputsWithSourceChainId(bytes32,uint256) external returns (bytes) envfree;
    function certoraNonAcceptanceProofInputs(bytes32) external returns (bytes) envfree;
    function certoraAckProofInputs(bytes32) external returns (bytes) envfree;
    function certoraAckProofInputsWithDestinationChainId(bytes32,uint256) external returns (bytes) envfree;
    function certoraRefundClaimInputs(bytes32) external returns (bytes) envfree;
    function certoraRefundClaimInputsWithSourceChainId(bytes32,uint256) external returns (bytes) envfree;
    function certoraLockProofInputs(bytes32,uint256,address,address,address,address,address,uint64,uint256,uint256) external returns (bytes) envfree;
    function certoraBuildSnarkProof(bytes) external returns (bytes) envfree;
    function certoraBuildRisc0Proof(bytes,bytes32) external returns (bytes) envfree;
    function certoraCreateRefundClaimAcceptedTx(bytes32,uint256,address,address,uint64,uint256) external;
    function certoraReentrancyEntered() external returns (bool) envfree;
    function certoraDeploymentChainId() external returns (uint256) envfree;

    function certoraOriginShadowBalance(address) external returns (uint256) envfree;
    function certoraOriginShadowAllowance(address,address) external returns (uint256) envfree;

    function SnarkAdapter.computeCommitment(bytes) external returns (bytes32) envfree;
    function SnarkAdapter.verify(bytes) external returns (bytes32) envfree;

    function RiscZeroAdapter.computeCommitment(bytes) external returns (bytes32) envfree;
    function RiscZeroAdapter.verify(bytes) external returns (bytes32) envfree;

    function MockSnarkVerifier.verify(uint256[2],uint256[2][2],uint256[2],uint256[]) external returns (bool);
    function MockRiscZeroVerifier.verify(bytes,bytes32,bytes32) external;

    function getVerifier(Enums.VerifierRoute, Enums.ProofType) external returns (address) envfree;

    function _.mint(address, uint256) external => DISPATCHER(true);
    function _.burn(uint256) external => DISPATCHER(true);
    function _.transfer(address, uint256) external => DISPATCHER(true);
    function _.transferFrom(address, address, uint256) external => DISPATCHER(true);

    unresolved external in ConnectorCertoraHarness._ => HAVOC_ECF;
}

definition PROOF_RISC0() returns Enums.ProofType = Enums.ProofType.RISC0;
definition PROOF_SNARK() returns Enums.ProofType = Enums.ProofType.SNARKJS;

definition ROUTE_ORIGIN_MINT() returns Enums.VerifierRoute = Enums.VerifierRoute.ORIGIN_MINT;
definition ROUTE_ORIGIN_BURN() returns Enums.VerifierRoute = Enums.VerifierRoute.ORIGIN_BURN;
definition ROUTE_DEST_LOCK() returns Enums.VerifierRoute = Enums.VerifierRoute.DEST_LOCK;
definition ROUTE_DEST_ACK() returns Enums.VerifierRoute = Enums.VerifierRoute.DEST_ACK;
definition ROUTE_DEST_REFUND_CLAIM() returns Enums.VerifierRoute = Enums.VerifierRoute.DEST_REFUND_CLAIM;

definition STATUS_NONE() returns Enums.TxStatus = Enums.TxStatus.NONE;
definition STATUS_DEPOSIT_LOCKED() returns Enums.TxStatus = Enums.TxStatus.DEPOSIT_LOCKED;
definition STATUS_REFUND_INITIATED() returns Enums.TxStatus = Enums.TxStatus.REFUND_INITIATED;
definition STATUS_MINTED_IN_HOLDING() returns Enums.TxStatus = Enums.TxStatus.MINTED_IN_HOLDING;
definition STATUS_REFUND_CLAIM_ACCEPTED() returns Enums.TxStatus = Enums.TxStatus.REFUND_CLAIM_ACCEPTED;

definition SEL_DEPOSIT_AND_LOCK() returns uint32 =
    sig:depositAndLock(address,address,address,uint256,address,uint256).selector;
definition SEL_SUBMIT_MINT_PROOF() returns uint32 =
    sig:submitMintProof(Enums.ProofType,bytes,bytes32).selector;
definition SEL_INITIATE_REFUND() returns uint32 =
    sig:initiateRefund(bytes32).selector;
definition SEL_SUBMIT_BURN_PROOF() returns uint32 =
    sig:submitBurnProof(Enums.ProofType,bytes,bytes32).selector;
definition SEL_SUBMIT_NON_ACCEPTANCE_PROOF() returns uint32 =
    sig:submitNonAcceptanceProof(Enums.ProofType,bytes,bytes32).selector;
definition SEL_SUBMIT_LOCK_PROOF() returns uint32 =
    sig:submitLockProof(Enums.ProofType,bytes,bytes32,uint256,address,address,address,address,address,uint64,uint256,uint256).selector;
definition SEL_SUBMIT_ACK_PROOF() returns uint32 =
    sig:submitAckProof(Enums.ProofType,bytes,bytes32).selector;
definition SEL_SUBMIT_REFUND_CLAIM_PROOF() returns uint32 =
    sig:submitRefundClaimProof(Enums.ProofType,bytes,bytes32).selector;
definition SEL_EXECUTE_BURN() returns uint32 =
    sig:executeBurn(bytes32).selector;

definition isConnectorMutator(method f) returns bool =
    f.contract == currentContract
    && (
        f.selector == SEL_DEPOSIT_AND_LOCK()
        || f.selector == SEL_SUBMIT_MINT_PROOF()
        || f.selector == SEL_INITIATE_REFUND()
        || f.selector == SEL_SUBMIT_BURN_PROOF()
        || f.selector == SEL_SUBMIT_NON_ACCEPTANCE_PROOF()
        || f.selector == SEL_SUBMIT_LOCK_PROOF()
        || f.selector == SEL_SUBMIT_ACK_PROOF()
        || f.selector == SEL_SUBMIT_REFUND_CLAIM_PROOF()
        || f.selector == SEL_EXECUTE_BURN()
    );

definition canIncreaseOriginCustody(method f) returns bool =
    f.selector == SEL_DEPOSIT_AND_LOCK();

definition canDecreaseOriginCustody(method f) returns bool =
    f.selector == SEL_SUBMIT_BURN_PROOF()
    || f.selector == SEL_SUBMIT_NON_ACCEPTANCE_PROOF();

definition canIncreaseWrappedCustody(method f) returns bool =
    f.selector == SEL_SUBMIT_LOCK_PROOF();

definition canDecreaseWrappedCustody(method f) returns bool =
    f.selector == SEL_SUBMIT_ACK_PROOF()
    || f.selector == SEL_EXECUTE_BURN();

definition canDecreaseWrappedSupply(method f) returns bool =
    f.selector == SEL_EXECUTE_BURN();

definition canIncreaseRecipientWrapped(method f) returns bool =
    f.selector == SEL_SUBMIT_ACK_PROOF();

function assertTxCleaned(bytes32 txId) {
    assert txStatus(txId) == STATUS_NONE();
    assert certoraTxZeroed(txId);
}

function createOriginDeposit(env e, address from, address to, uint256 amount) returns bytes32 {
    require from != 0;
    require from != currentContract;
    require to != 0;
    require amount > 0;
    require e.msg.sender == from;
    require e.msg.value == 0;
    require !certoraReentrancyEntered();
    require certoraCurrentChainId() == certoraDeploymentChainId();
    require txNonce() < max_uint256;
    require e.block.timestamp + ackWindowSeconds() <= max_uint64;

    address origin = certoraOriginToken();
    address wrapped = certoraWrappedToken();
    address dst = certoraDstConnector();
    uint256 chainId = certoraCurrentChainId();

    require origin != 0;
    require wrapped != 0;
    require dst != 0;

    // prevent overflow in certoraMintOrigin(...)
    require certoraOriginShadowBalance(from) <= max_uint256 - amount;

    // prevent overflow in _pullOriginTokens(...)
    require certoraOriginCustodyBalance() <= max_uint256 - amount;

    bytes32 expectedTxId = certoraNextDepositTxId(from, to, amount, chainId);
    require txStatus(expectedTxId) == STATUS_NONE();

    certoraMintOrigin(e, from, amount);
    certoraSeedOriginAllowance(e, from, amount);

    bytes32 txId = depositAndLock@withrevert(e, origin, wrapped, to, amount, dst, chainId);
    assert !lastReverted;
    assert txId == expectedTxId;
    return txId;
}

function createDestinationHolding(
    env e,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce,
    uint256 sourceChainId
) {
    require e.msg.value == 0;
    require !certoraReentrancyEntered();
    require amount > 0;
    require from != 0;
    require to != 0;
    require e.block.timestamp < deadline;

    address origin = certoraOriginToken();
    address wrapped = certoraWrappedToken();
    address src = certoraSrcConnector();

    // prevent overflow in BridgeWrappedToken.mint (openZeppelin math)
    require certoraWrappedTotalSupply() <= max_uint256 - amount;
    require certoraRecipientWrappedBalance(to) <= max_uint256 - amount;

    bytes lockInputs =
        certoraLockProofInputs(txId, amount, from, to, origin, wrapped, src, deadline, nonce, sourceChainId);
    bytes proof = certoraBuildSnarkProof(lockInputs);

    submitLockProof@withrevert(
        e,
        PROOF_SNARK(),
        proof,
        txId,
        amount,
        origin,
        wrapped,
        from,
        to,
        src,
        deadline,
        nonce,
        sourceChainId
    );
    assert !lastReverted;
}

function snarkMintProof(bytes32 txId) returns bytes {
    bytes inputs = certoraMintProofInputs(txId);
    return certoraBuildSnarkProof(inputs);
}

function snarkBurnProof(bytes32 txId) returns bytes {
    bytes inputs = certoraBurnProofInputs(txId);
    return certoraBuildSnarkProof(inputs);
}

function snarkAckProof(bytes32 txId) returns bytes {
    bytes inputs = certoraAckProofInputs(txId);
    return certoraBuildSnarkProof(inputs);
}

function snarkRefundClaimProof(bytes32 txId) returns bytes {
    bytes inputs = certoraRefundClaimInputs(txId);
    return certoraBuildSnarkProof(inputs);
}

function createRefundClaimAcceptedState(
    env e,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce
) {
    require e.msg.value == 0;
    require from != 0;
    require to != 0;
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);

    // prevent overflow in BridgeWrappedToken.mint (openZeppelin math)
    require certoraWrappedTotalSupply() <= max_uint256 - amount;
    require certoraRecipientWrappedBalance(from) <= max_uint256 - amount;

    certoraCreateRefundClaimAcceptedTx(e, txId, amount, from, to, deadline, nonce);
}
