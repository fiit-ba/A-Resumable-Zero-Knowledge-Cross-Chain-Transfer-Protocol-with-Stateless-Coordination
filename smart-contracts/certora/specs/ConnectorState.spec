import "./ConnectorCommon.spec";

use builtin rule sanity;

rule state_depositAndLock_sets_deposit_locked(env e, address from, address to, uint256 amount) {
    bytes32 txId = createOriginDeposit(e, from, to, amount);
    assert txStatus(txId) == STATUS_DEPOSIT_LOCKED();
}

rule state_submitMintProof_from_deposit_locked_cleans(
    env eDeposit,
    env eMint,
    address from,
    address to,
    uint256 amount
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eMint.block.timestamp < certoraTxAckDeadline(txId);
    require eMint.msg.value == 0;
    require !certoraReentrancyEntered();

    bytes proof = snarkMintProof(txId);
    submitMintProof@withrevert(eMint, PROOF_SNARK(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
}

rule state_submitMintProof_wrong_status_reverts(env e, bytes32 txId) {
    require txStatus(txId) != STATUS_DEPOSIT_LOCKED();
    bytes proof = snarkMintProof(txId);
    submitMintProof@withrevert(e, PROOF_SNARK(), proof, txId);
    assert lastReverted;
}

rule state_initiateRefund_from_deposit_locked_after_deadline(
    env eDeposit,
    env eRefund,
    address from,
    address to,
    uint256 amount
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);

    require eRefund.msg.sender == from;
    require eRefund.msg.value == 0;
    require !certoraReentrancyEntered();
    require eRefund.block.timestamp >= certoraTxAckDeadline(txId);

    initiateRefund@withrevert(eRefund, txId);
    assert !lastReverted;
    assert txStatus(txId) == STATUS_REFUND_INITIATED();
}

rule state_initiateRefund_wrong_status_reverts(env e, bytes32 txId) {
    require e.msg.value == 0;
    require txStatus(txId) != STATUS_DEPOSIT_LOCKED();

    initiateRefund@withrevert(e, txId);
    assert lastReverted;
}

rule state_submitBurnProof_from_refund_initiated_cleans(
    env eDeposit,
    env eRefund,
    env eBurn,
    address from,
    address to,
    uint256 amount
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eRefund.msg.sender == from;
    require eRefund.msg.value == 0;
    require !certoraReentrancyEntered();
    require eRefund.block.timestamp >= certoraTxAckDeadline(txId);
    initiateRefund@withrevert(eRefund, txId);
    assert !lastReverted;

    require eBurn.msg.value == 0;
    require !certoraReentrancyEntered();
    bytes proof = snarkBurnProof(txId);
    submitBurnProof@withrevert(eBurn, PROOF_SNARK(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
}

rule state_submitBurnProof_wrong_status_reverts(env e, bytes32 txId) {
    require txStatus(txId) != STATUS_REFUND_INITIATED();
    bytes proof = snarkBurnProof(txId);
    submitBurnProof@withrevert(e, PROOF_SNARK(), proof, txId);
    assert lastReverted;
}

rule state_submitNonAcceptanceProof_from_refund_initiated_cleans(
    env eDeposit,
    env eRefund,
    env eProof,
    address from,
    address to,
    uint256 amount
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eRefund.msg.sender == from;
    require eRefund.msg.value == 0;
    require !certoraReentrancyEntered();
    require eRefund.block.timestamp >= certoraTxAckDeadline(txId);
    initiateRefund@withrevert(eRefund, txId);
    assert !lastReverted;

    require eProof.msg.value == 0;
    require !certoraReentrancyEntered();
    bytes nonAcceptInputs = certoraNonAcceptanceProofInputs(txId);
    bytes proof = certoraBuildSnarkProof(nonAcceptInputs);
    submitNonAcceptanceProof@withrevert(eProof, PROOF_SNARK(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
}

rule state_submitNonAcceptanceProof_wrong_status_reverts(env e, bytes32 txId) {
    require txStatus(txId) != STATUS_REFUND_INITIATED();
    bytes proof = certoraBuildSnarkProof(certoraNonAcceptanceProofInputs(txId));
    submitNonAcceptanceProof@withrevert(e, PROOF_SNARK(), proof, txId);
    assert lastReverted;
}

rule state_submitLockProof_sets_minted_in_holding(
    env eLock,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    createDestinationHolding(eLock, txId, amount, from, to, deadline, nonce, certoraCurrentChainId());

    assert txStatus(txId) == STATUS_MINTED_IN_HOLDING();
    assert destinationLockAccepted(txId);
}

rule state_submitLockProof_replay_reverts(
    env eLock,
    env eReplay,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    createDestinationHolding(eLock, txId, amount, from, to, deadline, nonce, certoraCurrentChainId());

    address origin = certoraOriginToken();
    address wrapped = certoraWrappedToken();
    address src = certoraSrcConnector();
    bytes lockInputs =
        certoraLockProofInputs(txId, amount, from, to, origin, wrapped, src, deadline, nonce, certoraCurrentChainId());
    bytes proof = certoraBuildSnarkProof(lockInputs);

    submitLockProof@withrevert(
        eReplay,
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
        certoraCurrentChainId()
    );
    assert lastReverted;
}

rule state_submitAckProof_from_minted_in_holding_cleans(
    env eLock,
    env eAck,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    createDestinationHolding(eLock, txId, amount, from, to, deadline, nonce, certoraCurrentChainId());

    require eAck.msg.value == 0;
    require !certoraReentrancyEntered();
    bytes proof = snarkAckProof(txId);
    submitAckProof@withrevert(eAck, PROOF_SNARK(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
    assert destinationLockAccepted(txId);
}

rule state_submitAckProof_wrong_status_reverts(env e, bytes32 txId) {
    require txStatus(txId) != STATUS_MINTED_IN_HOLDING();
    bytes proof = snarkAckProof(txId);
    submitAckProof@withrevert(e, PROOF_SNARK(), proof, txId);
    assert lastReverted;
}

rule state_submitRefundClaimProof_from_minted_after_deadline(
    env eLock,
    env eLate,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    createDestinationHolding(eLock, txId, amount, from, to, deadline, nonce, certoraCurrentChainId());
    require eLate.block.timestamp >= certoraTxAckDeadline(txId);
    require eLate.msg.value == 0;
    require !certoraReentrancyEntered();

    bytes proof = snarkRefundClaimProof(txId);
    submitRefundClaimProof@withrevert(eLate, PROOF_SNARK(), proof, txId);
    assert !lastReverted;
    assert txStatus(txId) == STATUS_REFUND_CLAIM_ACCEPTED();
}

rule state_submitRefundClaimProof_wrong_status_reverts(env e, bytes32 txId) {
    require txStatus(txId) != STATUS_MINTED_IN_HOLDING();
    bytes proof = snarkRefundClaimProof(txId);
    submitRefundClaimProof@withrevert(e, PROOF_SNARK(), proof, txId);
    assert lastReverted;
}

/// @notice executeBurn from REFUND_CLAIM_ACCEPTED cleans the tx and preserves the lock tombstone.
/// @dev The intermediate transition MINTED_IN_HOLDING → REFUND_CLAIM_ACCEPTED is proven by
///      state_submitRefundClaimProof_from_minted_after_deadline. Here we use a direct harness
///      setup to avoid chaining three heavy proof-verification calls which exceeds solver capacity.
rule state_executeBurn_from_refund_claim_accepted_cleans(
    env eSetup,
    env eBurn,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce
) {
    createRefundClaimAcceptedState(eSetup, txId, amount, from, to, deadline, nonce);
    // Direct harness setup can start from arbitrary token storage; constrain to states where
    // wrapped custody is sufficient for the burn amount (the reachable protocol condition).
    require certoraWrappedCustodyBalance() >= amount;

    require eBurn.msg.value == 0;
    require !certoraReentrancyEntered();

    executeBurn@withrevert(eBurn, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
    assert destinationLockAccepted(txId);
}

rule state_executeBurn_wrong_status_reverts(env e, bytes32 txId) {
    require e.msg.value == 0;
    require txStatus(txId) != STATUS_REFUND_CLAIM_ACCEPTED();

    executeBurn@withrevert(e, txId);
    assert lastReverted;
}
