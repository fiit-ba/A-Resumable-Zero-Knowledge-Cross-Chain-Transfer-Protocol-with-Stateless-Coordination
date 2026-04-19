import "./ConnectorCommon.spec";

use builtin rule sanity;

rule route_binding_submitMintProof_wrong_destination_chain_reverts(
    env eDeposit,
    env eMint,
    address from,
    address to,
    uint256 amount,
    uint256 wrongDestinationChainId
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eMint.block.timestamp < certoraTxAckDeadline(txId);
    require wrongDestinationChainId != certoraTxDestinationChainId(txId);

    bytes wrongInputs = certoraMintProofInputsWithDestinationChainId(txId, wrongDestinationChainId);
    bytes wrongProof = certoraBuildSnarkProof(wrongInputs);
    submitMintProof@withrevert(eMint, PROOF_SNARK(), wrongProof, txId);
    assert lastReverted;
}

rule route_binding_submitBurnProof_wrong_source_chain_reverts(
    env eDeposit,
    env eRefund,
    env eBurn,
    address from,
    address to,
    uint256 amount,
    uint256 wrongSourceChainId
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eRefund.msg.sender == from;
    require eRefund.msg.value == 0;
    require eRefund.block.timestamp >= certoraTxAckDeadline(txId);
    initiateRefund@withrevert(eRefund, txId);
    assert !lastReverted;

    require wrongSourceChainId != certoraTxSourceChainId(txId);
    bytes wrongInputs = certoraBurnProofInputsWithSourceChainId(txId, wrongSourceChainId);
    bytes wrongProof = certoraBuildSnarkProof(wrongInputs);
    submitBurnProof@withrevert(eBurn, PROOF_SNARK(), wrongProof, txId);
    assert lastReverted;
}

rule route_binding_submitAckProof_wrong_destination_chain_reverts(
    env eLock,
    env eAck,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce,
    uint256 wrongDestinationChainId
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    createDestinationHolding(eLock, txId, amount, from, to, deadline, nonce, certoraCurrentChainId());

    require wrongDestinationChainId != certoraTxDestinationChainId(txId);
    bytes wrongInputs = certoraAckProofInputsWithDestinationChainId(txId, wrongDestinationChainId);
    bytes wrongProof = certoraBuildSnarkProof(wrongInputs);
    submitAckProof@withrevert(eAck, PROOF_SNARK(), wrongProof, txId);
    assert lastReverted;
}

rule route_binding_submitRefundClaimProof_wrong_source_chain_reverts(
    env eLock,
    env eLate,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce,
    uint256 wrongSourceChainId
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    createDestinationHolding(eLock, txId, amount, from, to, deadline, nonce, certoraCurrentChainId());
    require eLate.block.timestamp >= certoraTxAckDeadline(txId);

    require wrongSourceChainId != certoraTxSourceChainId(txId);
    bytes wrongInputs = certoraRefundClaimInputsWithSourceChainId(txId, wrongSourceChainId);
    bytes wrongProof = certoraBuildSnarkProof(wrongInputs);
    submitRefundClaimProof@withrevert(eLate, PROOF_SNARK(), wrongProof, txId);
    assert lastReverted;
}

rule route_binding_submitLockProof_expired_deadline_reverts(
    env e,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 expiredDeadline,
    uint256 nonce
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    require e.block.timestamp >= expiredDeadline;
    require amount > 0;
    require to != 0;

    address origin = certoraOriginToken();
    address wrapped = certoraWrappedToken();
    address src = certoraSrcConnector();
    bytes lockInputs =
        certoraLockProofInputs(txId, amount, from, to, origin, wrapped, src, expiredDeadline, nonce, certoraCurrentChainId());
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
        expiredDeadline,
        nonce,
        certoraCurrentChainId()
    );
    assert lastReverted;
}

rule route_binding_submitLockProof_route_mismatch_reverts(
    env e,
    bytes32 txId,
    uint256 amount,
    address from,
    address to,
    uint64 deadline,
    uint256 nonce,
    address wrongWrapped
) {
    require txStatus(txId) == STATUS_NONE();
    require !destinationLockAccepted(txId);
    require e.block.timestamp < deadline;
    require amount > 0;
    require to != 0;
    require wrongWrapped != certoraWrappedToken();

    address origin = certoraOriginToken();
    address src = certoraSrcConnector();
    bytes lockInputs =
        certoraLockProofInputs(txId, amount, from, to, origin, wrongWrapped, src, deadline, nonce, certoraCurrentChainId());
    bytes proof = certoraBuildSnarkProof(lockInputs);

    submitLockProof@withrevert(
        e,
        PROOF_SNARK(),
        proof,
        txId,
        amount,
        origin,
        wrongWrapped,
        from,
        to,
        src,
        deadline,
        nonce,
        certoraCurrentChainId()
    );
    assert lastReverted;
}

rule route_binding_replay_after_ack_cleanup_reverts(
    env eLock,
    env eAck,
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

    bytes ackProof = snarkAckProof(txId);
    require eAck.msg.value == 0;
    submitAckProof@withrevert(eAck, PROOF_SNARK(), ackProof, txId);
    assert !lastReverted;
    assert destinationLockAccepted(txId);
    assert txStatus(txId) == STATUS_NONE();

    address origin = certoraOriginToken();
    address wrapped = certoraWrappedToken();
    address src = certoraSrcConnector();
    bytes lockInputs =
        certoraLockProofInputs(txId, amount, from, to, origin, wrapped, src, deadline, nonce, certoraCurrentChainId());
    bytes lockProof = certoraBuildSnarkProof(lockInputs);
    submitLockProof@withrevert(
        eReplay,
        PROOF_SNARK(),
        lockProof,
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

rule route_binding_replay_after_executeBurn_cleanup_reverts(
    env eLock,
    env eLate,
    env eBurn,
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
    require eLate.block.timestamp >= certoraTxAckDeadline(txId);

    bytes refundProof = snarkRefundClaimProof(txId);
    require eLate.msg.value == 0;
    submitRefundClaimProof@withrevert(eLate, PROOF_SNARK(), refundProof, txId);
    assert !lastReverted;

    require eBurn.msg.value == 0;
    executeBurn@withrevert(eBurn, txId);
    assert !lastReverted;
    assert destinationLockAccepted(txId);
    assert txStatus(txId) == STATUS_NONE();

    address origin = certoraOriginToken();
    address wrapped = certoraWrappedToken();
    address src = certoraSrcConnector();
    bytes lockInputs =
        certoraLockProofInputs(txId, amount, from, to, origin, wrapped, src, deadline, nonce, certoraCurrentChainId());
    bytes lockProof = certoraBuildSnarkProof(lockInputs);
    submitLockProof@withrevert(
        eReplay,
        PROOF_SNARK(),
        lockProof,
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

rule route_binding_risc0_wrong_image_id_reverts_for_origin_mint(
    env eDeposit,
    env eMint,
    address from,
    address to,
    uint256 amount,
    bytes32 wrongImageId
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eMint.block.timestamp < certoraTxAckDeadline(txId);
    require wrongImageId != getExpectedRisc0ImageId(ROUTE_ORIGIN_MINT());

    bytes inputs = certoraMintProofInputs(txId);
    bytes wrongProof = certoraBuildRisc0Proof(inputs, wrongImageId);
    submitMintProof@withrevert(eMint, PROOF_RISC0(), wrongProof, txId);
    assert lastReverted;
}

rule route_binding_risc0_origin_mint_reachable(env eDeposit, env eMint, address from, address to, uint256 amount) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eMint.block.timestamp < certoraTxAckDeadline(txId);

    bytes inputs = certoraMintProofInputs(txId);
    bytes proof = certoraBuildRisc0Proof(inputs, getExpectedRisc0ImageId(ROUTE_ORIGIN_MINT()));
    require eMint.msg.value == 0;
    submitMintProof@withrevert(eMint, PROOF_RISC0(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
}

rule route_binding_risc0_origin_burn_reachable(
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
    require eRefund.block.timestamp >= certoraTxAckDeadline(txId);
    initiateRefund@withrevert(eRefund, txId);
    assert !lastReverted;

    bytes inputs = certoraBurnProofInputs(txId);
    bytes proof = certoraBuildRisc0Proof(inputs, getExpectedRisc0ImageId(ROUTE_ORIGIN_BURN()));
    require eBurn.msg.value == 0;
    submitBurnProof@withrevert(eBurn, PROOF_RISC0(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
}

rule route_binding_risc0_dest_lock_reachable(
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
    require eLock.block.timestamp < deadline;
    require amount > 0;
    require to != 0;

    address origin = certoraOriginToken();
    address wrapped = certoraWrappedToken();
    address src = certoraSrcConnector();
    bytes lockInputs =
        certoraLockProofInputs(txId, amount, from, to, origin, wrapped, src, deadline, nonce, certoraCurrentChainId());
    bytes proof = certoraBuildRisc0Proof(lockInputs, getExpectedRisc0ImageId(ROUTE_DEST_LOCK()));

    require eLock.msg.value == 0;
    submitLockProof@withrevert(
        eLock,
        PROOF_RISC0(),
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
    assert !lastReverted;
    assert txStatus(txId) == STATUS_MINTED_IN_HOLDING();
}

rule route_binding_risc0_dest_ack_reachable(
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

    bytes inputs = certoraAckProofInputs(txId);
    bytes proof = certoraBuildRisc0Proof(inputs, getExpectedRisc0ImageId(ROUTE_DEST_ACK()));
    require eAck.msg.value == 0;
    submitAckProof@withrevert(eAck, PROOF_RISC0(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
}

rule route_binding_risc0_dest_refund_claim_reachable(
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

    bytes inputs = certoraRefundClaimInputs(txId);
    bytes proof = certoraBuildRisc0Proof(inputs, getExpectedRisc0ImageId(ROUTE_DEST_REFUND_CLAIM()));
    require eLate.msg.value == 0;
    submitRefundClaimProof@withrevert(eLate, PROOF_RISC0(), proof, txId);
    assert !lastReverted;
    assert txStatus(txId) == STATUS_REFUND_CLAIM_ACCEPTED();
}
