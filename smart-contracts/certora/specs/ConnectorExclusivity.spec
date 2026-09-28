import "./ConnectorCommon.spec";

use builtin rule sanity;

rule exclusivity_ack_first_blocks_refund_claim(
    env eLock,
    env eAck,
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
    require eAck.block.timestamp >= certoraTxAckDeadline(txId);
    require eLate.block.timestamp >= certoraTxAckDeadline(txId);
    require eAck.msg.value == 0;
    require eLate.msg.value == 0;
    require !certoraReentrancyEntered();

    bytes ackProof = snarkAckProof(txId);
    submitAckProof@withrevert(eAck, PROOF_SNARK(), ackProof, txId);
    assert !lastReverted;

    bytes refundProof = snarkRefundClaimProof(txId);
    submitRefundClaimProof@withrevert(eLate, PROOF_SNARK(), refundProof, txId);
    assert lastReverted;
}

rule exclusivity_refund_claim_first_blocks_ack(
    env eLock,
    env eLate,
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
    require eLate.block.timestamp >= certoraTxAckDeadline(txId);
    require eLate.msg.value == 0;
    require eAck.msg.value == 0;
    require !certoraReentrancyEntered();

    bytes refundProof = snarkRefundClaimProof(txId);
    submitRefundClaimProof@withrevert(eLate, PROOF_SNARK(), refundProof, txId);
    assert !lastReverted;
    assert txStatus(txId) == STATUS_REFUND_CLAIM_ACCEPTED();

    bytes ackProof = snarkAckProof(txId);
    submitAckProof@withrevert(eAck, PROOF_SNARK(), ackProof, txId);
    assert lastReverted;
}

rule exclusivity_submitMintProof_blocks_origin_refund_resolution(
    env eDeposit,
    env eMint,
    env eRefund,
    env eBurn,
    address from,
    address to,
    uint256 amount
) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eMint.block.timestamp < certoraTxAckDeadline(txId);
    require eRefund.block.timestamp >= certoraTxAckDeadline(txId);
    require eMint.msg.value == 0;
    require eRefund.msg.value == 0;
    require eBurn.msg.value == 0;
    require !certoraReentrancyEntered();

    bytes mintProof = snarkMintProof(txId);
    submitMintProof@withrevert(eMint, PROOF_SNARK(), mintProof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);

    initiateRefund@withrevert(eRefund, txId);
    assert lastReverted;

    bytes burnProof = snarkBurnProof(txId);
    submitBurnProof@withrevert(eBurn, PROOF_SNARK(), burnProof, txId);
    assert lastReverted;
}
