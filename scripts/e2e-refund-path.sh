#!/usr/bin/env bash
# scripts/e2e-refund-path.sh
#
# E2E refund-path relay flow:
#   1. Deploy contracts (source + destination)
#   2. Deposit on source chain and generate lock proof  (relay-resume → lock)
#   3. Warp both chains past the ACK deadline
#   4. Drive refund-initiate → refund-claim → execute-burn → burn-proof via relay-resume
#
# Prerequisite: source and destination profiles must support time-warp
# (local-anvil or local-hardhat).  Public/testnet profiles abort immediately
# with a capability error rather than wasting time on long-running work.
#
# Flags: identical to e2e-happy-path.sh plus refund-specific options.
#   --ack-window <seconds>   ACK deadline window (default: 3600)
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
  --amount <wei>                     Token amount for deposit (default: 1 ether)
  --ack-window <seconds>             ACK window in seconds (default: 60)

Proof runtime:
  --proof-backend <local|docker>     Proof runner (default: local)
  --risc0-prover-mode <local|bonsai> RISC0 prover mode (default: local)

Deployment reuse:
  --reuse-source, --reuse-dest
  --source-connector <addr>, --destination-connector <addr>

Misc:
  -h, --help

Examples:
  $0
  $0 --source-profile local-anvil --destination-profile local-hardhat
  $0 --source-profile local-hardhat --destination-profile local-anvil
"

# ── Capability gate ──────────────────────────────────────────────────────────
assert_time_warp_capable() {
    local src_method dest_method
    src_method="$(profile_time_warp_method "$SOURCE_NETWORK_PROFILE")"
    dest_method="$(profile_time_warp_method "$DEST_NETWORK_PROFILE")"

    if [[ "$src_method" == "none" || "$dest_method" == "none" ]]; then
        echo "ERROR: Refund path requires local time-warp support on both chains." >&2
        echo "  source profile '$SOURCE_NETWORK_PROFILE' -> time-warp: $src_method" >&2
        echo "  dest profile '$DEST_NETWORK_PROFILE' -> time-warp: $dest_method" >&2
        echo "Use local-anvil or local-hardhat for both profiles." >&2
        exit 1
    fi
}

# ── Parse args, apply defaults, validate ────────────────────────────────────
e2e_parse_args "$@"
e2e_apply_profile_defaults

# Fast-fail capability check before long-running work.
assert_time_warp_capable

e2e_validate_prerequisites
ensure_stateless_client_ready

# ── Deploy contracts ─────────────────────────────────────────────────────────
deploy_source_contracts
deploy_destination_contracts
deploy_destination_refund_verifiers

# Cross-wire connectors if freshly deployed.
if [[ "$REUSE_SOURCE_DEPLOYMENTS" != "1" || "$REUSE_DEST_DEPLOYMENTS" != "1" ]]; then
    echo "Linking source and destination connectors..."
    set_dest_tx="$(send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" "setDestinationConnector(address)" "$DEST_CONNECTOR")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$set_dest_tx" >/dev/null

    set_src_tx="$(send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" "setSourceConnector(address)" "$SOURCE_CONNECTOR")"
    wait_for_tx_receipt_block "$DEST_RPC" "$set_src_tx" >/dev/null
fi

# ── Mint tokens and deposit ──────────────────────────────────────────────────
echo "Minting $AMOUNT_WEI source tokens to $DEPLOYER_ADDRESS..."
mint_tx="$(send_tx_async "$SOURCE_RPC" \
    "$SOURCE_TOKEN" "mint(address,uint256)" "$DEPLOYER_ADDRESS" "$AMOUNT_WEI")"
wait_for_tx_receipt_block "$SOURCE_RPC" "$mint_tx" >/dev/null

SOURCE_BALANCE_BEFORE="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
DEST_BALANCE_BEFORE="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEPLOYER_ADDRESS")"
echo "Balances before: source=$SOURCE_BALANCE_BEFORE dest=$DEST_BALANCE_BEFORE"

perform_deposit

# ── lock stage ──────────────────────────────────────────────────────────────
lock_exec_block="${LOCK_EXECUTION_BLOCK:-$SOURCE_DEPOSIT_BLOCK}"
lock_exec_block="$(normalize_execution_block_tag "$lock_exec_block")"
echo "Lock execution block: $lock_exec_block"
wait_for_successor_execution_block "$SOURCE_RPC" "$lock_exec_block" "source-deposit"

echo "Running relay-resume for lock..."
run_relay_resume_for_action "lock" --lock-execution-block "$lock_exec_block"
LOCK_SUBMIT_TX="$LAST_SUBMISSION_TX_HASH"
DEST_FUNDS_RELEASED_BLOCK="$LAST_SUBMISSION_BLOCK"

# ── Warp both chains past the ACK deadline ───────────────────────────────────
# Read the ack deadline from the source connector for the deposited tx.
echo "Reading ack deadline for $TX_ID..."
ACK_DEADLINE="$(cast call "$SOURCE_CONNECTOR" "ackDeadline(bytes32)(uint256)" "$TX_ID" --rpc-url "$SOURCE_RPC" 2>/dev/null || true)"
if [[ ! "$ACK_DEADLINE" =~ ^[0-9]+$ || "$ACK_DEADLINE" == "0" ]]; then
    # Fallback: current timestamp + window * 2 to be safe.
    CURRENT_TS="$(get_chain_timestamp "$SOURCE_RPC")"
    ACK_DEADLINE=$(( CURRENT_TS + ACK_WINDOW_SECONDS * 2 ))
    echo "Could not read on-chain ack deadline; using computed deadline $ACK_DEADLINE."
fi
WARP_TARGET=$(( ACK_DEADLINE + 60 ))
echo "Ack deadline: $ACK_DEADLINE — warping both chains to $WARP_TARGET..."
warp_both_chains_past "$WARP_TARGET"

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

echo "Running relay-resume for refund-claim..."
run_relay_resume_for_action "refund-claim" --refund-claim-execution-block "$refund_claim_exec_block"
REFUND_CLAIM_TX="$LAST_SUBMISSION_TX_HASH"

# ── execute-burn stage ───────────────────────────────────────────────────────
echo "Running relay-resume for execute-burn..."
run_relay_resume_for_action "execute-burn"
EXECUTE_BURN_TX="$LAST_SUBMISSION_TX_HASH"
DEST_BURN_EXECUTED_BLOCK="$LAST_SUBMISSION_BLOCK"

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
SOURCE_FINAL_STATUS="$LAST_RESULTING_STATUS"

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
DEST_BALANCE_AFTER="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEPLOYER_ADDRESS")"

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
echo "source balance:              $SOURCE_BALANCE_BEFORE -> $SOURCE_BALANCE_AFTER"
echo "dest balance:                $DEST_BALANCE_BEFORE -> $DEST_BALANCE_AFTER"
echo ""
echo "Reuse env:"
echo "  REUSE_SOURCE_DEPLOYMENTS=1 EXISTING_SOURCE_CONNECTOR=$SOURCE_CONNECTOR EXISTING_SOURCE_TOKEN=$SOURCE_TOKEN EXISTING_SOURCE_RISC0_ADAPTER=${SOURCE_RISC0_ADAPTER:-}"
echo "  REUSE_DEST_DEPLOYMENTS=1 EXISTING_DEST_CONNECTOR=$DEST_CONNECTOR EXISTING_DEST_TOKEN=$DEST_TOKEN EXISTING_DEST_RISC0_ADAPTER=${DEST_RISC0_ADAPTER:-}"
