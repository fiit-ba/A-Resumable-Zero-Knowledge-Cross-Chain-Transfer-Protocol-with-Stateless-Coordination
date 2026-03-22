#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Support both locations:
# 1) repo/smart-contracts/script/e2e-anvil-hardhat.sh
# 2) repo/scripts/e2e-anvil-hardhat.sh
if [[ -d "$SCRIPT_DIR/../src" && -d "$SCRIPT_DIR/../../zk-proofs/risc_zero/lock_event" ]]; then
    # script is inside smart-contracts/script
    SC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    ROOT_DIR="$(cd "$SC_DIR/.." && pwd)"
elif [[ -d "$SCRIPT_DIR/../smart-contracts/src" && -d "$SCRIPT_DIR/../zk-proofs/risc_zero/lock_event" ]]; then
    # script is inside top-level scripts
    ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    SC_DIR="$ROOT_DIR/smart-contracts"
else
    echo "Could not infer project root from script location: $SCRIPT_DIR" >&2
    echo "Expected either repo/smart-contracts/script or repo/scripts." >&2
    exit 1
fi

LOCK_RZ_DIR="$ROOT_DIR/zk-proofs/risc_zero/lock_event"
MINT_RZ_DIR="$ROOT_DIR/zk-proofs/risc_zero/mint_event"
ACK_RZ_DIR="$ROOT_DIR/zk-proofs/risc_zero/ack_event"
if [[ ! -d "$LOCK_RZ_DIR" ]]; then
    echo "Missing lock proof workspace: $LOCK_RZ_DIR" >&2
    exit 1
fi
if [[ ! -d "$MINT_RZ_DIR" ]]; then
    echo "Missing mint proof workspace: $MINT_RZ_DIR" >&2
    exit 1
fi
if [[ ! -d "$ACK_RZ_DIR" ]]; then
    echo "Missing ack proof workspace: $ACK_RZ_DIR" >&2
    exit 1
fi

SOURCE_NETWORK_PROFILE="${SOURCE_NETWORK_PROFILE:-local-anvil}"
DEST_NETWORK_PROFILE="${DEST_NETWORK_PROFILE:-local-hardhat}"
SOURCE_RPC="${SOURCE_RPC:-}"
DEST_RPC="${DEST_RPC:-}"
SOURCE_CHAIN_ID="${SOURCE_CHAIN_ID:-}"
DEST_CHAIN_ID="${DEST_CHAIN_ID:-}"

PRIVATE_KEY="${PRIVATE_KEY:-}"
ACK_WINDOW_SECONDS="${ACK_WINDOW_SECONDS:-3600}"
AMOUNT_WEI="${AMOUNT_WEI:-1000000000000000000}" # 1 token with 18 decimals
EXECUTION_BLOCK="${EXECUTION_BLOCK:-latest}"
LOCK_EXECUTION_BLOCK="${LOCK_EXECUTION_BLOCK:-}"
MINT_EXECUTION_BLOCK="${MINT_EXECUTION_BLOCK:-}"
ACK_EXECUTION_BLOCK="${ACK_EXECUTION_BLOCK:-}"
TOKEN_NAME="${TOKEN_NAME:-Test USD}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-TUSD}"
DEST_TOKEN_NAME="${DEST_TOKEN_NAME:-Wrapped Test USD}"
DEST_TOKEN_SYMBOL="${DEST_TOKEN_SYMBOL:-wTUSD}"
LOCK_PROOF_GAS_LIMIT="${LOCK_PROOF_GAS_LIMIT:-12000000}"
MINT_PROOF_GAS_LIMIT="${MINT_PROOF_GAS_LIMIT:-12000000}"
ACK_PROOF_GAS_LIMIT="${ACK_PROOF_GAS_LIMIT:-12000000}"
SET_VERIFIER_GAS_LIMIT="${SET_VERIFIER_GAS_LIMIT:-500000}"
DEST_TOKEN_MINT_GAS_LIMIT="${DEST_TOKEN_MINT_GAS_LIMIT:-500000}"
RISC0_PROVER_MODE="${RISC0_PROVER_MODE:-local}"
USE_DOCKER_PROVER="${USE_DOCKER_PROVER:-0}"
DOCKER_LOCK_PROVER_SCRIPT="${DOCKER_LOCK_PROVER_SCRIPT:-${DOCKER_PROVER_SCRIPT:-$LOCK_RZ_DIR/scripts/prove-lock-docker.sh}}"
DOCKER_MINT_PROVER_SCRIPT="${DOCKER_MINT_PROVER_SCRIPT:-$MINT_RZ_DIR/scripts/prove-mint-docker.sh}"
DOCKER_ACK_PROVER_SCRIPT="${DOCKER_ACK_PROVER_SCRIPT:-$ACK_RZ_DIR/scripts/prove-ack-docker.sh}"
RISC0_GUEST_USE_DOCKER="${RISC0_GUEST_USE_DOCKER:-1}"
USE_STATELESS_CLIENT="${USE_STATELESS_CLIENT:-1}"
STATELESS_CLIENT_DIR="${STATELESS_CLIENT_DIR:-$ROOT_DIR/stateless-client}"
STATELESS_CLIENT_AUTO_BUILD="${STATELESS_CLIENT_AUTO_BUILD:-1}"
STATELESS_CLIENT_RELAY_RETRIES="${STATELESS_CLIENT_RELAY_RETRIES:-6}"
STATELESS_CLIENT_RELAY_RETRY_DELAY_SEC="${STATELESS_CLIENT_RELAY_RETRY_DELAY_SEC:-12}"
STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_ATTEMPTS="${STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_ATTEMPTS:-45}"
STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_INTERVAL_SEC="${STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_INTERVAL_SEC:-2}"
STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS="${STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS:-50000}"
STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK="${STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK:-}"
COLIBRI_VERIFY="${COLIBRI_VERIFY:-0}"
COLIBRI_TS_DIR="${COLIBRI_TS_DIR:-$ROOT_DIR/colibri}"
COLIBRI_PROVER_URLS="${COLIBRI_PROVER_URLS:-}"
COLIBRI_BEACON_URLS="${COLIBRI_BEACON_URLS:-}"
COLIBRI_CHECKPOINTZ_URLS="${COLIBRI_CHECKPOINTZ_URLS:-}"
COLIBRI_SOURCE_RPC_URLS="${COLIBRI_SOURCE_RPC_URLS:-}"
COLIBRI_DEST_RPC_URLS="${COLIBRI_DEST_RPC_URLS:-}"
COLIBRI_SOURCE_PROVER_URLS="${COLIBRI_SOURCE_PROVER_URLS:-}"
COLIBRI_DEST_PROVER_URLS="${COLIBRI_DEST_PROVER_URLS:-}"
COLIBRI_SOURCE_BEACON_URLS="${COLIBRI_SOURCE_BEACON_URLS:-}"
COLIBRI_DEST_BEACON_URLS="${COLIBRI_DEST_BEACON_URLS:-}"
COLIBRI_SOURCE_CHECKPOINTZ_URLS="${COLIBRI_SOURCE_CHECKPOINTZ_URLS:-}"
COLIBRI_DEST_CHECKPOINTZ_URLS="${COLIBRI_DEST_CHECKPOINTZ_URLS:-}"
COLIBRI_LOG_LOOKBACK_BLOCKS="${COLIBRI_LOG_LOOKBACK_BLOCKS:-50000}"
COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL="${COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL:-https://rpc-gbc.chiadochain.net}"
COLIBRI_VERIFY_RETRIES="${COLIBRI_VERIFY_RETRIES:-6}"
COLIBRI_VERIFY_RETRY_DELAY_SEC="${COLIBRI_VERIFY_RETRY_DELAY_SEC:-12}"
COLIBRI_VERIFY_SOURCE_DEPOSIT="${COLIBRI_VERIFY_SOURCE_DEPOSIT:-1}"
COLIBRI_VERIFY_DEST_FUNDS_RELEASED="${COLIBRI_VERIFY_DEST_FUNDS_RELEASED:-1}"
COLIBRI_VERIFY_SOURCE_ACK_READY="${COLIBRI_VERIFY_SOURCE_ACK_READY:-1}"
COLIBRI_RESET_STATE_ON_SYNC_BACKWARDS="${COLIBRI_RESET_STATE_ON_SYNC_BACKWARDS:-1}"
TX_RECEIPT_WAIT_ATTEMPTS="${TX_RECEIPT_WAIT_ATTEMPTS:-120}"
TX_RECEIPT_WAIT_INTERVAL_SEC="${TX_RECEIPT_WAIT_INTERVAL_SEC:-2}"
DEPLOY_RETRY_ATTEMPTS="${DEPLOY_RETRY_ATTEMPTS:-6}"
DEPLOY_RETRY_DELAY_SEC="${DEPLOY_RETRY_DELAY_SEC:-4}"

REUSE_SOURCE_DEPLOYMENTS="${REUSE_SOURCE_DEPLOYMENTS:-0}"
REUSE_DEST_DEPLOYMENTS="${REUSE_DEST_DEPLOYMENTS:-0}"
EXISTING_SOURCE_CONNECTOR="${EXISTING_SOURCE_CONNECTOR:-}"
EXISTING_SOURCE_TOKEN="${EXISTING_SOURCE_TOKEN:-}"
EXISTING_SOURCE_RISC0_ADAPTER="${EXISTING_SOURCE_RISC0_ADAPTER:-}"
EXISTING_DEST_CONNECTOR="${EXISTING_DEST_CONNECTOR:-}"
EXISTING_DEST_TOKEN="${EXISTING_DEST_TOKEN:-}"
EXISTING_DEST_RISC0_ADAPTER="${EXISTING_DEST_RISC0_ADAPTER:-}"

# RISC Zero Groth16 verifier params from risc0-ethereum ControlID.sol.
CONTROL_ROOT="0xa54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56"
BN254_CONTROL_ID="0x04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0"
BYTES32_ZERO="0x0000000000000000000000000000000000000000000000000000000000000000"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

require_env_value() {
    local name="$1"
    local value="$2"
    if [[ -z "$value" ]]; then
        echo "Missing required env var: $name" >&2
        exit 1
    fi
}

trim_string() {
    local value="$1"
    # Trim leading/trailing whitespace.
    value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    # Strip optional wrapping quotes.
    value="$(printf '%s' "$value" | sed -E 's/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/')"
    printf '%s' "$value"
}

resolve_private_key() {
    local env_file="$SC_DIR/.env"
    local candidate="$PRIVATE_KEY"
    local source="env:PRIVATE_KEY"

    if [[ -z "$candidate" && -f "$env_file" ]]; then
        candidate="$(
            awk -F= '
                /^[[:space:]]*(export[[:space:]]+)?PRIVATE_KEY[[:space:]]*=/ {
                    print substr($0, index($0, "=") + 1)
                }
            ' "$env_file" | tail -n1
        )"
        candidate="${candidate%%#*}"
        candidate="$(trim_string "$candidate")"
        source="$env_file"
    fi

    if [[ -z "$candidate" ]]; then
        echo "Missing PRIVATE_KEY. Set PRIVATE_KEY env var or add PRIVATE_KEY=<hex> to $env_file" >&2
        exit 1
    fi

    # Allow both bare hex and 0x-prefixed values.
    if [[ "$candidate" =~ ^[0-9a-fA-F]{64}$ ]]; then
        candidate="0x$candidate"
    fi

    if [[ ! "$candidate" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        echo "Invalid PRIVATE_KEY format from $source. Expected 32-byte hex (with or without 0x)." >&2
        exit 1
    fi

    PRIVATE_KEY="$candidate"
    echo "Using private key from $source"
}

send_tx_async() {
    local rpc_url="$1"
    shift

    local output tx_hash
    output="$(cast send --async "$@" --rpc-url "$rpc_url" --private-key "$PRIVATE_KEY" 2>&1)"
    tx_hash="$(printf '%s\n' "$output" | sed -n 's/.*\(0x[0-9a-fA-F]\{64\}\).*/\1/p' | tail -n1)"
    if [[ -z "$tx_hash" ]]; then
        echo "Failed to parse tx hash from cast send output." >&2
        echo "$output" >&2
        exit 1
    fi
    printf '%s' "$tx_hash"
}

wait_for_tx_receipt_block() {
    local rpc_url="$1"
    local tx_hash="$2"
    local attempts="$TX_RECEIPT_WAIT_ATTEMPTS"
    local interval_sec="$TX_RECEIPT_WAIT_INTERVAL_SEC"
    local i receipt block_hex status_hex error_data block_dec

    for ((i = 1; i <= attempts; i++)); do
        receipt="$(cast rpc --rpc-url "$rpc_url" eth_getTransactionReceipt "$tx_hash" 2>/dev/null || true)"
        block_hex="$(printf '%s' "$receipt" | sed -n 's/.*"blockNumber":"\([^"]*\)".*/\1/p' | head -n1)"
        if [[ "$block_hex" =~ ^0x[0-9a-fA-F]+$ ]]; then
            status_hex="$(printf '%s' "$receipt" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -n1)"
            block_dec="$(cast --to-dec "$block_hex")"

            if [[ "$status_hex" == "0x0" ]]; then
                error_data="$(printf '%s' "$receipt" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p' | head -n1)"
                echo "Transaction $tx_hash reverted (status=0x0) in block $block_dec on $rpc_url." >&2
                if [[ -n "$error_data" ]]; then
                    echo "Receipt error data: $error_data" >&2
                fi
                exit 1
            fi

            if [[ -n "$status_hex" && "$status_hex" != "0x1" ]]; then
                echo "Transaction $tx_hash has unexpected receipt status '$status_hex' in block $block_dec on $rpc_url." >&2
                exit 1
            fi

            printf '%s\n' "$block_dec"
            return 0
        fi
        sleep "$interval_sec"
    done

    echo "Timed out waiting for receipt of tx $tx_hash on $rpc_url." >&2
    exit 1
}

normalize_execution_block_tag() {
    local value="$1"
    local lowered

    lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    case "$lowered" in
        latest|safe|finalized|pending|earliest)
            printf '%s' "$lowered"
            return 0
            ;;
    esac

    if [[ "$value" =~ ^0x[0-9a-fA-F]+$ ]]; then
        printf '%s' "$value"
        return 0
    fi

    if [[ "$value" =~ ^[0-9]+$ ]]; then
        printf "0x%x" "$value"
        return 0
    fi

    # Fall through so downstream tooling can surface a precise error.
    printf '%s' "$value"
}

deploy_contract() {
    local rpc_url="$1"
    shift

    local output address rc attempt=1
    local max_attempts="$DEPLOY_RETRY_ATTEMPTS"
    local retry_delay="$DEPLOY_RETRY_DELAY_SEC"

    while true; do
        set +e
        output="$(
            cd "$SC_DIR"
            forge create --broadcast --rpc-url "$rpc_url" --private-key "$PRIVATE_KEY" "$@" 2>&1
        )"
        rc=$?
        set -e

        echo "$output" >&2

        if [[ "$rc" -eq 0 ]]; then
            address="$(echo "$output" | awk '/Deployed to:/ {print $3}' | tail -n1)"
            if [[ -z "$address" ]]; then
                echo "Failed to parse deployed address from forge output." >&2
                exit 1
            fi
            printf '%s' "$address"
            return 0
        fi

        # Public RPC endpoints can serve stale nonce state across backend nodes.
        if [[ "$output" == *"nonce too low"* || "$output" == *"replacement transaction underpriced"* ]]; then
            if [[ "$attempt" -lt "$max_attempts" ]]; then
                echo "Deployment tx nonce sync issue on $rpc_url. Retrying in ${retry_delay}s (${attempt}/${max_attempts})..." >&2
                attempt=$((attempt + 1))
                sleep "$retry_delay"
                continue
            fi
        fi

        echo "forge create failed after ${attempt} attempt(s)." >&2
        exit "$rc"
    done
}

compute_tx_id() {
    local sender="$1"
    local receiver="$2"
    local amount="$3"
    local currency_from="$4"
    local currency_to="$5"
    local src_connector="$6"
    local dst_connector="$7"
    local nonce="$8"

    local encoded
    encoded="$(cast abi-encode \
        "f(address,address,uint256,address,address,address,address,uint256)" \
        "$sender" \
        "$receiver" \
        "$amount" \
        "$currency_from" \
        "$currency_to" \
        "$src_connector" \
        "$dst_connector" \
        "$nonce")"
    cast keccak "$encoded"
}

to_lower() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

extract_proof_value() {
    local proof_output="$1"
    local key="$2"
    local value
    value="$(printf '%s\n' "$proof_output" | awk -F': ' -v k="$key" '$1 == k {print $2}' | tail -n1)"
    if [[ -z "$value" ]]; then
        echo "Failed to extract '$key' from proof output." >&2
        exit 1
    fi
    printf '%s' "$value"
}

query_tx_status() {
    local rpc_url="$1"
    local connector="$2"
    local tx_id="$3"
    local errfile status rc calldata rpc_payload rpc_result raw_status

    errfile="$(mktemp)"
    set +e
    status="$(cast call "$connector" "txStatus(bytes32)(uint8)" "$tx_id" --rpc-url "$rpc_url" 2>"$errfile")"
    rc=$?
    set -e
    if [[ "$rc" -eq 0 ]]; then
        rm -f "$errfile"
        printf '%s' "$status"
        return 0
    fi

    echo "Warning: failed to query tx status via cast call on $rpc_url; using raw eth_call fallback." >&2
    if [[ -f "$errfile" ]]; then
        tail -n1 "$errfile" >&2 || true
    fi
    rm -f "$errfile"

    calldata="$(cast calldata "txStatus(bytes32)" "$tx_id")"
    rpc_payload="$(printf '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"]}' "$connector" "$calldata")"
    rpc_result="$(curl -sS -H "content-type: application/json" --data "$rpc_payload" "$rpc_url" || true)"
    raw_status="$(printf '%s' "$rpc_result" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"

    if [[ -z "$raw_status" ]]; then
        printf '%s' "unknown"
        return 0
    fi

    cast --to-dec "$raw_status"
}

query_tx_nonce() {
    local rpc_url="$1"
    local connector="$2"
    local nonce

    nonce="$(cast call "$connector" "txNonce()(uint256)" --rpc-url "$rpc_url" 2>/dev/null || true)"
    if [[ -z "$nonce" ]]; then
        echo "Failed to query txNonce() on connector $connector via $rpc_url" >&2
        exit 1
    fi
    printf '%s' "$nonce"
}

query_erc20_balance() {
    local rpc_url="$1"
    local token="$2"
    local account="$3"
    local errfile balance rc calldata rpc_payload rpc_result raw_balance

    errfile="$(mktemp)"
    set +e
    balance="$(cast call "$token" "balanceOf(address)(uint256)" "$account" --rpc-url "$rpc_url" 2>"$errfile")"
    rc=$?
    set -e
    if [[ "$rc" -eq 0 ]]; then
        rm -f "$errfile"
        printf '%s' "$balance"
        return 0
    fi

    echo "Warning: failed to query ERC20 balance via cast call on $rpc_url; using raw eth_call fallback." >&2
    if [[ -f "$errfile" ]]; then
        tail -n1 "$errfile" >&2 || true
    fi
    rm -f "$errfile"

    calldata="$(cast calldata "balanceOf(address)" "$account")"
    rpc_payload="$(printf '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"]}' "$token" "$calldata")"
    rpc_result="$(curl -sS -H "content-type: application/json" --data "$rpc_payload" "$rpc_url" || true)"
    raw_balance="$(printf '%s' "$rpc_result" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"

    if [[ -z "$raw_balance" ]]; then
        printf '%s' "unknown"
        return 0
    fi

    cast --to-dec "$raw_balance"
}

extract_stateless_client_value() {
    local cli_output="$1"
    local key="$2"
    local value
    value="$(printf '%s\n' "$cli_output" | awk -F': ' -v k="$key" '$1 == k {print $2}' | tail -n1)"
    if [[ -z "$value" ]]; then
        echo "Failed to extract '$key' from stateless-client output." >&2
        exit 1
    fi
    printf '%s' "$value"
}

ensure_stateless_client_ready() {
    if [[ "$USE_STATELESS_CLIENT" != "1" ]]; then
        return 0
    fi

    require_cmd node
    require_cmd npm

    if [[ ! -d "$STATELESS_CLIENT_DIR" ]]; then
        echo "Missing stateless-client directory: $STATELESS_CLIENT_DIR" >&2
        exit 1
    fi
    if [[ ! -f "$STATELESS_CLIENT_DIR/package.json" ]]; then
        echo "Missing stateless-client package.json in: $STATELESS_CLIENT_DIR" >&2
        exit 1
    fi

    if [[ ! -d "$STATELESS_CLIENT_DIR/node_modules" ]]; then
        echo "Installing stateless-client npm dependencies..."
        (
            cd "$STATELESS_CLIENT_DIR"
            npm install
        )
    fi

    if [[ "$STATELESS_CLIENT_AUTO_BUILD" == "1" ]]; then
        echo "Building stateless-client..."
        (
            cd "$STATELESS_CLIENT_DIR"
            npm run build >/dev/null
        )
    fi

    if [[ ! -f "$STATELESS_CLIENT_DIR/dist/cli.js" ]]; then
        echo "Missing stateless-client CLI build output: $STATELESS_CLIENT_DIR/dist/cli.js" >&2
        echo "Run: (cd \"$STATELESS_CLIENT_DIR\" && npm run build)" >&2
        exit 1
    fi

    mkdir -p "$STATELESS_CLIENT_DIR/colibri-cache"
}

run_stateless_client_cli_with_retry() {
    local command="$1"
    shift
    local max_retries="$STATELESS_CLIENT_RELAY_RETRIES"
    local retry_delay_sec="$STATELESS_CLIENT_RELAY_RETRY_DELAY_SEC"
    local effective_log_lookback="$STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS"
    local attempt=0
    local output rc max_range_from_error

    while true; do
        set +e
        output="$(
            cd "$STATELESS_CLIENT_DIR/colibri-cache"
            RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
            STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS="$effective_log_lookback" \
            STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK="$STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK" \
            node ../dist/cli.js "$command" "$@" 2>&1
        )"
        rc=$?
        set -e

        if [[ "$rc" -eq 0 ]]; then
            printf '%s' "$output"
            return 0
        fi

        # Colibri/public RPC transient errors that are typically resolved by short retries.
        if [[ "$output" == *"parentBeaconBlockRoot"* \
            || "$output" == *"Block after "* \
            || "$output" == *"can not be found in the execution layer"* \
            || "$output" == *"cannot be found in the execution layer"* \
            || "$output" == *"has not been signed yet and cannot be verified"* \
            || "$output" == *"requested block has not been signed yet"* \
            || "$output" == *"Invalid offset for container"* \
            || "$output" == *"Invalid SSZ structure in bootstrap data"* ]]; then
            if [[ "$attempt" -lt "$max_retries" ]]; then
                attempt=$((attempt + 1))
                echo "stateless-client $command hit a transient verification error. Retrying in ${retry_delay_sec}s (${attempt}/${max_retries})..."
                sleep "$retry_delay_sec"
                continue
            fi
        fi

        max_range_from_error="$(
            printf '%s\n' "$output" | sed -n 's/.*exceed maximum block range: \([0-9][0-9]*\).*/\1/p' | head -n1
        )"
        if [[ "$max_range_from_error" =~ ^[0-9]+$ && "$effective_log_lookback" =~ ^[0-9]+$ ]]; then
            if (( effective_log_lookback > max_range_from_error )) && [[ "$attempt" -lt "$max_retries" ]]; then
                attempt=$((attempt + 1))
                effective_log_lookback="$max_range_from_error"
                echo "stateless-client $command hit RPC log range limit; reducing lookback to ${effective_log_lookback} and retrying (${attempt}/${max_retries})..."
                sleep "$retry_delay_sec"
                continue
            fi
        fi

        printf '%s' "$output"
        return "$rc"
    done
}

to_decimal_block_if_fixed() {
    local block_tag="$1"

    if [[ "$block_tag" =~ ^0x[0-9a-fA-F]+$ ]]; then
        cast --to-dec "$block_tag" 2>/dev/null || true
        return 0
    fi

    if [[ "$block_tag" =~ ^[0-9]+$ ]]; then
        printf '%s' "$block_tag"
        return 0
    fi

    # Dynamic tags (latest/safe/finalized/pending/earliest) do not have a fixed successor.
    printf ''
}

wait_for_successor_execution_block() {
    local rpc_url="$1"
    local block_tag="$2"
    local stage_label="$3"
    local attempts="$STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_ATTEMPTS"
    local interval_sec="$STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_INTERVAL_SEC"
    local target_dec current_head i

    target_dec="$(to_decimal_block_if_fixed "$block_tag")"
    if [[ ! "$target_dec" =~ ^[0-9]+$ ]]; then
        return 0
    fi

    current_head="$(cast block-number --rpc-url "$rpc_url" 2>/dev/null || true)"
    if [[ "$current_head" =~ ^[0-9]+$ ]] && (( current_head > target_dec )); then
        return 0
    fi

    echo "Waiting for stage '$stage_label' successor block after $target_dec on $rpc_url..."
    for ((i = 1; i <= attempts; i++)); do
        current_head="$(cast block-number --rpc-url "$rpc_url" 2>/dev/null || true)"
        if [[ "$current_head" =~ ^[0-9]+$ ]] && (( current_head > target_dec )); then
            echo "Observed successor block for stage '$stage_label': head=$current_head target=$target_dec"
            return 0
        fi
        sleep "$interval_sec"
    done

    echo "Warning: did not observe successor block for stage '$stage_label' after ${attempts} attempts; continuing with CLI retries." >&2
}

is_colibri_sync_backwards_error() {
    local output="$1"
    [[ "$output" == *"last sync state is higher than the required period"* && "$output" == *"cannot sync backwards"* ]]
}

run_stateless_client_relay_flow() {
    local tx_id="$1"
    local source_deposit_block="$2"
    local proof_backend="local"
    local lock_execution_block_effective
    local mint_execution_block_effective
    local ack_execution_block_effective
    local lock_output mint_output ack_output
    local lock_submit_tx_hash mint_submit_tx_hash ack_submit_tx_hash
    local dest_funds_released_block source_ack_ready_block
    local dest_status source_status source_status_after_ack dest_final_status
    local source_balance_after dest_balance_after
    local -a common_args

    ensure_stateless_client_ready

    if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
        proof_backend="docker"
    fi

    lock_execution_block_effective="${LOCK_EXECUTION_BLOCK:-$source_deposit_block}"
    lock_execution_block_effective="$(normalize_execution_block_tag "$lock_execution_block_effective")"
    echo "Lock proof execution block: $lock_execution_block_effective"
    wait_for_successor_execution_block "$SOURCE_RPC" "$lock_execution_block_effective" "source-deposit"

    common_args=(
        --tx-id "$tx_id"
        --private-key "$PRIVATE_KEY"
        --proof-backend "$proof_backend"
        --source-profile "$SOURCE_NETWORK_PROFILE"
        --destination-profile "$DEST_NETWORK_PROFILE"
        --source-chain-id "$SOURCE_CHAIN_ID"
        --destination-chain-id "$DEST_CHAIN_ID"
        --source-rpc-url "$SOURCE_RPC"
        --destination-rpc-url "$DEST_RPC"
        --source-connector "$SOURCE_CONNECTOR"
        --destination-connector "$DEST_CONNECTOR"
        --repo-root "$ROOT_DIR"
        --risc0-prover-mode "$RISC0_PROVER_MODE"
        --lock-workspace "$LOCK_RZ_DIR"
        --mint-workspace "$MINT_RZ_DIR"
        --ack-workspace "$ACK_RZ_DIR"
        --lock-docker-script "$DOCKER_LOCK_PROVER_SCRIPT"
        --mint-docker-script "$DOCKER_MINT_PROVER_SCRIPT"
        --ack-docker-script "$DOCKER_ACK_PROVER_SCRIPT"
    )

    if [[ -n "$COLIBRI_SOURCE_PROVER_URLS" ]]; then
        common_args+=(--source-prover-urls "$COLIBRI_SOURCE_PROVER_URLS")
    fi
    if [[ -n "$COLIBRI_DEST_PROVER_URLS" ]]; then
        common_args+=(--destination-prover-urls "$COLIBRI_DEST_PROVER_URLS")
    fi
    if [[ -n "$COLIBRI_SOURCE_BEACON_URLS" ]]; then
        common_args+=(--source-beacon-urls "$COLIBRI_SOURCE_BEACON_URLS")
    fi
    if [[ -n "$COLIBRI_DEST_BEACON_URLS" ]]; then
        common_args+=(--destination-beacon-urls "$COLIBRI_DEST_BEACON_URLS")
    fi
    if [[ -n "$COLIBRI_SOURCE_CHECKPOINTZ_URLS" ]]; then
        common_args+=(--source-checkpointz-urls "$COLIBRI_SOURCE_CHECKPOINTZ_URLS")
    fi
    if [[ -n "$COLIBRI_DEST_CHECKPOINTZ_URLS" ]]; then
        common_args+=(--destination-checkpointz-urls "$COLIBRI_DEST_CHECKPOINTZ_URLS")
    fi

    echo "Running stateless-client relay-lock..."
    if ! lock_output="$(
        run_stateless_client_cli_with_retry \
            relay-lock \
            "${common_args[@]}" \
            --lock-execution-block "$lock_execution_block_effective"
    )"; then
        printf '%s\n' "$lock_output"
        echo "stateless-client relay-lock failed." >&2
        exit 1
    fi
    printf '%s\n' "$lock_output"

    lock_submit_tx_hash="$(extract_stateless_client_value "$lock_output" "submissionTxHash")"
    dest_funds_released_block="$(extract_stateless_client_value "$lock_output" "submissionBlock")"
    dest_status="$(extract_stateless_client_value "$lock_output" "resultingStatus")"
    echo "submitLockProof tx hash: $lock_submit_tx_hash (block $dest_funds_released_block)"

    echo "Minting wrapped tokens on destination for balance verification..."
    cast send \
        "$DEST_TOKEN" \
        "mint(address,uint256)" \
        "$DEST_CONNECTOR" \
        "$AMOUNT_WEI" \
        --gas-limit "$DEST_TOKEN_MINT_GAS_LIMIT" \
        --rpc-url "$DEST_RPC" \
        --private-key "$PRIVATE_KEY" >/dev/null

    mint_execution_block_effective="${MINT_EXECUTION_BLOCK:-$dest_funds_released_block}"
    mint_execution_block_effective="$(normalize_execution_block_tag "$mint_execution_block_effective")"
    echo "Mint proof execution block: $mint_execution_block_effective"
    wait_for_successor_execution_block "$DEST_RPC" "$mint_execution_block_effective" "destination-funds-released"

    echo "Running stateless-client relay-mint..."
    if ! mint_output="$(
        run_stateless_client_cli_with_retry \
            relay-mint \
            "${common_args[@]}" \
            --mint-execution-block "$mint_execution_block_effective"
    )"; then
        if is_colibri_sync_backwards_error "$mint_output" && [[ "$mint_execution_block_effective" != "latest" ]]; then
            echo "relay-mint hit sync-backwards with fixed execution block $mint_execution_block_effective. Retrying with --mint-execution-block latest..."
            mint_execution_block_effective="latest"
            if ! mint_output="$(
                run_stateless_client_cli_with_retry \
                    relay-mint \
                    "${common_args[@]}" \
                    --mint-execution-block "$mint_execution_block_effective"
            )"; then
                if is_colibri_sync_backwards_error "$mint_output"; then
                    echo "relay-mint still hit sync-backwards at latest. Retrying with destination prover URLs disabled..."
                    if ! mint_output="$(
                        run_stateless_client_cli_with_retry \
                            relay-mint \
                            "${common_args[@]}" \
                            --destination-prover-urls "," \
                            --mint-execution-block "$mint_execution_block_effective"
                    )"; then
                        printf '%s\n' "$mint_output"
                        echo "stateless-client relay-mint failed." >&2
                        exit 1
                    fi
                else
                    printf '%s\n' "$mint_output"
                    echo "stateless-client relay-mint failed." >&2
                    exit 1
                fi
            fi
        elif is_colibri_sync_backwards_error "$mint_output"; then
            echo "relay-mint hit sync-backwards. Retrying with destination prover URLs disabled..."
            if ! mint_output="$(
                run_stateless_client_cli_with_retry \
                    relay-mint \
                    "${common_args[@]}" \
                    --destination-prover-urls "," \
                    --mint-execution-block "$mint_execution_block_effective"
            )"; then
                printf '%s\n' "$mint_output"
                echo "stateless-client relay-mint failed." >&2
                exit 1
            fi
        else
            printf '%s\n' "$mint_output"
            echo "stateless-client relay-mint failed." >&2
            exit 1
        fi
    fi
    printf '%s\n' "$mint_output"

    mint_submit_tx_hash="$(extract_stateless_client_value "$mint_output" "submissionTxHash")"
    source_ack_ready_block="$(extract_stateless_client_value "$mint_output" "submissionBlock")"
    source_status="$(extract_stateless_client_value "$mint_output" "resultingStatus")"
    echo "submitMintProof tx hash: $mint_submit_tx_hash (block $source_ack_ready_block)"

    if [[ "$dest_status" != "4" && "$dest_status" != unknown* ]]; then
        echo "Destination tx status mismatch: expected 4 (MINTED_IN_HOLDING), got $dest_status" >&2
        exit 1
    fi

    ack_execution_block_effective="${ACK_EXECUTION_BLOCK:-$source_ack_ready_block}"
    ack_execution_block_effective="$(normalize_execution_block_tag "$ack_execution_block_effective")"
    echo "Ack proof execution block: $ack_execution_block_effective"
    wait_for_successor_execution_block "$SOURCE_RPC" "$ack_execution_block_effective" "source-ack-ready"

    echo "Running stateless-client relay-ack..."
    if ! ack_output="$(
        run_stateless_client_cli_with_retry \
            relay-ack \
            "${common_args[@]}" \
            --ack-execution-block "$ack_execution_block_effective"
    )"; then
        if is_colibri_sync_backwards_error "$ack_output" && [[ "$ack_execution_block_effective" != "latest" ]]; then
            echo "relay-ack hit sync-backwards with fixed execution block $ack_execution_block_effective. Retrying with --ack-execution-block latest..."
            ack_execution_block_effective="latest"
            if ! ack_output="$(
                run_stateless_client_cli_with_retry \
                    relay-ack \
                    "${common_args[@]}" \
                    --ack-execution-block "$ack_execution_block_effective"
            )"; then
                if is_colibri_sync_backwards_error "$ack_output"; then
                    echo "relay-ack still hit sync-backwards at latest. Retrying with source prover URLs disabled..."
                    if ! ack_output="$(
                        run_stateless_client_cli_with_retry \
                            relay-ack \
                            "${common_args[@]}" \
                            --source-prover-urls "," \
                            --ack-execution-block "$ack_execution_block_effective"
                    )"; then
                        printf '%s\n' "$ack_output"
                        echo "stateless-client relay-ack failed." >&2
                        exit 1
                    fi
                else
                    printf '%s\n' "$ack_output"
                    echo "stateless-client relay-ack failed." >&2
                    exit 1
                fi
            fi
        elif is_colibri_sync_backwards_error "$ack_output"; then
            echo "relay-ack hit sync-backwards. Retrying with source prover URLs disabled..."
            if ! ack_output="$(
                run_stateless_client_cli_with_retry \
                    relay-ack \
                    "${common_args[@]}" \
                    --source-prover-urls "," \
                    --ack-execution-block "$ack_execution_block_effective"
            )"; then
                printf '%s\n' "$ack_output"
                echo "stateless-client relay-ack failed." >&2
                exit 1
            fi
        else
            printf '%s\n' "$ack_output"
            echo "stateless-client relay-ack failed." >&2
            exit 1
        fi
    fi
    printf '%s\n' "$ack_output"

    ack_submit_tx_hash="$(extract_stateless_client_value "$ack_output" "submissionTxHash")"
    dest_final_status="$(extract_stateless_client_value "$ack_output" "resultingStatus")"
    echo "submitAckProof tx hash: $ack_submit_tx_hash"

    source_status_after_ack="$(cast call "$SOURCE_CONNECTOR" "txStatus(bytes32)(uint8)" "$tx_id" --rpc-url "$SOURCE_RPC")"
    if [[ "$source_status_after_ack" != "2" ]]; then
        echo "Source tx status mismatch: expected 2 (MINT_PROOF_ACCEPTED), got $source_status_after_ack" >&2
        exit 1
    fi
    if [[ "$source_status" != "2" ]]; then
        echo "Source tx status mismatch after relay-mint: expected 2 (MINT_PROOF_ACCEPTED), got $source_status" >&2
        exit 1
    fi
    if [[ "$dest_final_status" != "0" ]]; then
        echo "Destination tx status mismatch after ack: expected 0 (NONE), got $dest_final_status" >&2
        exit 1
    fi

    source_balance_after="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
    dest_balance_after="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEPLOYER_ADDRESS")"
    echo "Account token balances after transfer:"
    echo "  source chain ($SOURCE_CHAIN_ID): $source_balance_after"
    echo "  destination chain ($DEST_CHAIN_ID): $dest_balance_after"

    echo
    echo "Done (stateless-client relay)."
    echo "txId:                   $tx_id"
    echo "sourceConnector:        $SOURCE_CONNECTOR"
    echo "destConnector:          $DEST_CONNECTOR"
    echo "sourceToken:            $SOURCE_TOKEN"
    echo "destToken:              $DEST_TOKEN"
    echo "relay backend:          $proof_backend"
    echo "lock submit tx:         $lock_submit_tx_hash (block $dest_funds_released_block)"
    echo "mint submit tx:         $mint_submit_tx_hash (block $source_ack_ready_block)"
    echo "ack submit tx:          $ack_submit_tx_hash"
    echo "destination txStatus:   $dest_status (expected 4 for MINTED_IN_HOLDING)"
    echo "destination final:      $dest_final_status (expected 0 for NONE)"
    echo "source txStatus:        $source_status_after_ack (expected 2 for MINT_PROOF_ACCEPTED)"
    echo "account source balance: $SOURCE_BALANCE_BEFORE -> $source_balance_after"
    echo "account dest balance:   $DEST_BALANCE_BEFORE -> $dest_balance_after"
    echo "reuse source env:       REUSE_SOURCE_DEPLOYMENTS=1 EXISTING_SOURCE_CONNECTOR=$SOURCE_CONNECTOR EXISTING_SOURCE_TOKEN=$SOURCE_TOKEN EXISTING_SOURCE_RISC0_ADAPTER=${SOURCE_RISC0_ADAPTER:-}"
    echo "reuse dest env:         REUSE_DEST_DEPLOYMENTS=1 EXISTING_DEST_CONNECTOR=$DEST_CONNECTOR EXISTING_DEST_TOKEN=$DEST_TOKEN EXISTING_DEST_RISC0_ADAPTER=$DEST_RISC0_ADAPTER"
}

set_if_empty_var() {
    local var_name="$1"
    local value="$2"
    if [[ -z "${!var_name}" && -n "$value" ]]; then
        printf -v "$var_name" '%s' "$value"
    fi
}

apply_network_profile_defaults() {
    local side="$1"
    local profile="$2"
    local chain_var rpc_var colibri_rpc_var colibri_prover_var colibri_beacon_var colibri_checkpointz_var
    local default_chain default_rpc default_prover default_beacon default_checkpointz

    if [[ "$side" == "source" ]]; then
        chain_var="SOURCE_CHAIN_ID"
        rpc_var="SOURCE_RPC"
        colibri_rpc_var="COLIBRI_SOURCE_RPC_URLS"
        colibri_prover_var="COLIBRI_SOURCE_PROVER_URLS"
        colibri_beacon_var="COLIBRI_SOURCE_BEACON_URLS"
        colibri_checkpointz_var="COLIBRI_SOURCE_CHECKPOINTZ_URLS"
    else
        chain_var="DEST_CHAIN_ID"
        rpc_var="DEST_RPC"
        colibri_rpc_var="COLIBRI_DEST_RPC_URLS"
        colibri_prover_var="COLIBRI_DEST_PROVER_URLS"
        colibri_beacon_var="COLIBRI_DEST_BEACON_URLS"
        colibri_checkpointz_var="COLIBRI_DEST_CHECKPOINTZ_URLS"
    fi

    case "$profile" in
        local-anvil)
            default_chain="31337"
            default_rpc="http://127.0.0.1:8545"
            ;;
        local-hardhat)
            default_chain="31338"
            default_rpc="http://127.0.0.1:8546"
            ;;
        mainnet)
            default_chain="1"
            default_rpc="https://mainnet1.colibri-proof.tech/execution"
            default_prover="https://mainnet1.colibri-proof.tech"
            default_beacon="https://mainnet1.colibri-proof.tech/consensus/"
            ;;
        sepolia)
            default_chain="11155111"
            default_rpc="https://ethereum-sepolia-rpc.publicnode.com"
            default_prover="https://sepolia.colibri-proof.tech"
            default_beacon="https://ethereum-sepolia-beacon-api.publicnode.com"
            default_checkpointz="https://ethereum-sepolia-beacon-api.publicnode.com"
            ;;
        holesky)
            default_chain="17000"
            default_rpc="https://ethereum-holesky-rpc.publicnode.com"
            default_beacon="https://ethereum-holesky-beacon-api.publicnode.com"
            ;;
        hoodi)
            default_chain="560048"
            default_rpc="https://ethereum-hoodi-rpc.publicnode.com"
            default_beacon="https://ethereum-hoodi-beacon-api.publicnode.com"
            ;;
        gnosis)
            default_chain="100"
            default_rpc="https://rpc.ankr.com/gnosis"
            default_prover="https://gnosis.colibri-proof.tech"
            default_beacon="https://gnosis.colibri-proof.tech"
            ;;
        chiado)
            default_chain="10200"
            default_rpc="https://gnosis-chiado-rpc.publicnode.com"
            default_prover="https://chiado.colibri-proof.tech"
            default_beacon="${COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL},https://gnosis-chiado-beacon-api.publicnode.com"
            default_checkpointz="${COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL},https://gnosis-chiado-beacon-api.publicnode.com"
            ;;
        *)
            echo "Unsupported ${side} network profile: $profile" >&2
            echo "Supported profiles: local-anvil, local-hardhat, mainnet, sepolia, holesky, hoodi, gnosis, chiado" >&2
            exit 1
            ;;
    esac

    set_if_empty_var "$chain_var" "$default_chain"
    set_if_empty_var "$rpc_var" "$default_rpc"
    set_if_empty_var "$colibri_rpc_var" "${!rpc_var}"
    set_if_empty_var "$colibri_prover_var" "$default_prover"
    set_if_empty_var "$colibri_beacon_var" "$default_beacon"
    set_if_empty_var "$colibri_checkpointz_var" "$default_checkpointz"
}

initialize_network_and_colibri_defaults() {
    set_if_empty_var "COLIBRI_SOURCE_PROVER_URLS" "$COLIBRI_PROVER_URLS"
    set_if_empty_var "COLIBRI_DEST_PROVER_URLS" "$COLIBRI_PROVER_URLS"
    set_if_empty_var "COLIBRI_SOURCE_BEACON_URLS" "$COLIBRI_BEACON_URLS"
    set_if_empty_var "COLIBRI_DEST_BEACON_URLS" "$COLIBRI_BEACON_URLS"
    set_if_empty_var "COLIBRI_SOURCE_CHECKPOINTZ_URLS" "$COLIBRI_CHECKPOINTZ_URLS"
    set_if_empty_var "COLIBRI_DEST_CHECKPOINTZ_URLS" "$COLIBRI_CHECKPOINTZ_URLS"

    apply_network_profile_defaults "source" "$SOURCE_NETWORK_PROFILE"
    apply_network_profile_defaults "destination" "$DEST_NETWORK_PROFILE"

    set_if_empty_var "SOURCE_RPC" "http://127.0.0.1:8545"
    set_if_empty_var "DEST_RPC" "http://127.0.0.1:8546"
    set_if_empty_var "SOURCE_CHAIN_ID" "31337"
    set_if_empty_var "DEST_CHAIN_ID" "31338"
    set_if_empty_var "COLIBRI_SOURCE_RPC_URLS" "$SOURCE_RPC"
    set_if_empty_var "COLIBRI_DEST_RPC_URLS" "$DEST_RPC"
}

ensure_colibri_verifier_ready() {
    if [[ "$COLIBRI_VERIFY" != "1" ]]; then
        return 0
    fi

    require_cmd node

    if [[ ! -f "$COLIBRI_TS_DIR/src/verify-connector-stage.mjs" ]]; then
        echo "Missing Colibri stage verifier: $COLIBRI_TS_DIR/src/verify-connector-stage.mjs" >&2
        exit 1
    fi

    if [[ ! -d "$COLIBRI_TS_DIR/node_modules/@corpus-core/colibri-stateless" ]]; then
        echo "Missing Colibri npm dependencies in $COLIBRI_TS_DIR." >&2
        echo "Run: (cd \"$COLIBRI_TS_DIR\" && npm install)" >&2
        exit 1
    fi
}

ensure_risc0_r0vm_available() {
    if command -v r0vm >/dev/null 2>&1; then
        return 0
    fi

    local risc0_home="${RISC0_HOME:-$HOME/.risc0}"
    local candidate=""

    # Some rzup setups install r0vm under extensions but do not symlink it into PATH.
    candidate="$(ls -1d "$risc0_home"/extensions/*-cargo-risczero-*/r0vm 2>/dev/null | sort -V | tail -n1 || true)"
    if [[ -n "$candidate" && -x "$candidate" ]]; then
        export PATH="$(dirname "$candidate"):$PATH"
        echo "Using r0vm from rzup extension path: $candidate"
        return 0
    fi

    echo "Warning: r0vm not found in PATH; ImageID computation may be slow." >&2
}

run_colibri_stage_verification() {
    local stage="$1"
    local chain_id="$2"
    local connector="$3"
    local tx_id="$4"
    local expected_src_connector="$5"
    local expected_dst_connector="$6"
    local rpc_urls="$7"
    local prover_urls="$8"
    local beacon_urls="$9"
    local checkpointz_urls="${10}"
    local fixed_to_block="${11:-}"
    local lookback_blocks="$COLIBRI_LOG_LOOKBACK_BLOCKS"
    local max_retries="$COLIBRI_VERIFY_RETRIES"
    local retry_delay_sec="$COLIBRI_VERIFY_RETRY_DELAY_SEC"
    local primary_rpc="${rpc_urls%%,*}"
    local stage_enabled="1"
    local fixed_to_block_dec=""
    local fixed_to_block_hex=""

    if [[ "$COLIBRI_VERIFY" != "1" ]]; then
        return 0
    fi

    case "$stage" in
        source-deposit)
            stage_enabled="$COLIBRI_VERIFY_SOURCE_DEPOSIT"
            ;;
        destination-funds-released)
            stage_enabled="$COLIBRI_VERIFY_DEST_FUNDS_RELEASED"
            ;;
        source-ack-ready)
            stage_enabled="$COLIBRI_VERIFY_SOURCE_ACK_READY"
            ;;
    esac

    if [[ "$stage_enabled" != "1" ]]; then
        echo "Skipping Colibri trustless verification for stage '$stage' (disabled by env)."
        return 0
    fi

    if [[ -n "$fixed_to_block" ]]; then
        if [[ "$fixed_to_block" =~ ^0x[0-9a-fA-F]+$ ]]; then
            fixed_to_block_hex="$(printf '%s' "$fixed_to_block" | tr 'A-F' 'a-f')"
            fixed_to_block_dec="$(cast --to-dec "$fixed_to_block" 2>/dev/null || true)"
        elif [[ "$fixed_to_block" =~ ^[0-9]+$ ]]; then
            fixed_to_block_dec="$fixed_to_block"
            fixed_to_block_hex="$(printf "0x%x" "$fixed_to_block")"
        fi
    fi

    # Chiado providers commonly enforce a 10k block cap for eth_getLogs.
    if [[ "$chain_id" == "10200" && "$lookback_blocks" =~ ^[0-9]+$ && "$lookback_blocks" -gt 10000 ]]; then
        lookback_blocks=10000
    fi

    echo "Running Colibri trustless verification for stage '$stage'..."
    local cmd=(
        node
        "$COLIBRI_TS_DIR/src/verify-connector-stage.mjs"
        --stage
        "$stage"
        --chain-id
        "$chain_id"
        --connector
        "$connector"
        --tx-id
        "$tx_id"
        --expected-src-connector
        "$expected_src_connector"
        --expected-dst-connector
        "$expected_dst_connector"
        --rpc-urls
        "$rpc_urls"
    )

    # Many public RPC providers cap eth_getLogs range. Use a bounded inclusive window by default.
    # Also pin to-block to avoid range growth during retries.
    if [[ "$lookback_blocks" =~ ^[0-9]+$ && "$lookback_blocks" -gt 0 ]]; then
        local current_block from_block_dec from_block_hex to_block_hex target_block_dec=""
        target_block_dec="$fixed_to_block_dec"

        if [[ -n "$target_block_dec" ]]; then
            current_block="$target_block_dec"
        elif [[ -n "$primary_rpc" ]]; then
            current_block="$(cast block-number --rpc-url "$primary_rpc" 2>/dev/null || true)"
        fi

        if [[ "$current_block" =~ ^[0-9]+$ ]]; then
            # Inclusive range [from,to] must be <= lookback_blocks.
            if (( current_block + 1 > lookback_blocks )); then
                from_block_dec=$((current_block - lookback_blocks + 1))
            else
                from_block_dec=0
            fi
            from_block_hex="$(printf "0x%x" "$from_block_dec")"
            to_block_hex="$(printf "0x%x" "$current_block")"
            cmd+=(--from-block "$from_block_hex")
            cmd+=(--to-block "$to_block_hex")
        fi
    fi

    if [[ -n "$prover_urls" ]]; then
        cmd+=(--prover-urls "$prover_urls")
    fi
    if [[ -n "$beacon_urls" ]]; then
        cmd+=(--beacon-urls "$beacon_urls")
    fi
    if [[ -n "$checkpointz_urls" ]]; then
        cmd+=(--checkpointz-urls "$checkpointz_urls")
    fi

    local attempt=0
    local chiado_parent_root_fallback_applied=0
    local chiado_sync_backwards_range_relaxed=0
    local chiado_sync_backwards_prover_fallback_applied=0
    local chiado_sync_backwards_state_reset_applied=0
    local output rc
    while true; do
        set +e
        output="$("${cmd[@]}" 2>&1)"
        rc=$?
        set -e

        if [[ -n "$output" ]]; then
            printf '%s\n' "$output"
        fi

        if [[ "$rc" -eq 0 ]]; then
            return 0
        fi

        # Colibri may need a successor execution block to resolve parentBeaconBlockRoot linkage.
        # This happens when verifying data from the current head block.
        if [[ "$output" == *"parentBeaconBlockRoot"* && "$output" == *"Block after"* ]]; then
            if [[ "$attempt" -lt "$max_retries" ]]; then
                attempt=$((attempt + 1))
                echo "Colibri stage '$stage' needs a successor block. Retrying in ${retry_delay_sec}s (${attempt}/${max_retries})..."
                sleep "$retry_delay_sec"
                continue
            fi
        fi

        # On some chains/providers, a freshly mined block may briefly be unavailable for signature verification.
        if [[ "$output" == *"has not been signed yet and cannot be verified"* || "$output" == *"requested block has not been signed yet"* ]]; then
            if [[ "$chain_id" == "10200" && "$chiado_parent_root_fallback_applied" -eq 0 \
                && "$beacon_urls" == *"gnosis-chiado-beacon-api.publicnode.com"* \
                && "$beacon_urls" != *"$COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL"* ]]; then
                local fallback_beacon_urls="${COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL},$beacon_urls"
                echo "Colibri stage '$stage' switching Chiado beacon URLs to include parent_root-capable fallback: $COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL"
                local i
                for ((i = 0; i < ${#cmd[@]}; i++)); do
                    if [[ "${cmd[$i]}" == "--beacon-urls" ]]; then
                        cmd[$((i + 1))]="$fallback_beacon_urls"
                        break
                    fi
                done
                beacon_urls="$fallback_beacon_urls"
                chiado_parent_root_fallback_applied=1
                continue
            fi
            if [[ "$attempt" -lt "$max_retries" ]]; then
                attempt=$((attempt + 1))
                echo "Colibri stage '$stage' block is not signature-ready yet. Retrying in ${retry_delay_sec}s (${attempt}/${max_retries})..."
                sleep "$retry_delay_sec"
                continue
            fi
        fi

        # Some public beacon providers intermittently return malformed/partial bootstrap payloads.
        # Retry these transient SSZ decode failures.
        if [[ "$output" == *"Invalid offset for container"* || "$output" == *"Invalid SSZ structure in bootstrap data"* ]]; then
            if [[ "$attempt" -lt "$max_retries" ]]; then
                attempt=$((attempt + 1))
                echo "Colibri stage '$stage' got transient SSZ/bootstrap parse error. Retrying in ${retry_delay_sec}s (${attempt}/${max_retries})..."
                sleep "$retry_delay_sec"
                continue
            fi
        fi

        # Chiado prover backend can occasionally move to a newer period and reject older-period requests.
        # First, relax block pinning from [fixed,fixed] to [fixed,latest]; if needed, retry without remote prover URL.
        if [[ "$output" == *"last sync state is higher than the required period"* && "$output" == *"cannot sync backwards"* ]]; then
            if [[ "$chain_id" == "10200" && -n "$fixed_to_block_hex" && "$chiado_sync_backwards_range_relaxed" -eq 0 ]]; then
                echo "Colibri stage '$stage' got Chiado sync-backwards error; switching block range to $fixed_to_block_hex..latest and retrying."
                local i
                local has_from_block=0
                local has_to_block=0
                for ((i = 0; i < ${#cmd[@]}; i++)); do
                    if [[ "${cmd[$i]}" == "--from-block" ]]; then
                        cmd[$((i + 1))]="$fixed_to_block_hex"
                        has_from_block=1
                    elif [[ "${cmd[$i]}" == "--to-block" ]]; then
                        cmd[$((i + 1))]="latest"
                        has_to_block=1
                    fi
                done
                if [[ "$has_from_block" -eq 0 ]]; then
                    cmd+=(--from-block "$fixed_to_block_hex")
                fi
                if [[ "$has_to_block" -eq 0 ]]; then
                    cmd+=(--to-block "latest")
                fi
                chiado_sync_backwards_range_relaxed=1
                continue
            fi

            if [[ "$chain_id" == "10200" && -n "$prover_urls" && "$chiado_sync_backwards_prover_fallback_applied" -eq 0 ]]; then
                echo "Colibri stage '$stage' got Chiado sync-backwards error; retrying without remote prover URL for this stage."
                local filtered_cmd=()
                local i
                for ((i = 0; i < ${#cmd[@]}; i++)); do
                    if [[ "${cmd[$i]}" == "--prover-urls" ]]; then
                        i=$((i + 1))
                        continue
                    fi
                    filtered_cmd+=("${cmd[$i]}")
                done
                cmd=("${filtered_cmd[@]}")
                prover_urls=""
                chiado_sync_backwards_prover_fallback_applied=1
                continue
            fi

            if [[ "$chain_id" == "10200" && "$COLIBRI_RESET_STATE_ON_SYNC_BACKWARDS" == "1" \
                && "$chiado_sync_backwards_state_reset_applied" -eq 0 ]]; then
                local state_file="states_${chain_id}"
                local removed_any=0
                local candidate
                for candidate in \
                    "$PWD/$state_file" \
                    "$ROOT_DIR/$state_file" \
                    "$SC_DIR/$state_file" \
                    "$COLIBRI_TS_DIR/$state_file" \
                    "$STATELESS_CLIENT_DIR/colibri-cache/$state_file"; do
                    if [[ -f "$candidate" ]]; then
                        rm -f "$candidate"
                        echo "Colibri stage '$stage' removed stale local state file: $candidate"
                        removed_any=1
                    fi
                done
                if [[ "$removed_any" -eq 0 ]]; then
                    echo "Colibri stage '$stage' did not find local state file '$state_file' to reset."
                fi
                echo "Colibri stage '$stage' retrying after local Chiado state reset."
                chiado_sync_backwards_state_reset_applied=1
                continue
            fi

            if [[ "$attempt" -lt "$max_retries" ]]; then
                attempt=$((attempt + 1))
                echo "Colibri stage '$stage' prover period sync mismatch. Retrying in ${retry_delay_sec}s (${attempt}/${max_retries})..."
                sleep "$retry_delay_sec"
                continue
            fi
        fi

        break
    done

    if [[ "$rc" -eq 2 ]]; then
        echo "Colibri trustless verification is not available for chain $chain_id." >&2
        if [[ "$chain_id" == "31337" || "$chain_id" == "31338" ]]; then
            echo "Local dev chains (31337/31338) are not Colibri-proofable." >&2
        else
            echo "This usually means the installed @corpus-core/colibri-stateless package does not mark this chain as proofable for eth_getLogs/eth_call." >&2
        fi
        echo "You can disable only this stage using stage-specific env toggles:" >&2
        echo "  COLIBRI_VERIFY_SOURCE_DEPOSIT=0" >&2
        echo "  COLIBRI_VERIFY_DEST_FUNDS_RELEASED=0" >&2
        echo "  COLIBRI_VERIFY_SOURCE_ACK_READY=0" >&2
        echo "Use a Colibri-supported chain for trustless verification, or run local E2E without Colibri by setting COLIBRI_VERIFY=0." >&2
    fi

    exit "$rc"
}

initialize_network_and_colibri_defaults

require_cmd cast
require_cmd forge
require_cmd awk
require_cmd tr
require_cmd curl
require_cmd sed
if [[ "$USE_STATELESS_CLIENT" == "1" ]]; then
    require_cmd node
    require_cmd npm
fi
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    require_cmd docker
else
    require_cmd cargo
    if [[ "$RISC0_GUEST_USE_DOCKER" == "1" ]]; then
        require_cmd docker
    fi
fi
ensure_colibri_verifier_ready
ensure_risc0_r0vm_available
resolve_private_key

ACTUAL_SOURCE_CHAIN_ID="$(cast chain-id --rpc-url "$SOURCE_RPC")"
ACTUAL_DEST_CHAIN_ID="$(cast chain-id --rpc-url "$DEST_RPC")"

if [[ "$ACTUAL_SOURCE_CHAIN_ID" != "$SOURCE_CHAIN_ID" ]]; then
    echo "Source chain ID mismatch: expected $SOURCE_CHAIN_ID, got $ACTUAL_SOURCE_CHAIN_ID" >&2
    exit 1
fi
if [[ "$ACTUAL_DEST_CHAIN_ID" != "$DEST_CHAIN_ID" ]]; then
    echo "Destination chain ID mismatch: expected $DEST_CHAIN_ID, got $ACTUAL_DEST_CHAIN_ID" >&2
    exit 1
fi
if [[ "$SOURCE_CHAIN_ID" == "$DEST_CHAIN_ID" ]]; then
    echo "Source and destination chain IDs must differ." >&2
    exit 1
fi

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$PRIVATE_KEY")"
echo "Deployer: $DEPLOYER_ADDRESS"
echo "Source network profile: $SOURCE_NETWORK_PROFILE"
echo "Destination network profile: $DEST_NETWORK_PROFILE"
echo "Source RPC: $SOURCE_RPC (chain $SOURCE_CHAIN_ID)"
echo "Dest RPC: $DEST_RPC (chain $DEST_CHAIN_ID)"
echo "RISC0 prover: $RISC0_PROVER_MODE"
echo "Docker prover: $USE_DOCKER_PROVER"
echo "RISC0 guest docker build: $RISC0_GUEST_USE_DOCKER"
echo "Stateless client relay: $USE_STATELESS_CLIENT"
echo "Colibri verification: $COLIBRI_VERIFY"
if [[ "$USE_STATELESS_CLIENT" == "1" ]]; then
    if [[ -z "$STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK" ]]; then
        echo "Chiado sync-backwards RPC fallback: enabled (default)"
    elif [[ "$STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK" == "0" || "${STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK,,}" == "false" ]]; then
        echo "Chiado sync-backwards RPC fallback: disabled"
    else
        echo "Chiado sync-backwards RPC fallback: enabled"
    fi
fi

echo "Building contracts and zk host binaries..."
(
    cd "$SC_DIR"
    forge build --skip test >/dev/null
)
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    if [[ ! -f "$DOCKER_LOCK_PROVER_SCRIPT" ]]; then
        echo "Lock docker prover script not found: $DOCKER_LOCK_PROVER_SCRIPT" >&2
        exit 1
    fi
    if [[ ! -f "$DOCKER_MINT_PROVER_SCRIPT" ]]; then
        echo "Mint docker prover script not found: $DOCKER_MINT_PROVER_SCRIPT" >&2
        exit 1
    fi
    if [[ ! -f "$DOCKER_ACK_PROVER_SCRIPT" ]]; then
        echo "Ack docker prover script not found: $DOCKER_ACK_PROVER_SCRIPT" >&2
        exit 1
    fi
    LOCK_IMAGE_ID="$(
        cd "$ROOT_DIR"
        PROVER_ACTION=print-image-id \
        bash "$DOCKER_LOCK_PROVER_SCRIPT"
    )"
    MINT_IMAGE_ID="$(
        cd "$ROOT_DIR"
        PROVER_ACTION=print-image-id \
        bash "$DOCKER_MINT_PROVER_SCRIPT"
    )"
    ACK_IMAGE_ID="$(
        cd "$ROOT_DIR"
        PROVER_ACTION=print-image-id \
        bash "$DOCKER_ACK_PROVER_SCRIPT"
    )"
else
    (
        cd "$LOCK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo build -p lock-proof-host --bin print_image_id >/dev/null
    )
    (
        cd "$MINT_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo build -p mint-proof-host --bin print_image_id >/dev/null
    )
    (
        cd "$ACK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo build -p ack-proof-host --bin print_image_id >/dev/null
    )

    LOCK_IMAGE_ID="$(
        cd "$LOCK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo run -q -p lock-proof-host --bin print_image_id
    )"
    MINT_IMAGE_ID="$(
        cd "$MINT_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo run -q -p mint-proof-host --bin print_image_id
    )"
    ACK_IMAGE_ID="$(
        cd "$ACK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo run -q -p ack-proof-host --bin print_image_id
    )"
fi
echo "Lock guest image ID: $LOCK_IMAGE_ID"
echo "Mint guest image ID: $MINT_IMAGE_ID"
echo "Ack guest image ID:  $ACK_IMAGE_ID"

if [[ "$REUSE_DEST_DEPLOYMENTS" == "1" ]]; then
    require_env_value "EXISTING_DEST_CONNECTOR" "$EXISTING_DEST_CONNECTOR"
    require_env_value "EXISTING_DEST_TOKEN" "$EXISTING_DEST_TOKEN"
    require_env_value "EXISTING_DEST_RISC0_ADAPTER" "$EXISTING_DEST_RISC0_ADAPTER"

    DEST_CONNECTOR="$EXISTING_DEST_CONNECTOR"
    DEST_TOKEN="$EXISTING_DEST_TOKEN"
    DEST_RISC0_ADAPTER="$EXISTING_DEST_RISC0_ADAPTER"

    echo "Reusing destination deployments:"
    echo "  DEST_CONNECTOR: $DEST_CONNECTOR"
    echo "  DEST_TOKEN: $DEST_TOKEN"
    echo "  DEST_RISC0_ADAPTER: $DEST_RISC0_ADAPTER"
else
    echo "Deploying destination chain contracts..."
    DEST_RISC0_VERIFIER="$(
        deploy_contract \
            "$DEST_RPC" \
            "lib/risc0-ethereum/contracts/src/groth16/RiscZeroGroth16Verifier.sol:RiscZeroGroth16Verifier" \
            --constructor-args "$CONTROL_ROOT" "$BN254_CONTROL_ID"
    )"
    DEST_RISC0_ADAPTER="$(
        deploy_contract \
            "$DEST_RPC" \
            "src/zk-proof/adapters/RiscZeroAdapter.sol:RiscZeroAdapter" \
            --constructor-args "$DEST_RISC0_VERIFIER" "[$LOCK_IMAGE_ID,$ACK_IMAGE_ID]"
    )"
    DEST_MOCK_SNARK_VERIFIER="$(
        deploy_contract \
            "$DEST_RPC" \
            "script/Connector.s.sol:MockSnarkVerifier"
    )"
    DEST_SNARK_ADAPTER="$(
        deploy_contract \
            "$DEST_RPC" \
            "src/zk-proof/adapters/SnarkAdapter.sol:SnarkAdapter" \
            --constructor-args "$DEST_MOCK_SNARK_VERIFIER"
    )"
    DEST_CONNECTOR="$(
        deploy_contract \
            "$DEST_RPC" \
            "src/connectors/Connector.sol:Connector" \
            --constructor-args "$DEST_RISC0_ADAPTER" "$DEST_SNARK_ADAPTER" "$ACK_WINDOW_SECONDS" "[$BYTES32_ZERO,$BYTES32_ZERO,$LOCK_IMAGE_ID,$ACK_IMAGE_ID,$BYTES32_ZERO]"
    )"
    DEST_TOKEN="$(
        deploy_contract \
            "$DEST_RPC" \
            "script/MockERC20.s.sol:MockERC20" \
            --constructor-args "$DEST_TOKEN_NAME" "$DEST_TOKEN_SYMBOL"
    )"
fi

if [[ "$REUSE_SOURCE_DEPLOYMENTS" == "1" ]]; then
    require_env_value "EXISTING_SOURCE_CONNECTOR" "$EXISTING_SOURCE_CONNECTOR"
    require_env_value "EXISTING_SOURCE_TOKEN" "$EXISTING_SOURCE_TOKEN"

    SOURCE_CONNECTOR="$EXISTING_SOURCE_CONNECTOR"
    SOURCE_TOKEN="$EXISTING_SOURCE_TOKEN"
    SOURCE_RISC0_ADAPTER="$EXISTING_SOURCE_RISC0_ADAPTER"

    echo "Reusing source deployments:"
    echo "  SOURCE_CONNECTOR: $SOURCE_CONNECTOR"
    echo "  SOURCE_TOKEN: $SOURCE_TOKEN"
    if [[ -n "$SOURCE_RISC0_ADAPTER" ]]; then
        echo "  SOURCE_RISC0_ADAPTER: $SOURCE_RISC0_ADAPTER"
    fi
else
    echo "Deploying source chain contracts..."
    SOURCE_RISC0_VERIFIER="$(
        deploy_contract \
            "$SOURCE_RPC" \
            "lib/risc0-ethereum/contracts/src/groth16/RiscZeroGroth16Verifier.sol:RiscZeroGroth16Verifier" \
            --constructor-args "$CONTROL_ROOT" "$BN254_CONTROL_ID"
    )"
    SOURCE_MOCK_SNARK_VERIFIER="$(
        deploy_contract \
            "$SOURCE_RPC" \
            "script/Connector.s.sol:MockSnarkVerifier"
    )"
    SOURCE_RISC0_ADAPTER="$(
        deploy_contract \
            "$SOURCE_RPC" \
            "src/zk-proof/adapters/RiscZeroAdapter.sol:RiscZeroAdapter" \
            --constructor-args "$SOURCE_RISC0_VERIFIER" "[$MINT_IMAGE_ID]"
    )"
    SOURCE_SNARK_ADAPTER="$(
        deploy_contract \
            "$SOURCE_RPC" \
            "src/zk-proof/adapters/SnarkAdapter.sol:SnarkAdapter" \
            --constructor-args "$SOURCE_MOCK_SNARK_VERIFIER"
    )"
    SOURCE_CONNECTOR="$(
        deploy_contract \
            "$SOURCE_RPC" \
            "src/connectors/Connector.sol:Connector" \
            --constructor-args "$SOURCE_RISC0_ADAPTER" "$SOURCE_SNARK_ADAPTER" "$ACK_WINDOW_SECONDS" "[$MINT_IMAGE_ID,$BYTES32_ZERO,$BYTES32_ZERO,$BYTES32_ZERO,$BYTES32_ZERO]"
    )"
    SOURCE_TOKEN="$(
        deploy_contract \
            "$SOURCE_RPC" \
            "script/MockERC20.s.sol:MockERC20" \
            --constructor-args "$TOKEN_NAME" "$TOKEN_SYMBOL"
    )"
fi

echo "Minting and locking on source chain..."
cast send \
    "$SOURCE_TOKEN" \
    "mint(address,uint256)" \
    "$DEPLOYER_ADDRESS" \
    "$AMOUNT_WEI" \
    --rpc-url "$SOURCE_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

SOURCE_BALANCE_BEFORE="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
DEST_BALANCE_BEFORE="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEPLOYER_ADDRESS")"
echo "Account token balances before transfer:"
echo "  source chain ($SOURCE_CHAIN_ID): $SOURCE_BALANCE_BEFORE"
echo "  destination chain ($DEST_CHAIN_ID): $DEST_BALANCE_BEFORE"

cast send \
    "$SOURCE_TOKEN" \
    "approve(address,uint256)" \
    "$SOURCE_CONNECTOR" \
    "$AMOUNT_WEI" \
    --rpc-url "$SOURCE_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

SOURCE_TX_NONCE="$(query_tx_nonce "$SOURCE_RPC" "$SOURCE_CONNECTOR")"
echo "Source connector txNonce before deposit: $SOURCE_TX_NONCE"

DEPOSIT_TX_HASH="$(
    send_tx_async \
        "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" \
        "depositAndLock(address,address,address,uint256,address)" \
        "$SOURCE_TOKEN" \
        "$DEST_TOKEN" \
        "$DEPLOYER_ADDRESS" \
        "$AMOUNT_WEI" \
        "$DEST_CONNECTOR"
)"
SOURCE_DEPOSIT_BLOCK="$(wait_for_tx_receipt_block "$SOURCE_RPC" "$DEPOSIT_TX_HASH")"
echo "Deposit tx hash: $DEPOSIT_TX_HASH (block $SOURCE_DEPOSIT_BLOCK)"

TX_ID="$(
    compute_tx_id \
        "$DEPLOYER_ADDRESS" \
        "$DEPLOYER_ADDRESS" \
        "$AMOUNT_WEI" \
        "$SOURCE_TOKEN" \
        "$DEST_TOKEN" \
        "$SOURCE_CONNECTOR" \
        "$DEST_CONNECTOR" \
        "$SOURCE_TX_NONCE"
)"
echo "Computed txId: $TX_ID"

if [[ "$USE_STATELESS_CLIENT" == "1" ]]; then
    run_stateless_client_relay_flow "$TX_ID" "$SOURCE_DEPOSIT_BLOCK"
    exit 0
fi

run_colibri_stage_verification \
    "source-deposit" \
    "$SOURCE_CHAIN_ID" \
    "$SOURCE_CONNECTOR" \
    "$TX_ID" \
    "$SOURCE_CONNECTOR" \
    "$DEST_CONNECTOR" \
    "$COLIBRI_SOURCE_RPC_URLS" \
    "$COLIBRI_SOURCE_PROVER_URLS" \
    "$COLIBRI_SOURCE_BEACON_URLS" \
    "$COLIBRI_SOURCE_CHECKPOINTZ_URLS" \
    "$SOURCE_DEPOSIT_BLOCK"

echo "Generating RISC Zero lock proof..."
echo "Proof generation can take several minutes on first run."
LOCK_EXECUTION_BLOCK_EFFECTIVE="${LOCK_EXECUTION_BLOCK:-$SOURCE_DEPOSIT_BLOCK}"
LOCK_EXECUTION_BLOCK_EFFECTIVE="$(normalize_execution_block_tag "$LOCK_EXECUTION_BLOCK_EFFECTIVE")"
echo "Lock proof execution block: $LOCK_EXECUTION_BLOCK_EFFECTIVE"
LOCK_PROOF_LOG="$(mktemp)"
set +e
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    (
        cd "$ROOT_DIR"
        PROVER_ACTION=prove \
        RISC0_PROVER_MODE="$RISC0_PROVER_MODE" \
        RPC_URL="$SOURCE_RPC" \
        EXECUTION_BLOCK="$LOCK_EXECUTION_BLOCK_EFFECTIVE" \
        CONNECTOR="$SOURCE_CONNECTOR" \
        TX_ID="$TX_ID" \
        SOURCE_CHAIN_ID="$SOURCE_CHAIN_ID" \
        DEST_CHAIN_ID="$DEST_CHAIN_ID" \
        bash "$DOCKER_LOCK_PROVER_SCRIPT"
    ) 2>&1 | tee "$LOCK_PROOF_LOG"
    LOCK_PROOF_STATUS=${PIPESTATUS[0]}
else
    (
        cd "$LOCK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        RISC0_PROVER="$RISC0_PROVER_MODE" \
        RPC_URL="$SOURCE_RPC" \
        EXECUTION_BLOCK="$LOCK_EXECUTION_BLOCK_EFFECTIVE" \
        cargo run -p lock-proof-host --bin lock-proof-host -- \
            --connector "$SOURCE_CONNECTOR" \
            --tx-id "$TX_ID" \
            --source-chain-id "$SOURCE_CHAIN_ID" \
            --destination-chain-id "$DEST_CHAIN_ID"
    ) 2>&1 | tee "$LOCK_PROOF_LOG"
    LOCK_PROOF_STATUS=${PIPESTATUS[0]}
fi
set -e
if [[ "$LOCK_PROOF_STATUS" -ne 0 ]]; then
    echo "Lock proof generation failed." >&2
    rm -f "$LOCK_PROOF_LOG"
    exit "$LOCK_PROOF_STATUS"
fi
LOCK_PROOF_OUTPUT="$(cat "$LOCK_PROOF_LOG")"
rm -f "$LOCK_PROOF_LOG"

LOCK_PROOF_PAYLOAD="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "proofPayload")"
LOCK_PROOF_TX_ID="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "txId")"
LOCK_PROOF_AMOUNT="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "amount")"
LOCK_PROOF_SENDER="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "sender")"
LOCK_PROOF_RECEIVER="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "receiver")"
LOCK_PROOF_CURRENCY_FROM="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "currencyFrom")"
LOCK_PROOF_CURRENCY_TO="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "currencyTo")"
LOCK_PROOF_SRC_CONNECTOR="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "srcChainConnector")"
LOCK_PROOF_ORIGIN_ACK_DEADLINE="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "originAckDeadline")"
LOCK_PROOF_NONCE="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "nonce")"
LOCK_PROOF_SOURCE_CHAIN_ID="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "sourceChainId")"
LOCK_PROOF_DEST_CHAIN_ID="$(extract_proof_value "$LOCK_PROOF_OUTPUT" "destChainId")"

if [[ "$(to_lower "$LOCK_PROOF_TX_ID")" != "$(to_lower "$TX_ID")" ]]; then
    echo "Lock proof txId mismatch: expected $TX_ID, got $LOCK_PROOF_TX_ID" >&2
    exit 1
fi
if [[ "$LOCK_PROOF_DEST_CHAIN_ID" != "$DEST_CHAIN_ID" ]]; then
    echo "Lock proof destination chain id mismatch: expected $DEST_CHAIN_ID, got $LOCK_PROOF_DEST_CHAIN_ID" >&2
    exit 1
fi

echo "Submitting lock proof on destination chain..."
LOCK_SUBMIT_TX_HASH="$(
    send_tx_async \
        "$DEST_RPC" \
        "$DEST_CONNECTOR" \
        "submitLockProof(uint8,bytes,bytes32,uint256,address,address,address,address,address,uint64,uint256,uint256)" \
        0 \
        "$LOCK_PROOF_PAYLOAD" \
        "$TX_ID" \
        "$LOCK_PROOF_AMOUNT" \
        "$LOCK_PROOF_CURRENCY_FROM" \
        "$LOCK_PROOF_CURRENCY_TO" \
        "$LOCK_PROOF_SENDER" \
        "$LOCK_PROOF_RECEIVER" \
        "$LOCK_PROOF_SRC_CONNECTOR" \
        "$LOCK_PROOF_ORIGIN_ACK_DEADLINE" \
        "$LOCK_PROOF_NONCE" \
        "$LOCK_PROOF_SOURCE_CHAIN_ID" \
        --gas-limit "$LOCK_PROOF_GAS_LIMIT"
)"
DEST_FUNDS_RELEASED_BLOCK="$(wait_for_tx_receipt_block "$DEST_RPC" "$LOCK_SUBMIT_TX_HASH")"
echo "submitLockProof tx hash: $LOCK_SUBMIT_TX_HASH (block $DEST_FUNDS_RELEASED_BLOCK)"

DEST_STATUS="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"
echo "Minting wrapped tokens on destination for balance verification..."
cast send \
    "$DEST_TOKEN" \
    "mint(address,uint256)" \
    "$DEST_CONNECTOR" \
    "$AMOUNT_WEI" \
    --gas-limit "$DEST_TOKEN_MINT_GAS_LIMIT" \
    --rpc-url "$DEST_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

run_colibri_stage_verification \
    "destination-funds-released" \
    "$DEST_CHAIN_ID" \
    "$DEST_CONNECTOR" \
    "$TX_ID" \
    "$SOURCE_CONNECTOR" \
    "$DEST_CONNECTOR" \
    "$COLIBRI_DEST_RPC_URLS" \
    "$COLIBRI_DEST_PROVER_URLS" \
    "$COLIBRI_DEST_BEACON_URLS" \
    "$COLIBRI_DEST_CHECKPOINTZ_URLS" \
    "$DEST_FUNDS_RELEASED_BLOCK"

echo "Generating RISC Zero mint proof from destination FundsReleased..."
MINT_EXECUTION_BLOCK_EFFECTIVE="${MINT_EXECUTION_BLOCK:-$DEST_FUNDS_RELEASED_BLOCK}"
MINT_EXECUTION_BLOCK_EFFECTIVE="$(normalize_execution_block_tag "$MINT_EXECUTION_BLOCK_EFFECTIVE")"
echo "Mint proof execution block: $MINT_EXECUTION_BLOCK_EFFECTIVE"
MINT_PROOF_LOG="$(mktemp)"
set +e
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    (
        cd "$ROOT_DIR"
        PROVER_ACTION=prove \
        RISC0_PROVER_MODE="$RISC0_PROVER_MODE" \
        RPC_URL="$DEST_RPC" \
        EXECUTION_BLOCK="$MINT_EXECUTION_BLOCK_EFFECTIVE" \
        CONNECTOR="$DEST_CONNECTOR" \
        TX_ID="$TX_ID" \
        DESTINATION_CHAIN_ID="$DEST_CHAIN_ID" \
        bash "$DOCKER_MINT_PROVER_SCRIPT"
    ) 2>&1 | tee "$MINT_PROOF_LOG"
    MINT_PROOF_STATUS=${PIPESTATUS[0]}
else
    (
        cd "$MINT_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        RISC0_PROVER="$RISC0_PROVER_MODE" \
        RPC_URL="$DEST_RPC" \
        EXECUTION_BLOCK="$MINT_EXECUTION_BLOCK_EFFECTIVE" \
        cargo run -p mint-proof-host --bin mint-proof-host -- \
            --connector "$DEST_CONNECTOR" \
            --tx-id "$TX_ID" \
            --destination-chain-id "$DEST_CHAIN_ID"
    ) 2>&1 | tee "$MINT_PROOF_LOG"
    MINT_PROOF_STATUS=${PIPESTATUS[0]}
fi
set -e
if [[ "$MINT_PROOF_STATUS" -ne 0 ]]; then
    echo "Mint proof generation failed." >&2
    rm -f "$MINT_PROOF_LOG"
    exit "$MINT_PROOF_STATUS"
fi
MINT_PROOF_OUTPUT="$(cat "$MINT_PROOF_LOG")"
rm -f "$MINT_PROOF_LOG"

MINT_PROOF_PAYLOAD="$(extract_proof_value "$MINT_PROOF_OUTPUT" "proofPayload")"
MINT_PROOF_TX_ID="$(extract_proof_value "$MINT_PROOF_OUTPUT" "txId")"
MINT_PROOF_DST_CONNECTOR="$(extract_proof_value "$MINT_PROOF_OUTPUT" "dstChainConnector")"
MINT_PROOF_AMOUNT="$(extract_proof_value "$MINT_PROOF_OUTPUT" "amount")"
MINT_PROOF_RECEIVER="$(extract_proof_value "$MINT_PROOF_OUTPUT" "receiver")"

if [[ "$(to_lower "$MINT_PROOF_TX_ID")" != "$(to_lower "$TX_ID")" ]]; then
    echo "Mint proof txId mismatch: expected $TX_ID, got $MINT_PROOF_TX_ID" >&2
    exit 1
fi
if [[ "$(to_lower "$MINT_PROOF_DST_CONNECTOR")" != "$(to_lower "$DEST_CONNECTOR")" ]]; then
    echo "Mint proof dst connector mismatch: expected $DEST_CONNECTOR, got $MINT_PROOF_DST_CONNECTOR" >&2
    exit 1
fi
if [[ "$MINT_PROOF_AMOUNT" != "$AMOUNT_WEI" ]]; then
    echo "Mint proof amount mismatch: expected $AMOUNT_WEI, got $MINT_PROOF_AMOUNT" >&2
    exit 1
fi
if [[ "$(to_lower "$MINT_PROOF_RECEIVER")" != "$(to_lower "$DEPLOYER_ADDRESS")" ]]; then
    echo "Mint proof receiver mismatch: expected $DEPLOYER_ADDRESS, got $MINT_PROOF_RECEIVER" >&2
    exit 1
fi

echo "Submitting mint proof on source chain..."
MINT_SUBMIT_TX_HASH="$(
    send_tx_async \
        "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" \
        "submitMintProof(uint8,bytes,bytes32)" \
        0 \
        "$MINT_PROOF_PAYLOAD" \
        "$TX_ID" \
        --gas-limit "$MINT_PROOF_GAS_LIMIT"
)"
SOURCE_ACK_READY_BLOCK="$(wait_for_tx_receipt_block "$SOURCE_RPC" "$MINT_SUBMIT_TX_HASH")"
echo "submitMintProof tx hash: $MINT_SUBMIT_TX_HASH (block $SOURCE_ACK_READY_BLOCK)"

run_colibri_stage_verification \
    "source-ack-ready" \
    "$SOURCE_CHAIN_ID" \
    "$SOURCE_CONNECTOR" \
    "$TX_ID" \
    "$SOURCE_CONNECTOR" \
    "$DEST_CONNECTOR" \
    "$COLIBRI_SOURCE_RPC_URLS" \
    "$COLIBRI_SOURCE_PROVER_URLS" \
    "$COLIBRI_SOURCE_BEACON_URLS" \
    "$COLIBRI_SOURCE_CHECKPOINTZ_URLS" \
    "$SOURCE_ACK_READY_BLOCK"

if [[ "$DEST_STATUS" != "4" && "$DEST_STATUS" != unknown* ]]; then
    echo "Destination tx status mismatch: expected 4 (MINTED_IN_HOLDING), got $DEST_STATUS" >&2
    exit 1
fi

echo "Generating RISC Zero ack proof from source AckReady..."
ACK_EXECUTION_BLOCK_EFFECTIVE="${ACK_EXECUTION_BLOCK:-$SOURCE_ACK_READY_BLOCK}"
ACK_EXECUTION_BLOCK_EFFECTIVE="$(normalize_execution_block_tag "$ACK_EXECUTION_BLOCK_EFFECTIVE")"
echo "Ack proof execution block: $ACK_EXECUTION_BLOCK_EFFECTIVE"
ACK_PROOF_LOG="$(mktemp)"
set +e
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    (
        cd "$ROOT_DIR"
        PROVER_ACTION=prove \
        RISC0_PROVER_MODE="$RISC0_PROVER_MODE" \
        RPC_URL="$SOURCE_RPC" \
        EXECUTION_BLOCK="$ACK_EXECUTION_BLOCK_EFFECTIVE" \
        CONNECTOR="$SOURCE_CONNECTOR" \
        TX_ID="$TX_ID" \
        SOURCE_CHAIN_ID="$SOURCE_CHAIN_ID" \
        bash "$DOCKER_ACK_PROVER_SCRIPT"
    ) 2>&1 | tee "$ACK_PROOF_LOG"
    ACK_PROOF_STATUS=${PIPESTATUS[0]}
else
    (
        cd "$ACK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        RISC0_PROVER="$RISC0_PROVER_MODE" \
        RPC_URL="$SOURCE_RPC" \
        EXECUTION_BLOCK="$ACK_EXECUTION_BLOCK_EFFECTIVE" \
        cargo run -p ack-proof-host --bin ack-proof-host -- \
            --connector "$SOURCE_CONNECTOR" \
            --tx-id "$TX_ID" \
            --source-chain-id "$SOURCE_CHAIN_ID"
    ) 2>&1 | tee "$ACK_PROOF_LOG"
    ACK_PROOF_STATUS=${PIPESTATUS[0]}
fi
set -e
if [[ "$ACK_PROOF_STATUS" -ne 0 ]]; then
    echo "Ack proof generation failed." >&2
    rm -f "$ACK_PROOF_LOG"
    exit "$ACK_PROOF_STATUS"
fi
ACK_PROOF_OUTPUT="$(cat "$ACK_PROOF_LOG")"
rm -f "$ACK_PROOF_LOG"

ACK_PROOF_PAYLOAD="$(extract_proof_value "$ACK_PROOF_OUTPUT" "proofPayload")"
ACK_PROOF_TX_ID="$(extract_proof_value "$ACK_PROOF_OUTPUT" "txId")"
ACK_PROOF_SRC_CONNECTOR="$(extract_proof_value "$ACK_PROOF_OUTPUT" "srcChainConnector")"
ACK_PROOF_DST_CONNECTOR="$(extract_proof_value "$ACK_PROOF_OUTPUT" "dstChainConnector")"

if [[ "$(to_lower "$ACK_PROOF_TX_ID")" != "$(to_lower "$TX_ID")" ]]; then
    echo "Ack proof txId mismatch: expected $TX_ID, got $ACK_PROOF_TX_ID" >&2
    exit 1
fi
if [[ "$(to_lower "$ACK_PROOF_SRC_CONNECTOR")" != "$(to_lower "$SOURCE_CONNECTOR")" ]]; then
    echo "Ack proof src connector mismatch: expected $SOURCE_CONNECTOR, got $ACK_PROOF_SRC_CONNECTOR" >&2
    exit 1
fi
if [[ "$(to_lower "$ACK_PROOF_DST_CONNECTOR")" != "$(to_lower "$DEST_CONNECTOR")" ]]; then
    echo "Ack proof dst connector mismatch: expected $DEST_CONNECTOR, got $ACK_PROOF_DST_CONNECTOR" >&2
    exit 1
fi

echo "Submitting ack proof on destination chain..."
cast send \
    "$DEST_CONNECTOR" \
    "submitAckProof(uint8,bytes,bytes32)" \
    0 \
    "$ACK_PROOF_PAYLOAD" \
    "$TX_ID" \
    --gas-limit "$ACK_PROOF_GAS_LIMIT" \
    --rpc-url "$DEST_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

SOURCE_STATUS="$(cast call "$SOURCE_CONNECTOR" "txStatus(bytes32)(uint8)" "$TX_ID" --rpc-url "$SOURCE_RPC")"
DEST_FINAL_STATUS="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"
if [[ "$SOURCE_STATUS" != "2" ]]; then
    echo "Source tx status mismatch: expected 2 (MINT_PROOF_ACCEPTED), got $SOURCE_STATUS" >&2
    exit 1
fi
if [[ "$DEST_FINAL_STATUS" != "0" ]]; then
    echo "Destination tx status mismatch after ack: expected 0 (NONE), got $DEST_FINAL_STATUS" >&2
    exit 1
fi

SOURCE_BALANCE_AFTER="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
DEST_BALANCE_AFTER="$(query_erc20_balance "$DEST_RPC" "$DEST_TOKEN" "$DEPLOYER_ADDRESS")"
echo "Account token balances after transfer:"
echo "  source chain ($SOURCE_CHAIN_ID): $SOURCE_BALANCE_AFTER"
echo "  destination chain ($DEST_CHAIN_ID): $DEST_BALANCE_AFTER"

echo
echo "Done."
echo "sourceConnector:        $SOURCE_CONNECTOR"
echo "destConnector:          $DEST_CONNECTOR"
echo "sourceToken:            $SOURCE_TOKEN"
echo "destToken:              $DEST_TOKEN"
echo "lockImageId:            $LOCK_IMAGE_ID"
echo "mintImageId:            $MINT_IMAGE_ID"
echo "ackImageId:             $ACK_IMAGE_ID"
echo "lockProofPayload:       $LOCK_PROOF_PAYLOAD"
echo "mintProofPayload:       $MINT_PROOF_PAYLOAD"
echo "ackProofPayload:        $ACK_PROOF_PAYLOAD"
echo "mintProofAmount:        $MINT_PROOF_AMOUNT"
echo "mintProofReceiver:      $MINT_PROOF_RECEIVER"
echo "destination txStatus:   $DEST_STATUS (expected 4 for MINTED_IN_HOLDING)"
echo "destination final:      $DEST_FINAL_STATUS (expected 0 for NONE)"
echo "source txStatus:        $SOURCE_STATUS (expected 2 for MINT_PROOF_ACCEPTED)"
echo "account source balance: $SOURCE_BALANCE_BEFORE -> $SOURCE_BALANCE_AFTER"
echo "account dest balance:   $DEST_BALANCE_BEFORE -> $DEST_BALANCE_AFTER"
echo "reuse source env:       REUSE_SOURCE_DEPLOYMENTS=1 EXISTING_SOURCE_CONNECTOR=$SOURCE_CONNECTOR EXISTING_SOURCE_TOKEN=$SOURCE_TOKEN EXISTING_SOURCE_RISC0_ADAPTER=${SOURCE_RISC0_ADAPTER:-}"
echo "reuse dest env:         REUSE_DEST_DEPLOYMENTS=1 EXISTING_DEST_CONNECTOR=$DEST_CONNECTOR EXISTING_DEST_TOKEN=$DEST_TOKEN EXISTING_DEST_RISC0_ADAPTER=$DEST_RISC0_ADAPTER"
