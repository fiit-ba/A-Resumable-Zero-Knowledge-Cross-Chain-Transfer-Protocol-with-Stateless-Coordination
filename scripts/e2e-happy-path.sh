#!/usr/bin/env bash
# scripts/e2e-happy-path.sh
#
# E2E happy-path relay flow: deposit on source chain, then drive lock → mint → ack
# using stateless-client relay-resume for each stage.
#
# Flags:
#   --source-profile / --source-network      (default: local-anvil)
#   --destination-profile / --destination-network  (default: local-hardhat)
#   --source-rpc-url, --destination-rpc-url
#   --source-chain-id, --destination-chain-id
#   --private-key
#   --proof-backend <local|docker>           (default: local)
#   --risc0-prover-mode <local|bonsai>       (default: local)
#   --reuse-source, --reuse-dest             reuse existing deployments
#   --source-connector, --destination-connector
#   --amount <wei>
#   --ack-window <seconds>
#   -h / --help
#
# Environment variables (all overridable; see scripts/lib/e2e-common.sh):
#   SOURCE_NETWORK_PROFILE, DEST_NETWORK_PROFILE
#   SOURCE_RPC, DEST_RPC, SOURCE_CHAIN_ID, DEST_CHAIN_ID
#   PRIVATE_KEY, AMOUNT_WEI, ACK_WINDOW_SECONDS
#   RISC0_PROVER_MODE, USE_DOCKER_PROVER
#   STATELESS_CLIENT_DIR, STATELESS_CLIENT_AUTO_BUILD
#   REUSE_SOURCE_DEPLOYMENTS, REUSE_DEST_DEPLOYMENTS
#   EXISTING_SOURCE_CONNECTOR, EXISTING_SOURCE_TOKEN, EXISTING_SOURCE_RISC0_ADAPTER
#   EXISTING_DEST_CONNECTOR, EXISTING_DEST_TOKEN, EXISTING_DEST_RISC0_ADAPTER
#   LOCK_EXECUTION_BLOCK, MINT_EXECUTION_BLOCK, ACK_EXECUTION_BLOCK
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./lib/e2e-common.sh
source "$SCRIPT_DIR/lib/e2e-common.sh"

# ── Usage ───────────────────────────────────────────────────────────────────
export E2E_USAGE="Usage: $0 [OPTIONS]

Run the happy-path relay flow (lock → mint → ack) between two networks.

Network selection:
  --source-profile <profile>         Source network profile (default: local-anvil)
  --source-network <profile>         Alias for --source-profile
  --destination-profile <profile>    Destination network profile (default: local-hardhat)
  --destination-network <profile>    Alias for --destination-profile
  --source-rpc-url <url>             Override source RPC URL
  --destination-rpc-url <url>        Override destination RPC URL
  --source-chain-id <id>             Override source chain ID
  --destination-chain-id <id>        Override destination chain ID

Supported profiles: local-anvil, local-hardhat, mainnet, sepolia, holesky, hoodi, gnosis, chiado

Signing and amounts:
  --private-key <hex>                Signer private key (or set PRIVATE_KEY env var)
  --amount <wei>                     Token amount for deposit (default: 1 ether)
  --ack-window <seconds>             ACK deadline window (default: 3600)

Proof runtime:
  --proof-backend <local|docker>     Proof runner (default: local)
  --risc0-prover-mode <local|bonsai> RISC0 prover mode (default: local)

Deployment reuse:
  --reuse-source                     Skip source deployment; use EXISTING_SOURCE_* vars
  --reuse-dest                       Skip dest deployment; use EXISTING_DEST_* vars
  --source-connector <addr>          Set source connector and enable reuse
  --destination-connector <addr>     Set dest connector and enable reuse

Misc:
  -h, --help                         Show this help

Examples:
  $0
  $0 --source-profile local-anvil --destination-profile local-hardhat
  $0 --source-profile sepolia --destination-profile chiado --private-key 0x...
  $0 --reuse-source --source-connector 0x... --reuse-dest --destination-connector 0x... --source-profile local-anvil --destination-profile local-hardhat
"

# ── Parse args, apply defaults, validate ────────────────────────────────────
e2e_parse_args "$@"
e2e_apply_profile_defaults
e2e_validate_prerequisites
ensure_stateless_client_ready

# ── Deploy contracts ─────────────────────────────────────────────────────────
deploy_source_contracts
deploy_destination_contracts

# Cross-wire: source connector needs to know dest connector address and vice versa.
if [[ "$REUSE_SOURCE_DEPLOYMENTS" != "1" || "$REUSE_DEST_DEPLOYMENTS" != "1" ]]; then
    echo "Linking source and destination connectors..."
    local_set_dest_tx="$(send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" "setDestinationConnector(address)" "$DEST_CONNECTOR")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$local_set_dest_tx" >/dev/null

    local_set_src_tx="$(send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" "setSourceConnector(address)" "$SOURCE_CONNECTOR")"
    wait_for_tx_receipt_block "$DEST_RPC" "$local_set_src_tx" >/dev/null
fi

# ── Mint tokens and deposit ──────────────────────────────────────────────────
echo "Minting $AMOUNT_WEI source tokens to $DEPLOYER_ADDRESS..."
mint_tx="$(send_tx_async "$SOURCE_RPC" \
    "$SOURCE_TOKEN" "mint(address,uint256)" "$DEPLOYER_ADDRESS" "$AMOUNT_WEI")"
wait_for_tx_receipt_block "$SOURCE_RPC" "$mint_tx" >/dev/null

SOURCE_BALANCE_BEFORE="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
DEST_BALANCE_BEFORE="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEPLOYER_ADDRESS")"
echo "Balances before transfer: source=$SOURCE_BALANCE_BEFORE dest=$DEST_BALANCE_BEFORE"

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

# ── mint stage ───────────────────────────────────────────────────────────────
mint_exec_block="${MINT_EXECUTION_BLOCK:-$DEST_FUNDS_RELEASED_BLOCK}"
mint_exec_block="$(normalize_execution_block_tag "$mint_exec_block")"
echo "Mint execution block: $mint_exec_block"
wait_for_successor_execution_block "$DEST_RPC" "$mint_exec_block" "destination-funds-released"

echo "Running relay-resume for mint..."
if ! run_relay_resume_for_action "mint" --mint-execution-block "$mint_exec_block" 2>/dev/null; then
    # Chiado sync-backwards: retry with latest.
    if is_colibri_sync_backwards_error "$(cat /dev/stdin 2>/dev/null || true)"; then
        echo "relay-resume(mint) hit sync-backwards; retrying with execution-block latest..."
        run_relay_resume_for_action "mint" --mint-execution-block latest
    fi
fi
MINT_SUBMIT_TX="$LAST_SUBMISSION_TX_HASH"
SOURCE_ACK_READY_BLOCK="$LAST_SUBMISSION_BLOCK"
SOURCE_STATUS_AFTER_MINT="$LAST_RESULTING_STATUS"

if [[ "$SOURCE_STATUS_AFTER_MINT" != "2" && "$SOURCE_STATUS_AFTER_MINT" != "" ]]; then
    echo "Source status mismatch after mint: expected 2, got $SOURCE_STATUS_AFTER_MINT" >&2; exit 1
fi

# ── ack stage ────────────────────────────────────────────────────────────────
ack_exec_block="${ACK_EXECUTION_BLOCK:-$SOURCE_ACK_READY_BLOCK}"
ack_exec_block="$(normalize_execution_block_tag "$ack_exec_block")"
echo "Ack execution block: $ack_exec_block"
wait_for_successor_execution_block "$SOURCE_RPC" "$ack_exec_block" "source-ack-ready"

echo "Running relay-resume for ack..."
run_relay_resume_for_action "ack" --ack-execution-block "$ack_exec_block"
ACK_SUBMIT_TX="$LAST_SUBMISSION_TX_HASH"
DEST_FINAL_STATUS="$LAST_RESULTING_STATUS"

# ── Final assertions ─────────────────────────────────────────────────────────
SOURCE_STATUS_FINAL="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
if [[ "$SOURCE_STATUS_FINAL" != "2" ]]; then
    echo "Source status mismatch after ack: expected 2 (MINT_PROOF_ACCEPTED), got $SOURCE_STATUS_FINAL" >&2; exit 1
fi
if [[ -n "$DEST_FINAL_STATUS" && "$DEST_FINAL_STATUS" != "0" ]]; then
    echo "Destination status mismatch after ack: expected 0 (NONE), got $DEST_FINAL_STATUS" >&2; exit 1
fi

SOURCE_BALANCE_AFTER="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
DEST_BALANCE_AFTER="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEPLOYER_ADDRESS")"

echo ""
echo "Done — happy path complete."
echo "txId:                     $TX_ID"
echo "sourceConnector:          $SOURCE_CONNECTOR"
echo "destConnector:            $DEST_CONNECTOR"
echo "sourceToken:              $SOURCE_TOKEN"
echo "destToken:                $DEST_TOKEN"
echo "lock submit tx:           $LOCK_SUBMIT_TX (dest block $DEST_FUNDS_RELEASED_BLOCK)"
echo "mint submit tx:           $MINT_SUBMIT_TX (source block $SOURCE_ACK_READY_BLOCK)"
echo "ack submit tx:            $ACK_SUBMIT_TX"
echo "sourceStatus (final):     $SOURCE_STATUS_FINAL  (expected 2 = MINT_PROOF_ACCEPTED)"
echo "destStatus (final):       ${DEST_FINAL_STATUS:-n/a}  (expected 0 = NONE)"
echo "source balance:           $SOURCE_BALANCE_BEFORE -> $SOURCE_BALANCE_AFTER"
echo "dest balance:             $DEST_BALANCE_BEFORE -> $DEST_BALANCE_AFTER"
echo ""
echo "Reuse env:"
echo "  REUSE_SOURCE_DEPLOYMENTS=1 EXISTING_SOURCE_CONNECTOR=$SOURCE_CONNECTOR EXISTING_SOURCE_TOKEN=$SOURCE_TOKEN EXISTING_SOURCE_RISC0_ADAPTER=${SOURCE_RISC0_ADAPTER:-}"
echo "  REUSE_DEST_DEPLOYMENTS=1 EXISTING_DEST_CONNECTOR=$DEST_CONNECTOR EXISTING_DEST_TOKEN=$DEST_TOKEN EXISTING_DEST_RISC0_ADAPTER=${DEST_RISC0_ADAPTER:-}"
