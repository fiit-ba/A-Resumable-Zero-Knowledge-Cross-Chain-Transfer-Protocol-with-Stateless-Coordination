#!/usr/bin/env bash
# scripts/e2e-refund-path.sh
#
# E2E refund-path relay flow (the destination accepted the lock, the ack never came):
#   1. Deploy both chains with `make deploy-prod-full`; set the finality delays
#   2. Deposit on the source chain and relay the lock proof (relay-resume → lock)
#   3. Move both chains to the ACK deadline
#   4. relay-resume → refund-initiate, then refund-claim: with a source finality delay the
#      destination must refuse the claim (FinalityNotReached) until the destination clock has
#      moved past it
#   5. relay-resume → execute-burn → burn-proof, then check statuses and balances
#
# Prerequisite: source and destination profiles must support time-warp
# (local-anvil or local-hardhat).  Public/testnet profiles abort immediately
# with a capability error rather than wasting time on long-running work.
#
# Flags: identical to e2e-happy-path.sh plus the finality delays.
#   --source-finality-delay <seconds>   (default: 0, check off)
#   --ack-window <seconds>              ACK deadline window (default: 3600)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./lib/e2e-common.sh
source "$SCRIPT_DIR/lib/e2e-common.sh"

# Keep the refund path aligned with the production/default one-hour ACK window.
ACK_WINDOW_SECONDS="${ACK_WINDOW_SECONDS:-3600}"

# ── Usage ───────────────────────────────────────────────────────────────────
export E2E_USAGE="Usage: $0 [OPTIONS]

Run the refund-path relay flow (lock → time-warp → refund-initiate → refund-claim → execute-burn → burn-proof).

IMPORTANT: Both source and destination profiles must support local time-warp
(local-anvil or local-hardhat).  Public/testnet profiles will fail fast.

Network selection:
  --source-profile <profile>         Source network profile (default: local-anvil)
  --source-network <profile>         Alias for --source-profile
  --destination-profile <profile>    Destination network profile (default: local-hardhat)
  --destination-network <profile>    Alias for --destination-profile
  --source-rpc-url <url>             Override source RPC URL
  --destination-rpc-url <url>        Override destination RPC URL
  --source-chain-id <id>             Override source chain ID
  --destination-chain-id <id>        Override destination chain ID

Signing and amounts:
  --private-key <hex>                Signer private key (or set PRIVATE_KEY env var)
  --receiver <address>               Receiver on the destination (default: the signer)
  --amount <wei>                     Token amount for deposit (default: 1 ether)
  --ack-window <seconds>             ACK window in seconds (default: 3600)

Finality:
  --source-finality-delay <seconds>       Source network delay held by the destination connector;
                                          the refund claim must wait it out (default: 0, off)
  --destination-finality-delay <seconds>  Destination network delay held by the source connector
                                          (used by e2e-non-accept-path.sh; default: 0, off)

Proof runtime:
  --proof-backend <local|docker|test> Proof runner (default: local); test = SnarkJS test proofs
  --risc0-prover-mode <local|bonsai> RISC0 prover mode (default: local)

Deployment reuse (both sides; the token route and finality delays stay as deployed):
  --reuse-source, --reuse-dest
  --source-connector <addr>, --destination-connector <addr>

Misc:
  -h, --help

Examples:
  $0 --proof-backend test --source-finality-delay 3600
  $0 --source-profile local-hardhat --destination-profile local-anvil
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

# ── Deposit ──────────────────────────────────────────────────────────────────
align_chain_clocks
perform_deposit
SOURCE_BALANCE_LOCKED="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"

# ── lock stage ──────────────────────────────────────────────────────────────
lock_exec_block="${LOCK_EXECUTION_BLOCK:-$SOURCE_DEPOSIT_BLOCK}"
lock_exec_block="$(normalize_execution_block_tag "$lock_exec_block")"
echo "Lock execution block: $lock_exec_block"
wait_for_successor_execution_block "$SOURCE_RPC" "$lock_exec_block" "source-deposit"

echo "Running relay-resume for lock..."
run_relay_resume_for_action "lock" --lock-execution-block "$lock_exec_block"
LOCK_SUBMIT_TX="$LAST_SUBMISSION_TX_HASH"
DEST_FUNDS_RELEASED_BLOCK="$LAST_SUBMISSION_BLOCK"
DEST_HELD_BEFORE_BURN="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEST_CONNECTOR")"

# ── Move both chains to the ACK deadline ─────────────────────────────────────
# Warp to the deadline, not past it, so the refund proof still falls inside the finality delay.
echo "Ack deadline: $ACK_DEADLINE — warping both chains to it..."
warp_both_chains_past "$ACK_DEADLINE"

# ── refund-initiate stage ────────────────────────────────────────────────────
echo "Running relay-resume for refund-initiate..."
run_relay_resume_for_action "refund-initiate"
REFUND_INITIATE_TX="$LAST_SUBMISSION_TX_HASH"
SOURCE_REFUND_INITIATED_BLOCK="$LAST_SUBMISSION_BLOCK"

# ── refund-claim stage ───────────────────────────────────────────────────────
refund_claim_exec_block="${REFUND_CLAIM_EXECUTION_BLOCK:-$SOURCE_REFUND_INITIATED_BLOCK}"
refund_claim_exec_block="$(normalize_execution_block_tag "$refund_claim_exec_block")"
echo "Refund-claim execution block: $refund_claim_exec_block"
wait_for_successor_execution_block "$SOURCE_RPC" "$refund_claim_exec_block" "source-refund-initiated"

if [[ "$SOURCE_FINALITY_DELAY" != "0" ]]; then
    echo "Running relay-resume for refund-claim before the ${SOURCE_FINALITY_DELAY}s source finality delay..."
    expect_finality_not_reached "refund-claim" --refund-claim-execution-block "$refund_claim_exec_block"
    echo "Moving the destination clock past the source finality delay..."
    advance_chain_time "$DEST_RPC" "$SOURCE_FINALITY_DELAY"
fi

echo "Running relay-resume for refund-claim..."
run_relay_resume_for_action "refund-claim" --refund-claim-execution-block "$refund_claim_exec_block"
REFUND_CLAIM_TX="$LAST_SUBMISSION_TX_HASH"

# ── execute-burn stage ───────────────────────────────────────────────────────
echo "Running relay-resume for execute-burn..."
run_relay_resume_for_action "execute-burn"
EXECUTE_BURN_TX="$LAST_SUBMISSION_TX_HASH"
DEST_BURN_EXECUTED_BLOCK="$LAST_SUBMISSION_BLOCK"
DEST_HELD_AFTER_BURN="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEST_CONNECTOR")"

# ── burn-proof stage (may need eth_getBlockReceipts proxy) ───────────────────
burn_proof_exec_block="${BURN_PROOF_EXECUTION_BLOCK:-$DEST_BURN_EXECUTED_BLOCK}"
burn_proof_exec_block="$(normalize_execution_block_tag "$burn_proof_exec_block")"
echo "Burn-proof execution block: $burn_proof_exec_block"
wait_for_successor_execution_block "$DEST_RPC" "$burn_proof_exec_block" "destination-burn-executed"

# Probe for eth_getBlockReceipts support and launch proxy if needed.
DEST_RPC_FOR_BURN="$DEST_RPC"
ensure_block_receipts_available
# If proxy started, ensure_block_receipts_available sets DEST_RPC_FOR_BURN.

echo "Running relay-resume for burn-proof..."
run_relay_resume_for_action "burn-proof" \
    --destination-rpc-url "$DEST_RPC_FOR_BURN" \
    --burn-proof-execution-block "$burn_proof_exec_block"
BURN_PROOF_TX="$LAST_SUBMISSION_TX_HASH"

# ── Final assertions ─────────────────────────────────────────────────────────
SOURCE_STATUS_FINAL="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
DEST_STATUS_FINAL="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"

if [[ "$SOURCE_STATUS_FINAL" != "0" ]]; then
    echo "Source status mismatch after burn-proof: expected 0 (NONE), got $SOURCE_STATUS_FINAL" >&2; exit 1
fi
if [[ "$DEST_STATUS_FINAL" != "0" ]]; then
    echo "Destination status mismatch after burn-proof: expected 0 (NONE), got $DEST_STATUS_FINAL" >&2; exit 1
fi

SOURCE_BALANCE_AFTER="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
if (( SOURCE_BALANCE_AFTER - SOURCE_BALANCE_LOCKED != AMOUNT_WEI )); then
    echo "Sender went $SOURCE_BALANCE_LOCKED -> $SOURCE_BALANCE_AFTER on the source, expected +$AMOUNT_WEI back" >&2; exit 1
fi
if (( DEST_HELD_BEFORE_BURN - DEST_HELD_AFTER_BURN != AMOUNT_WEI )); then
    echo "executeBurn took $DEST_HELD_BEFORE_BURN -> $DEST_HELD_AFTER_BURN held wrapped tokens, expected -$AMOUNT_WEI" >&2; exit 1
fi

echo ""
echo "Done — refund path complete."
echo "txId:                        $TX_ID"
echo "sourceConnector:             $SOURCE_CONNECTOR"
echo "destConnector:               $DEST_CONNECTOR"
echo "sourceToken:                 $SOURCE_TOKEN"
echo "destToken:                   $DEST_TOKEN"
echo "lock submit tx:              $LOCK_SUBMIT_TX (dest block $DEST_FUNDS_RELEASED_BLOCK)"
echo "refund-initiate tx:          $REFUND_INITIATE_TX (source block $SOURCE_REFUND_INITIATED_BLOCK)"
echo "refund-claim tx:             $REFUND_CLAIM_TX"
echo "execute-burn tx:             $EXECUTE_BURN_TX (dest block $DEST_BURN_EXECUTED_BLOCK)"
echo "burn-proof tx:               $BURN_PROOF_TX"
echo "sourceStatus (final):        $SOURCE_STATUS_FINAL  (expected 0 = NONE)"
echo "destStatus (final):          $DEST_STATUS_FINAL    (expected 0 = NONE)"
echo "source balance:              $SOURCE_BALANCE_LOCKED (after deposit) -> $SOURCE_BALANCE_AFTER"
echo "held wrapped (dest):         $DEST_HELD_BEFORE_BURN -> $DEST_HELD_AFTER_BURN"
echo ""
echo "Reuse env:"
echo "  REUSE_SOURCE_DEPLOYMENTS=1 EXISTING_SOURCE_CONNECTOR=$SOURCE_CONNECTOR EXISTING_SOURCE_TOKEN=$SOURCE_TOKEN"
echo "  EXISTING_DEST_CONNECTOR=$DEST_CONNECTOR EXISTING_DEST_TOKEN=$DEST_TOKEN"
