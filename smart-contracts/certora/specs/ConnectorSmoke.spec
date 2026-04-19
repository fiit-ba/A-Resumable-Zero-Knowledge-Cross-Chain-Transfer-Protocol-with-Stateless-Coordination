import "./ConnectorCommon.spec";

use builtin rule sanity;

rule smoke_state_origin_mint_cleans(env eDeposit, env eMint, address from, address to, uint256 amount) {
    bytes32 txId = createOriginDeposit(eDeposit, from, to, amount);
    require eMint.block.timestamp < certoraTxAckDeadline(txId);
    bytes proof = snarkMintProof(txId);
    submitMintProof@withrevert(eMint, PROOF_SNARK(), proof, txId);
    assert !lastReverted;
    assertTxCleaned(txId);
}

rule smoke_exclusivity_ack_then_refund_reverts(
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
    require eLate.block.timestamp >= certoraTxAckDeadline(txId);

    submitAckProof@withrevert(eAck, PROOF_SNARK(), snarkAckProof(txId), txId);
    assert !lastReverted;

    submitRefundClaimProof@withrevert(eLate, PROOF_SNARK(), snarkRefundClaimProof(txId), txId);
    assert lastReverted;
}

rule smoke_custody_supply_decrease_only_on_execute_burn(env e, method f, calldataarg args)
filtered { f -> isConnectorMutator(f) }
{
    uint256 beforeSupply = certoraWrappedTotalSupply();
    currentContract.f@withrevert(e, args);
    uint256 afterSupply = certoraWrappedTotalSupply();

    if (!lastReverted) {
        assert (afterSupply < beforeSupply) => canDecreaseWrappedSupply(f);
    }

    assert true;
}

rule smoke_route_risc0_dest_lock_reachable(
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
}
