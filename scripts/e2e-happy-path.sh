#!/usr/bin/env bash
# scripts/e2e-happy-path.sh
#
# E2E happy-path relay flow: deploy both chains with `make deploy-prod-full`, deposit on the
# source chain, then drive lock → mint → ack with stateless-client relay-resume, one stage
# per call, and check the statuses and balances at the end.
#
# Flags:
#   --source-profile / --source-network      (default: local-anvil)
#   --destination-profile / --destination-network  (default: local-hardhat)
#   --source-rpc-url, --destination-rpc-url
#   --source-chain-id, --destination-chain-id
#   --private-key, --receiver
#   --proof-backend <local|docker|test>      (default: local)
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
#   PRIVATE_KEY, RECEIVER_ADDRESS, AMOUNT_WEI, ACK_WINDOW_SECONDS
#   PROOF_BACKEND, RISC0_PROVER_MODE, USE_DOCKER_PROVER (alias for PROOF_BACKEND=docker)
#   STATELESS_CLIENT_DIR, STATELESS_CLIENT_AUTO_BUILD
#   REUSE_SOURCE_DEPLOYMENTS, REUSE_DEST_DEPLOYMENTS
#   EXISTING_SOURCE_CONNECTOR, EXISTING_SOURCE_TOKEN, EXISTING_DEST_CONNECTOR, EXISTING_DEST_TOKEN
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
  --receiver <address>               Receiver on the destination (default: the signer)
  --amount <wei>                     Token amount for deposit (default: 1 ether)
  --ack-window <seconds>             ACK deadline window (default: 3600)

Proof runtime:
  --proof-backend <local|docker|test> Proof runner (default: local); test = SnarkJS test proofs,
                                     local chains only
  --risc0-prover-mode <local|bonsai> RISC0 prover mode (default: local)

Deployment reuse (both sides; the token route must already be registered):
  --reuse-source, --reuse-dest       Skip deployment; use EXISTING_* vars
  --source-connector <addr>          Set source connector and enable reuse
  --destination-connector <addr>     Set dest connector and enable reuse

Misc:
  -h, --help                         Show this help

Examples:
  $0
  $0 --proof-backend test
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
deploy_contracts

# ── Deposit ──────────────────────────────────────────────────────────────────
if [[ "$(profile_time_warp_method "$SOURCE_NETWORK_PROFILE")" != "none" \
    && "$(profile_time_warp_method "$DEST_NETWORK_PROFILE")" != "none" ]]; then
    align_chain_clocks
fi

DEST_BALANCE_BEFORE="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$RECEIVER_ADDRESS")"

perform_deposit

SOURCE_BALANCE_LOCKED="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
echo "Balances after the deposit: source=$SOURCE_BALANCE_LOCKED receiver wrapped=$DEST_BALANCE_BEFORE"

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
run_relay_resume_for_action "mint" --mint-execution-block "$mint_exec_block"
MINT_SUBMIT_TX="$LAST_SUBMISSION_TX_HASH"
SOURCE_ACK_READY_BLOCK="$LAST_SUBMISSION_BLOCK"

# ── ack stage ────────────────────────────────────────────────────────────────
ack_exec_block="${ACK_EXECUTION_BLOCK:-$SOURCE_ACK_READY_BLOCK}"
ack_exec_block="$(normalize_execution_block_tag "$ack_exec_block")"
echo "Ack execution block: $ack_exec_block"
wait_for_successor_execution_block "$SOURCE_RPC" "$ack_exec_block" "source-ack-ready"

echo "Running relay-resume for ack..."
run_relay_resume_for_action "ack" --ack-execution-block "$ack_exec_block"
ACK_SUBMIT_TX="$LAST_SUBMISSION_TX_HASH"

# ── Final assertions ─────────────────────────────────────────────────────────
# submitMintProof deletes the source record and submitAckProof the destination record.
SOURCE_STATUS_FINAL="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
DEST_STATUS_FINAL="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"
if [[ "$SOURCE_STATUS_FINAL" != "0" ]]; then
    echo "Source status mismatch after ack: expected 0 (NONE), got $SOURCE_STATUS_FINAL" >&2; exit 1
fi
if [[ "$DEST_STATUS_FINAL" != "0" ]]; then
    echo "Destination status mismatch after ack: expected 0 (NONE), got $DEST_STATUS_FINAL" >&2; exit 1
fi

SOURCE_BALANCE_AFTER="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
DEST_BALANCE_AFTER="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$RECEIVER_ADDRESS")"
if [[ "$SOURCE_BALANCE_AFTER" != "$SOURCE_BALANCE_LOCKED" ]]; then
    echo "Source balance changed after the deposit: $SOURCE_BALANCE_LOCKED -> $SOURCE_BALANCE_AFTER" >&2; exit 1
fi
if (( DEST_BALANCE_AFTER - DEST_BALANCE_BEFORE != AMOUNT_WEI )); then
    echo "Receiver went $DEST_BALANCE_BEFORE -> $DEST_BALANCE_AFTER wrapped tokens, expected +$AMOUNT_WEI" >&2; exit 1
fi

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
echo "sourceStatus (final):     $SOURCE_STATUS_FINAL  (expected 0 = NONE)"
echo "destStatus (final):       $DEST_STATUS_FINAL  (expected 0 = NONE)"
echo "source balance:           $SOURCE_BALANCE_LOCKED (after deposit) -> $SOURCE_BALANCE_AFTER"
echo "receiver wrapped balance: $DEST_BALANCE_BEFORE -> $DEST_BALANCE_AFTER"
echo ""
echo "Reuse env:"
echo "  REUSE_SOURCE_DEPLOYMENTS=1 EXISTING_SOURCE_CONNECTOR=$SOURCE_CONNECTOR EXISTING_SOURCE_TOKEN=$SOURCE_TOKEN"
echo "  EXISTING_DEST_CONNECTOR=$DEST_CONNECTOR EXISTING_DEST_TOKEN=$DEST_TOKEN"
