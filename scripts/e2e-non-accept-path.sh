#!/usr/bin/env bash
# scripts/e2e-non-accept-path.sh
#
# E2E non-acceptance refund flow (the destination never accepted the lock):
#   1. Deploy both chains with `make deploy-prod-full`; set the finality delays
#   2. Deposit on the source chain and relay nothing to the destination
#   3. Move both chains to the ACK deadline
#   4. relay-resume → refund-initiate, then non-accept-proof: with a destination finality delay
#      the source must refuse the proof (FinalityNotReached) until the source clock has moved
#      past it
#   5. Check that the sender got the tokens back and both records are closed
#
# Prerequisite: source and destination profiles must support time-warp
# (local-anvil or local-hardhat).
#
# Flags: identical to e2e-refund-path.sh; the delay used here is
#   --destination-finality-delay <seconds>   (default: 0, check off)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./lib/e2e-common.sh
source "$SCRIPT_DIR/lib/e2e-common.sh"

# ── Usage ───────────────────────────────────────────────────────────────────
export E2E_USAGE="Usage: $0 [OPTIONS]

Run the non-acceptance refund flow (deposit → time-warp → refund-initiate → non-accept-proof).

IMPORTANT: Both source and destination profiles must support local time-warp
(local-anvil or local-hardhat).

Options: as in e2e-refund-path.sh --help. The delay this flow checks is
  --destination-finality-delay <seconds>  Destination network delay held by the source connector;
                                          the non-acceptance proof must wait it out (default: 0, off)

Examples:
  $0 --proof-backend test --destination-finality-delay 3600
"

# ── Parse args, apply defaults, validate ────────────────────────────────────
e2e_parse_args "$@"
e2e_apply_profile_defaults
assert_time_warp_capable
e2e_validate_prerequisites
ensure_stateless_client_ready

# ── Deploy contracts ─────────────────────────────────────────────────────────
deploy_contracts
set_finality_delays

# ── Deposit, never relayed ───────────────────────────────────────────────────
align_chain_clocks
perform_deposit
SOURCE_BALANCE_LOCKED="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"

# Warp to the deadline, not past it, so the refund proof still falls inside the finality delay.
echo "Ack deadline: $ACK_DEADLINE — warping both chains to it..."
warp_both_chains_past "$ACK_DEADLINE"

# ── refund-initiate stage ────────────────────────────────────────────────────
echo "Running relay-resume for refund-initiate..."
run_relay_resume_for_action "refund-initiate"
REFUND_INITIATE_TX="$LAST_SUBMISSION_TX_HASH"

# ── non-accept-proof stage ───────────────────────────────────────────────────
if [[ "$DEST_FINALITY_DELAY" != "0" ]]; then
    echo "Running relay-resume for non-accept-proof before the ${DEST_FINALITY_DELAY}s destination finality delay..."
    expect_finality_not_reached "non-accept-proof"
    echo "Moving the source clock past the destination finality delay..."
    advance_chain_time "$SOURCE_RPC" "$DEST_FINALITY_DELAY"
fi

echo "Running relay-resume for non-accept-proof..."
run_relay_resume_for_action "non-accept-proof"
NON_ACCEPT_TX="$LAST_SUBMISSION_TX_HASH"

# ── Final assertions ─────────────────────────────────────────────────────────
SOURCE_STATUS_FINAL="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
DEST_STATUS_FINAL="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"
if [[ "$SOURCE_STATUS_FINAL" != "0" ]]; then
    echo "Source status mismatch after the refund: expected 0 (NONE), got $SOURCE_STATUS_FINAL" >&2; exit 1
fi
if [[ "$DEST_STATUS_FINAL" != "0" ]]; then
    echo "Destination status mismatch: expected 0 (NONE), got $DEST_STATUS_FINAL" >&2; exit 1
fi

SOURCE_BALANCE_AFTER="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
if (( SOURCE_BALANCE_AFTER - SOURCE_BALANCE_LOCKED != AMOUNT_WEI )); then
    echo "Sender went $SOURCE_BALANCE_LOCKED -> $SOURCE_BALANCE_AFTER on the source, expected +$AMOUNT_WEI back" >&2; exit 1
fi

echo ""
echo "Done — non-acceptance refund complete."
echo "txId:                 $TX_ID"
echo "sourceConnector:      $SOURCE_CONNECTOR"
echo "destConnector:        $DEST_CONNECTOR"
echo "refund-initiate tx:   $REFUND_INITIATE_TX"
echo "non-accept-proof tx:  $NON_ACCEPT_TX"
echo "sourceStatus (final): $SOURCE_STATUS_FINAL  (expected 0 = NONE)"
echo "destStatus (final):   $DEST_STATUS_FINAL  (expected 0 = NONE)"
echo "source balance:       $SOURCE_BALANCE_LOCKED (after deposit) -> $SOURCE_BALANCE_AFTER"
