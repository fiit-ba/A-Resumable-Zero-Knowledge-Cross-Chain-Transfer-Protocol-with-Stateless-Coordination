import "./ConnectorCommon.spec";

use builtin rule sanity;

rule custody_origin_token_changes_are_route_limited(env e, method f, calldataarg args)
filtered { f -> isConnectorMutator(f) }
{
    uint256 beforeBal = certoraOriginCustodyBalance();
    currentContract.f@withrevert(e, args);
    uint256 afterBal = certoraOriginCustodyBalance();

    if (!lastReverted) {
        assert (afterBal > beforeBal) => canIncreaseOriginCustody(f);
        assert (afterBal < beforeBal) => canDecreaseOriginCustody(f);
    }

    assert true;
}

rule custody_wrapped_connector_balance_changes_are_route_limited(env e, method f, calldataarg args)
filtered { f -> isConnectorMutator(f) }
{
    uint256 beforeBal = certoraWrappedCustodyBalance();
    currentContract.f@withrevert(e, args);
    uint256 afterBal = certoraWrappedCustodyBalance();

    if (!lastReverted) {
        assert (afterBal > beforeBal) => canIncreaseWrappedCustody(f);
        assert (afterBal < beforeBal) => canDecreaseWrappedCustody(f);
    }

    assert true;
}

rule custody_wrapped_supply_decrease_only_on_execute_burn(env e, method f, calldataarg args)
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

rule custody_recipient_payout_only_happens_on_ack(env e, method f, calldataarg args, address recipient)
filtered { f -> isConnectorMutator(f) }
{
    uint256 beforeRecipient = certoraRecipientWrappedBalance(recipient);
    currentContract.f@withrevert(e, args);
    uint256 afterRecipient = certoraRecipientWrappedBalance(recipient);

    if (!lastReverted) {
        assert (afterRecipient > beforeRecipient) => canIncreaseRecipientWrapped(f);
    }

    assert true;
}
