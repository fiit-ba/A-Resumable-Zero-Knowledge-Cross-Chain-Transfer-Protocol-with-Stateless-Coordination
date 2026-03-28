#!/usr/bin/env bash
# E2E refund flow: Anvil (origin, 31337) → Hardhat (destination, 31338)
#
# Steps:
#  1. Deploy origin contracts (Groth16 verifier, single RISC0 adapter, SnarkJS adapter, Connector, ERC20)
#  2. Deploy destination contracts (same set, including a burnable ERC20)
#  3. Origin: mint tokens, approve, depositAndLock
#  4. Destination: generate lock proof → submitLockProof (connector mints dstToken to holding)
#  5. Warp time past ackDeadline on both chains
#  6. Origin: initiateRefund (emit RefundClaimed)
#  7. Destination: generate refund-claim proof → submitRefundClaimProof
#  8. Destination: executeBurn (emit DestTxClosed, burn dstToken)
#  9. Origin: generate burn proof → submitBurnProof (releases srcToken back to user)
#
# Environment variables (all have defaults):
#   SOURCE_RPC             (default: http://127.0.0.1:8545)
#   DEST_RPC               (default: http://127.0.0.1:8546)
#   SOURCE_CHAIN_ID        (default: 31337)
#   DEST_CHAIN_ID          (default: 31338)
#   PRIVATE_KEY            (required, or set in smart-contracts/.env)
#   AMOUNT_WEI             (default: 1000000000000000000)
#   ACK_WINDOW_SECONDS     (default: 60, short for local refund testing)
#   RISC0_PROVER_MODE      (default: local; set to bonsai for Bonsai prover)
#   RISC0_GUEST_USE_DOCKER (default: 1)
#   USE_DOCKER_PROVER      (default: 0)
#   EXECUTION_BLOCK        (default: latest)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -d "$SCRIPT_DIR/../smart-contracts/src" ]]; then
    ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    SC_DIR="$ROOT_DIR/smart-contracts"
elif [[ -d "$SCRIPT_DIR/../src" ]]; then
    SC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    ROOT_DIR="$(cd "$SC_DIR/.." && pwd)"
else
    echo "Could not locate smart-contracts directory from: $SCRIPT_DIR" >&2
    exit 1
fi

LOCK_RZ_DIR="$ROOT_DIR/zk-proofs/risc_zero/lock_event"
REFUND_CLAIM_RZ_DIR="$ROOT_DIR/zk-proofs/risc_zero/refund_claim_event"
BURN_RZ_DIR="$ROOT_DIR/zk-proofs/risc_zero/burn_event"

for rz_dir in "$LOCK_RZ_DIR" "$REFUND_CLAIM_RZ_DIR" "$BURN_RZ_DIR"; do
    if [[ ! -d "$rz_dir" ]]; then
        echo "Missing RISC Zero workspace: $rz_dir" >&2
        exit 1
    fi
done

# ── Configuration ──────────────────────────────────────────────────────────────
SOURCE_RPC="${SOURCE_RPC:-http://127.0.0.1:8545}"
DEST_RPC="${DEST_RPC:-http://127.0.0.1:8546}"
SOURCE_CHAIN_ID="${SOURCE_CHAIN_ID:-31337}"
DEST_CHAIN_ID="${DEST_CHAIN_ID:-31338}"
PRIVATE_KEY="${PRIVATE_KEY:-}"
AMOUNT_WEI="${AMOUNT_WEI:-1000000000000000000}"
# Short window so we can warp past it easily in local testing.
ACK_WINDOW_SECONDS="${ACK_WINDOW_SECONDS:-60}"
RISC0_PROVER_MODE="${RISC0_PROVER_MODE:-local}"
RISC0_GUEST_USE_DOCKER="${RISC0_GUEST_USE_DOCKER:-1}"
USE_DOCKER_PROVER="${USE_DOCKER_PROVER:-0}"
EXECUTION_BLOCK="${EXECUTION_BLOCK:-latest}"
TOKEN_NAME="${TOKEN_NAME:-Test USD}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-TUSD}"
DEST_TOKEN_NAME="${DEST_TOKEN_NAME:-Wrapped Test USD}"
DEST_TOKEN_SYMBOL="${DEST_TOKEN_SYMBOL:-wTUSD}"
DOCKER_LOCK_PROVER_SCRIPT="${DOCKER_LOCK_PROVER_SCRIPT:-$LOCK_RZ_DIR/scripts/prove-lock-docker.sh}"
DOCKER_REFUND_CLAIM_PROVER_SCRIPT="${DOCKER_REFUND_CLAIM_PROVER_SCRIPT:-$REFUND_CLAIM_RZ_DIR/scripts/prove-refund-claim-docker.sh}"
DOCKER_BURN_PROVER_SCRIPT="${DOCKER_BURN_PROVER_SCRIPT:-$BURN_RZ_DIR/scripts/prove-burn-docker.sh}"
TX_RECEIPT_WAIT_ATTEMPTS="${TX_RECEIPT_WAIT_ATTEMPTS:-120}"
TX_RECEIPT_WAIT_INTERVAL_SEC="${TX_RECEIPT_WAIT_INTERVAL_SEC:-2}"
DEPLOY_RETRY_ATTEMPTS="${DEPLOY_RETRY_ATTEMPTS:-6}"
DEPLOY_RETRY_DELAY_SEC="${DEPLOY_RETRY_DELAY_SEC:-4}"
LOCK_PROOF_GAS_LIMIT="${LOCK_PROOF_GAS_LIMIT:-12000000}"
REFUND_CLAIM_PROOF_GAS_LIMIT="${REFUND_CLAIM_PROOF_GAS_LIMIT:-12000000}"
BURN_PROOF_GAS_LIMIT="${BURN_PROOF_GAS_LIMIT:-12000000}"
EXECUTE_BURN_GAS_LIMIT="${EXECUTE_BURN_GAS_LIMIT:-1000000}"
SET_VERIFIER_GAS_LIMIT="${SET_VERIFIER_GAS_LIMIT:-500000}"
# Port for the eth_getBlockReceipts proxy used during burn proof generation.
# Hardhat does not support eth_getBlockReceipts; the proxy wraps Hardhat and
# implements that method via individual eth_getTransactionReceipt calls.
BURN_PROOF_PROXY_PORT="${BURN_PROOF_PROXY_PORT:-18546}"
PROXY_SCRIPT="$ROOT_DIR/hardhat-local/proxy.mjs"

# ── RISC Zero Groth16 control IDs from risc0-ethereum ControlID.sol ────────────
CONTROL_ROOT="0xa54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56"
BN254_CONTROL_ID="0x04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0"
BYTES32_ZERO="0x0000000000000000000000000000000000000000000000000000000000000000"

# ── Verifier routes (must match Enums.VerifierRoute) ───────────────────────────
ROUTE_ORIGIN_MINT=0
ROUTE_ORIGIN_BURN=1
ROUTE_DEST_LOCK=2
ROUTE_DEST_ACK=3
ROUTE_DEST_REFUND_CLAIM=4

# Proof types
PROOF_TYPE_RISC0=0
PROOF_TYPE_SNARKJS=1

# ── Helpers ────────────────────────────────────────────────────────────────────
require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

trim_string() {
    local value="$1"
    value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
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

deploy_contract() {
    local rpc_url="$1"
    shift
    local output address rc attempt=1

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

        if [[ "$output" == *"nonce too low"* || "$output" == *"replacement transaction underpriced"* ]]; then
            if [[ "$attempt" -lt "$DEPLOY_RETRY_ATTEMPTS" ]]; then
                echo "Deployment nonce sync issue on $rpc_url. Retrying in ${DEPLOY_RETRY_DELAY_SEC}s (${attempt}/${DEPLOY_RETRY_ATTEMPTS})..." >&2
                attempt=$((attempt + 1))
                sleep "$DEPLOY_RETRY_DELAY_SEC"
                continue
            fi
        fi

        echo "forge create failed after ${attempt} attempt(s)." >&2
        exit "$rc"
    done
}

compute_tx_id() {
    local sender="$1" receiver="$2" amount="$3" currency_from="$4" currency_to="$5"
    local src_connector="$6" dst_connector="$7" nonce="$8"
    local encoded
    encoded="$(cast abi-encode \
        "f(address,address,uint256,address,address,address,address,uint256)" \
        "$sender" "$receiver" "$amount" "$currency_from" "$currency_to" \
        "$src_connector" "$dst_connector" "$nonce")"
    cast keccak "$encoded"
}

query_tx_nonce() {
    local rpc_url="$1" connector="$2" nonce
    nonce="$(cast call "$connector" "txNonce()(uint256)" --rpc-url "$rpc_url" 2>/dev/null || true)"
    if [[ -z "$nonce" ]]; then
        echo "Failed to query txNonce() on connector $connector via $rpc_url" >&2
        exit 1
    fi
    printf '%s' "$nonce"
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
    if [[ -f "$errfile" ]]; then tail -n1 "$errfile" >&2 || true; fi
    rm -f "$errfile"

    calldata="$(cast calldata "balanceOf(address)" "$account")"
    rpc_payload="$(printf '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"]}' "$token" "$calldata")"
    rpc_result="$(curl -sS -H "content-type: application/json" --data "$rpc_payload" "$rpc_url" || true)"
    raw_balance="$(printf '%s' "$rpc_result" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"

    if [[ -z "$raw_balance" ]]; then printf '%s' "unknown"; return 0; fi
    cast --to-dec "$raw_balance"
}

query_erc20_total_supply() {
    local rpc_url="$1"
    local token="$2"
    local errfile supply rc calldata rpc_payload rpc_result raw_supply

    errfile="$(mktemp)"
    set +e
    supply="$(cast call "$token" "totalSupply()(uint256)" --rpc-url "$rpc_url" 2>"$errfile")"
    rc=$?
    set -e
    if [[ "$rc" -eq 0 ]]; then
        rm -f "$errfile"
        printf '%s' "$supply"
        return 0
    fi

    echo "Warning: failed to query ERC20 totalSupply via cast call on $rpc_url; using raw eth_call fallback." >&2
    if [[ -f "$errfile" ]]; then tail -n1 "$errfile" >&2 || true; fi
    rm -f "$errfile"

    calldata="$(cast calldata "totalSupply()")"
    rpc_payload="$(printf '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"]}' "$token" "$calldata")"
    rpc_result="$(curl -sS -H "content-type: application/json" --data "$rpc_payload" "$rpc_url" || true)"
    raw_supply="$(printf '%s' "$rpc_result" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"

    if [[ -z "$raw_supply" ]]; then printf '%s' "unknown"; return 0; fi
    cast --to-dec "$raw_supply"
}

extract_proof_value() {
    local proof_output="$1" key="$2" value
    value="$(printf '%s\n' "$proof_output" | awk -F': ' -v k="$key" '$1 == k {print $2}' | tail -n1)"
    if [[ -z "$value" ]]; then
        echo "Failed to extract '$key' from proof output." >&2
        exit 1
    fi
    printf '%s' "$value"
}

to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Returns the latest block timestamp as a decimal integer via raw JSON-RPC.
# Works reliably with both Anvil and Hardhat.
get_chain_timestamp() {
    local rpc_url="$1"
    local result ts
    result="$(curl -sS -H "content-type: application/json" \
        --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}' \
        "$rpc_url" 2>/dev/null || true)"
    # Timestamp is typically a hex string
    ts="$(printf '%s' "$result" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p' | head -n1)"
    if [[ "$ts" =~ ^0x ]]; then ts="$(cast --to-dec "$ts")"; fi
    printf '%s' "${ts:-0}"
}

warp_time_anvil() {
    local rpc_url="$1" new_timestamp="$2"
    cast rpc --rpc-url "$rpc_url" anvil_setNextBlockTimestamp "$new_timestamp" >/dev/null
    # Mine a block to apply the timestamp.
    cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
    echo "Warped Anvil time to $new_timestamp and mined a block."
}

warp_time_hardhat() {
    local rpc_url="$1" new_timestamp="$2"
    local current_dest_ts
    current_dest_ts="$(get_chain_timestamp "$rpc_url")"
    if [[ -n "$current_dest_ts" && "$current_dest_ts" -ge "$new_timestamp" ]]; then
        # Hardhat already past the target; just mine a block so state is fresh.
        cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
        echo "Hardhat already at timestamp $current_dest_ts (>= $new_timestamp); mined a block without adjusting time."
        return 0
    fi
    cast rpc --rpc-url "$rpc_url" evm_setNextBlockTimestamp "$new_timestamp" >/dev/null
    cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
    echo "Warped Hardhat time to $new_timestamp and mined a block."
}

ensure_risc0_r0vm_available() {
    if command -v r0vm >/dev/null 2>&1; then return 0; fi
    local risc0_home="${RISC0_HOME:-$HOME/.risc0}"
    local candidate
    candidate="$(ls -1d "$risc0_home"/extensions/*-cargo-risczero-*/r0vm 2>/dev/null | sort -V | tail -n1 || true)"
    if [[ -n "$candidate" && -x "$candidate" ]]; then
        export PATH="$(dirname "$candidate"):$PATH"
        echo "Using r0vm from rzup extension path: $candidate"
        return 0
    fi
    echo "Warning: r0vm not found in PATH; image ID computation may be slow." >&2
}

run_proof() {
    local label="$1" rz_dir="$2" package="$3" binary="$4"
    shift 4
    local log_file
    log_file="$(mktemp)"
    echo "Generating RISC Zero $label proof (this may take several minutes)..." >&2

    if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
        # Docker prover scripts set their own env vars.
        (
            cd "$ROOT_DIR"
            RISC0_PROVER_MODE="$RISC0_PROVER_MODE" \
            PROVER_ACTION=prove \
            "$@"
        ) 2>&1 | tee "$log_file"
    else
        (
            cd "$rz_dir"
            RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
            RISC0_PROVER="$RISC0_PROVER_MODE" \
            cargo run -p "$package" --bin "$binary" -- "$@"
        ) 2>&1 | tee "$log_file"
    fi

    local rc=${PIPESTATUS[0]}
    local output
    output="$(cat "$log_file")"
    rm -f "$log_file"

    if [[ "$rc" -ne 0 ]]; then
        echo "$label proof generation failed." >&2
        exit "$rc"
    fi
    printf '%s' "$output"
}

# ── Prerequisite checks ────────────────────────────────────────────────────────
require_cmd cast
require_cmd forge
require_cmd awk
require_cmd tr
require_cmd sed
require_cmd curl

if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    require_cmd docker
else
    require_cmd cargo
    if [[ "$RISC0_GUEST_USE_DOCKER" == "1" ]]; then
        require_cmd docker
    fi
fi

ensure_risc0_r0vm_available
resolve_private_key

# ── Validate chain connectivity ────────────────────────────────────────────────
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
echo "Source:   $SOURCE_RPC (chain $SOURCE_CHAIN_ID)"
echo "Dest:     $DEST_RPC (chain $DEST_CHAIN_ID)"
echo ""

# ── Build contracts ────────────────────────────────────────────────────────────
echo "Building smart contracts..."
(cd "$SC_DIR" && forge build --skip test >/dev/null)

# ── Build RISC Zero guest images and get image IDs ─────────────────────────────
echo "Building RISC Zero guest images and reading image IDs..."

if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    if [[ ! -f "$DOCKER_LOCK_PROVER_SCRIPT" ]]; then
        echo "Lock docker prover script not found: $DOCKER_LOCK_PROVER_SCRIPT" >&2
        exit 1
    fi
    if [[ ! -f "$DOCKER_REFUND_CLAIM_PROVER_SCRIPT" ]]; then
        echo "Refund-claim docker prover script not found: $DOCKER_REFUND_CLAIM_PROVER_SCRIPT" >&2
        exit 1
    fi
    if [[ ! -f "$DOCKER_BURN_PROVER_SCRIPT" ]]; then
        echo "Burn docker prover script not found: $DOCKER_BURN_PROVER_SCRIPT" >&2
        exit 1
    fi
    LOCK_IMAGE_ID="$(
        cd "$ROOT_DIR"
        PROVER_ACTION=print-image-id \
        bash "$DOCKER_LOCK_PROVER_SCRIPT"
    )"
    REFUND_CLAIM_IMAGE_ID="$(
        cd "$ROOT_DIR"
        PROVER_ACTION=print-image-id \
        bash "$DOCKER_REFUND_CLAIM_PROVER_SCRIPT"
    )"
    BURN_IMAGE_ID="$(
        cd "$ROOT_DIR"
        PROVER_ACTION=print-image-id \
        bash "$DOCKER_BURN_PROVER_SCRIPT"
    )"
else
    (
        cd "$LOCK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo build -p lock-proof-host --bin print_image_id >/dev/null
    )
    (
        cd "$REFUND_CLAIM_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo build -p refund-claim-proof-host --bin print_image_id >/dev/null
    )
    (
        cd "$BURN_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo build -p burn-proof-host --bin print_image_id >/dev/null
    )
    LOCK_IMAGE_ID="$(
        cd "$LOCK_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo run -q -p lock-proof-host --bin print_image_id
    )"
    REFUND_CLAIM_IMAGE_ID="$(
        cd "$REFUND_CLAIM_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo run -q -p refund-claim-proof-host --bin print_image_id
    )"
    BURN_IMAGE_ID="$(
        cd "$BURN_RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo run -q -p burn-proof-host --bin print_image_id
    )"
fi

echo "Lock image ID:         $LOCK_IMAGE_ID"
echo "RefundClaim image ID:  $REFUND_CLAIM_IMAGE_ID"
echo "Burn image ID:         $BURN_IMAGE_ID"
echo ""

# ── Deploy destination contracts ───────────────────────────────────────────────
echo "=== Step 1: Deploy destination (chain $DEST_CHAIN_ID) contracts ==="

DEST_RISC0_VERIFIER="$(
    deploy_contract "$DEST_RPC" \
        "lib/risc0-ethereum/contracts/src/groth16/RiscZeroGroth16Verifier.sol:RiscZeroGroth16Verifier" \
        --constructor-args "$CONTROL_ROOT" "$BN254_CONTROL_ID"
)"
echo "DEST_RISC0_VERIFIER:      $DEST_RISC0_VERIFIER"

# Single RISC0 adapter for destination — allowlist covers DEST_LOCK (route=2) and DEST_REFUND_CLAIM (route=4).
DEST_RISC0_ADAPTER="$(
    deploy_contract "$DEST_RPC" \
        "src/zk-proof/adapters/RiscZeroAdapter.sol:RiscZeroAdapter" \
        --constructor-args "$DEST_RISC0_VERIFIER" "[$LOCK_IMAGE_ID,$REFUND_CLAIM_IMAGE_ID]"
)"
echo "DEST_RISC0_ADAPTER:       $DEST_RISC0_ADAPTER"

DEST_MOCK_SNARK_VERIFIER="$(
    deploy_contract "$DEST_RPC" "script/Connector.s.sol:MockSnarkVerifier"
)"
DEST_SNARK_ADAPTER="$(
    deploy_contract "$DEST_RPC" \
        "src/zk-proof/adapters/SnarkAdapter.sol:SnarkAdapter" \
        --constructor-args "$DEST_MOCK_SNARK_VERIFIER"
)"
echo "DEST_SNARK_ADAPTER:       $DEST_SNARK_ADAPTER"

# Route image IDs for destination: DEST_LOCK(2)=LOCK_IMAGE_ID, DEST_REFUND_CLAIM(4)=REFUND_CLAIM_IMAGE_ID.
DEST_CONNECTOR="$(
    deploy_contract "$DEST_RPC" \
        "src/connectors/Connector.sol:Connector" \
        --constructor-args "$DEST_RISC0_ADAPTER" "$DEST_SNARK_ADAPTER" "$ACK_WINDOW_SECONDS" "[$BYTES32_ZERO,$BYTES32_ZERO,$LOCK_IMAGE_ID,$BYTES32_ZERO,$REFUND_CLAIM_IMAGE_ID]"
)"
echo "DEST_CONNECTOR:           $DEST_CONNECTOR"

# Deploy burnable MockERC20 on destination (the connector will call burn() on it).
DEST_TOKEN="$(
    deploy_contract "$DEST_RPC" \
        "script/MockERC20.s.sol:MockERC20" \
        --constructor-args "$DEST_TOKEN_NAME" "$DEST_TOKEN_SYMBOL"
)"
echo "DEST_TOKEN:               $DEST_TOKEN"
echo ""

# ── Deploy origin contracts ────────────────────────────────────────────────────
echo "=== Step 2: Deploy origin (chain $SOURCE_CHAIN_ID) contracts ==="

SOURCE_RISC0_VERIFIER="$(
    deploy_contract "$SOURCE_RPC" \
        "lib/risc0-ethereum/contracts/src/groth16/RiscZeroGroth16Verifier.sol:RiscZeroGroth16Verifier" \
        --constructor-args "$CONTROL_ROOT" "$BN254_CONTROL_ID"
)"
echo "SOURCE_RISC0_VERIFIER:    $SOURCE_RISC0_VERIFIER"

# Single RISC0 adapter for origin — allowlist covers ORIGIN_BURN (route=1).
SOURCE_RISC0_ADAPTER="$(
    deploy_contract "$SOURCE_RPC" \
        "src/zk-proof/adapters/RiscZeroAdapter.sol:RiscZeroAdapter" \
        --constructor-args "$SOURCE_RISC0_VERIFIER" "[$BURN_IMAGE_ID]"
)"
echo "SOURCE_RISC0_ADAPTER:     $SOURCE_RISC0_ADAPTER"

SOURCE_MOCK_SNARK_VERIFIER="$(
    deploy_contract "$SOURCE_RPC" "script/Connector.s.sol:MockSnarkVerifier"
)"
SOURCE_SNARK_ADAPTER="$(
    deploy_contract "$SOURCE_RPC" \
        "src/zk-proof/adapters/SnarkAdapter.sol:SnarkAdapter" \
        --constructor-args "$SOURCE_MOCK_SNARK_VERIFIER"
)"
echo "SOURCE_SNARK_ADAPTER:     $SOURCE_SNARK_ADAPTER"

# Route image IDs for origin: ORIGIN_BURN(1)=BURN_IMAGE_ID.
SOURCE_CONNECTOR="$(
    deploy_contract "$SOURCE_RPC" \
        "src/connectors/Connector.sol:Connector" \
        --constructor-args "$SOURCE_RISC0_ADAPTER" "$SOURCE_SNARK_ADAPTER" "$ACK_WINDOW_SECONDS" "[$BYTES32_ZERO,$BURN_IMAGE_ID,$BYTES32_ZERO,$BYTES32_ZERO,$BYTES32_ZERO]"
)"
echo "SOURCE_CONNECTOR:         $SOURCE_CONNECTOR"

SOURCE_TOKEN="$(
    deploy_contract "$SOURCE_RPC" \
        "script/MockERC20.s.sol:MockERC20" \
        --constructor-args "$TOKEN_NAME" "$TOKEN_SYMBOL"
)"
echo "SOURCE_TOKEN:             $SOURCE_TOKEN"
echo ""

# ── Step 3: Mint, approve, depositAndLock ──────────────────────────────────────
echo "=== Step 3: Origin depositAndLock ==="

cast send "$SOURCE_TOKEN" "mint(address,uint256)" \
    "$DEPLOYER_ADDRESS" "$AMOUNT_WEI" \
    --rpc-url "$SOURCE_RPC" --private-key "$PRIVATE_KEY" >/dev/null

SOURCE_BALANCE_BEFORE="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
echo "Source token balance before: $SOURCE_BALANCE_BEFORE"

cast send "$SOURCE_TOKEN" "approve(address,uint256)" \
    "$SOURCE_CONNECTOR" "$AMOUNT_WEI" \
    --rpc-url "$SOURCE_RPC" --private-key "$PRIVATE_KEY" >/dev/null

SOURCE_TX_NONCE="$(query_tx_nonce "$SOURCE_RPC" "$SOURCE_CONNECTOR")"
echo "Source connector txNonce before deposit: $SOURCE_TX_NONCE"

DEPOSIT_TX_HASH="$(
    send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" \
        "depositAndLock(address,address,address,uint256,address)" \
        "$SOURCE_TOKEN" "$DEST_TOKEN" "$DEPLOYER_ADDRESS" "$AMOUNT_WEI" "$DEST_CONNECTOR"
)"
SOURCE_DEPOSIT_BLOCK="$(wait_for_tx_receipt_block "$SOURCE_RPC" "$DEPOSIT_TX_HASH")"
echo "depositAndLock tx: $DEPOSIT_TX_HASH (block $SOURCE_DEPOSIT_BLOCK)"

TX_ID="$(
    compute_tx_id \
        "$DEPLOYER_ADDRESS" "$DEPLOYER_ADDRESS" "$AMOUNT_WEI" \
        "$SOURCE_TOKEN" "$DEST_TOKEN" \
        "$SOURCE_CONNECTOR" "$DEST_CONNECTOR" \
        "$SOURCE_TX_NONCE"
)"
echo "txId: $TX_ID"

SOURCE_STATUS="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
echo "Source tx status after depositAndLock: $SOURCE_STATUS (expected 1 for DEPOSIT_LOCKED)"
if [[ "$SOURCE_STATUS" != "1" ]]; then
    echo "Unexpected source tx status: $SOURCE_STATUS" >&2
    exit 1
fi
echo ""

# ── Step 4: Generate lock proof and submitLockProof on destination ─────────────
echo "=== Step 4: Destination submitLockProof ==="

LOCK_PROOF_LOG="$(mktemp)"
set +e
(
    cd "$LOCK_RZ_DIR"
    RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
    RISC0_PROVER="$RISC0_PROVER_MODE" \
    RPC_URL="$SOURCE_RPC" \
    EXECUTION_BLOCK="$EXECUTION_BLOCK" \
    cargo run -p lock-proof-host --bin lock-proof-host -- \
        --connector "$SOURCE_CONNECTOR" \
        --tx-id "$TX_ID" \
        --source-chain-id "$SOURCE_CHAIN_ID" \
        --destination-chain-id "$DEST_CHAIN_ID"
) 2>&1 | tee "$LOCK_PROOF_LOG"
LOCK_PROOF_RC=${PIPESTATUS[0]}
set -e

LOCK_PROOF_OUTPUT="$(cat "$LOCK_PROOF_LOG")"
rm -f "$LOCK_PROOF_LOG"

if [[ "$LOCK_PROOF_RC" -ne 0 ]]; then
    echo "Lock proof generation failed." >&2
    exit "$LOCK_PROOF_RC"
fi

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
echo "Lock proof payload extracted."

LOCK_SUBMIT_TX="$(
    send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" \
        "submitLockProof(uint8,bytes,bytes32,uint256,address,address,address,address,address,uint64,uint256,uint256)" \
        "$PROOF_TYPE_RISC0" \
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
LOCK_SUBMIT_BLOCK="$(wait_for_tx_receipt_block "$DEST_RPC" "$LOCK_SUBMIT_TX")"
echo "submitLockProof tx: $LOCK_SUBMIT_TX (block $LOCK_SUBMIT_BLOCK)"

DEST_STATUS="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"
echo "Dest tx status after submitLockProof: $DEST_STATUS (expected 4 for MINTED_IN_HOLDING)"
if [[ "$DEST_STATUS" != "4" ]]; then
    echo "Unexpected dest tx status: $DEST_STATUS" >&2
    exit 1
fi

DEST_SUPPLY_BEFORE="$(query_erc20_total_supply "$DEST_RPC" "$DEST_TOKEN")"
echo "Dest token total supply before burn: $DEST_SUPPLY_BEFORE"
echo ""

# ── Step 5: Warp time past ackDeadline on both chains ─────────────────────────
echo "=== Step 5: Warp time past ackDeadline ==="

SOURCE_CURRENT_TS="$(get_chain_timestamp "$SOURCE_RPC")"
DEST_CURRENT_TS="$(get_chain_timestamp "$DEST_RPC")"

# NEW_TIMESTAMP must be past: both chains' current timestamps AND the ack deadline.
MAX_CURRENT_TS="$(( SOURCE_CURRENT_TS > DEST_CURRENT_TS ? SOURCE_CURRENT_TS : DEST_CURRENT_TS ))"
ACK_DEADLINE_TS="${LOCK_PROOF_ORIGIN_ACK_DEADLINE:-0}"
BASE_TS="$(( MAX_CURRENT_TS > ACK_DEADLINE_TS ? MAX_CURRENT_TS : ACK_DEADLINE_TS ))"
NEW_TIMESTAMP=$(( BASE_TS + 10 ))

echo "Source current timestamp: $SOURCE_CURRENT_TS"
echo "Dest current timestamp:   $DEST_CURRENT_TS"
echo "AckDeadline:              $ACK_DEADLINE_TS"
echo "New timestamp (past ackDeadline): $NEW_TIMESTAMP"

warp_time_anvil "$SOURCE_RPC" "$NEW_TIMESTAMP"
warp_time_hardhat "$DEST_RPC" "$NEW_TIMESTAMP"
echo ""

# ── Step 6: Origin initiateRefund ─────────────────────────────────────────────
echo "=== Step 6: Origin initiateRefund ==="

INITIATE_REFUND_TX="$(
    send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" \
        "initiateRefund(bytes32)" \
        "$TX_ID"
)"
INITIATE_REFUND_BLOCK="$(wait_for_tx_receipt_block "$SOURCE_RPC" "$INITIATE_REFUND_TX")"
echo "initiateRefund tx: $INITIATE_REFUND_TX (block $INITIATE_REFUND_BLOCK)"

SOURCE_STATUS="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
echo "Source tx status after initiateRefund: $SOURCE_STATUS (expected 3 for REFUND_INITIATED)"
if [[ "$SOURCE_STATUS" != "3" ]]; then
    echo "Unexpected source tx status: $SOURCE_STATUS" >&2
    exit 1
fi
echo ""

# ── Step 7: Destination submitRefundClaimProof ─────────────────────────────────
echo "=== Step 7: Destination submitRefundClaimProof ==="

REFUND_CLAIM_PROOF_LOG="$(mktemp)"
set +e
(
    cd "$REFUND_CLAIM_RZ_DIR"
    RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
    RISC0_PROVER="$RISC0_PROVER_MODE" \
    RPC_URL="$SOURCE_RPC" \
    EXECUTION_BLOCK="$EXECUTION_BLOCK" \
    cargo run -p refund-claim-proof-host --bin refund-claim-proof-host -- \
        --connector "$SOURCE_CONNECTOR" \
        --tx-id "$TX_ID" \
        --source-chain-id "$SOURCE_CHAIN_ID"
) 2>&1 | tee "$REFUND_CLAIM_PROOF_LOG"
REFUND_CLAIM_PROOF_RC=${PIPESTATUS[0]}
set -e

REFUND_CLAIM_PROOF_OUTPUT="$(cat "$REFUND_CLAIM_PROOF_LOG")"
rm -f "$REFUND_CLAIM_PROOF_LOG"

if [[ "$REFUND_CLAIM_PROOF_RC" -ne 0 ]]; then
    echo "Refund claim proof generation failed." >&2
    exit "$REFUND_CLAIM_PROOF_RC"
fi

REFUND_CLAIM_PROOF_PAYLOAD="$(extract_proof_value "$REFUND_CLAIM_PROOF_OUTPUT" "proofPayload")"
echo "Refund claim proof payload extracted."

REFUND_CLAIM_SUBMIT_TX="$(
    send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" \
        "submitRefundClaimProof(uint8,bytes,bytes32)" \
        "$PROOF_TYPE_RISC0" \
        "$REFUND_CLAIM_PROOF_PAYLOAD" \
        "$TX_ID" \
        --gas-limit "$REFUND_CLAIM_PROOF_GAS_LIMIT"
)"
REFUND_CLAIM_SUBMIT_BLOCK="$(wait_for_tx_receipt_block "$DEST_RPC" "$REFUND_CLAIM_SUBMIT_TX")"
echo "submitRefundClaimProof tx: $REFUND_CLAIM_SUBMIT_TX (block $REFUND_CLAIM_SUBMIT_BLOCK)"

DEST_STATUS="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"
echo "Dest tx status after submitRefundClaimProof: $DEST_STATUS (expected 5 for REFUND_CLAIM_ACCEPTED)"
if [[ "$DEST_STATUS" != "5" ]]; then
    echo "Unexpected dest tx status: $DEST_STATUS" >&2
    exit 1
fi
echo ""

# ── Step 8: Destination executeBurn ───────────────────────────────────────────
echo "=== Step 8: Destination executeBurn ==="

EXECUTE_BURN_TX="$(
    send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" \
        "executeBurn(bytes32)" \
        "$TX_ID" \
        --gas-limit "$EXECUTE_BURN_GAS_LIMIT"
)"
EXECUTE_BURN_BLOCK="$(wait_for_tx_receipt_block "$DEST_RPC" "$EXECUTE_BURN_TX")"
echo "executeBurn tx: $EXECUTE_BURN_TX (block $EXECUTE_BURN_BLOCK)"

DEST_STATUS_AFTER_BURN="$(query_tx_status "$DEST_RPC" "$DEST_CONNECTOR" "$TX_ID")"
echo "Dest tx status after executeBurn: $DEST_STATUS_AFTER_BURN (expected 0 for NONE, tx cleaned up)"

DEST_SUPPLY_AFTER="$(query_erc20_total_supply "$DEST_RPC" "$DEST_TOKEN")"
echo "Dest token total supply after burn: $DEST_SUPPLY_AFTER (was $DEST_SUPPLY_BEFORE)"
echo ""

# ── Step 9: Origin submitBurnProof ─────────────────────────────────────────────
echo "=== Step 9: Origin submitBurnProof ==="

# Hardhat does not support eth_getBlockReceipts, which risc0-steel requires to
# build the receipt trie for event proofs.  Start a lightweight proxy that
# implements eth_getBlockReceipts by combining eth_getBlockByHash +
# per-tx eth_getTransactionReceipt calls.
DEST_RPC_PORT="$(printf '%s' "$DEST_RPC" | sed 's|.*:\([0-9]*\)$|\1|')"
BURN_PROOF_RPC="http://127.0.0.1:$BURN_PROOF_PROXY_PORT"
BURN_PROOF_PROXY_PID=""

if [[ -f "$PROXY_SCRIPT" ]] && command -v node >/dev/null 2>&1; then
    # IMPORTANT: Do NOT use `node ... | sed ... &` here.
    # In a pipeline the shell assigns $! to the *last* command (sed), not node,
    # so BURN_PROOF_PROXY_PID would track sed and the real node process would be
    # orphaned — preventing the script from returning cleanly after Step 9.
    BURN_PROOF_PROXY_LOG="$(mktemp)"
    BURN_PROOF_PROXY_DEBUG="${BURN_PROOF_PROXY_DEBUG:-0}"

    cleanup_burn_proxy() {
        if [[ -n "$BURN_PROOF_PROXY_PID" ]]; then
            kill "$BURN_PROOF_PROXY_PID" 2>/dev/null || true
            wait "$BURN_PROOF_PROXY_PID" 2>/dev/null || true
            BURN_PROOF_PROXY_PID=""
        fi
        rm -f "$BURN_PROOF_PROXY_LOG"
    }

    if [[ "$BURN_PROOF_PROXY_DEBUG" == "1" ]]; then
        HARDHAT_INNER_PORT="$DEST_RPC_PORT" PROXY_PORT="$BURN_PROOF_PROXY_PORT" \
            node "$PROXY_SCRIPT" &
    else
        HARDHAT_INNER_PORT="$DEST_RPC_PORT" PROXY_PORT="$BURN_PROOF_PROXY_PORT" \
            node "$PROXY_SCRIPT" >"$BURN_PROOF_PROXY_LOG" 2>&1 &
    fi
    BURN_PROOF_PROXY_PID=$!

    # Register cleanup so any exit after this point cannot orphan the proxy.
    trap 'cleanup_burn_proxy' EXIT

    # Wait until the proxy is accepting connections (up to 10 s).
    _proxy_ready=0
    for _pi in $(seq 1 50); do
        if ! kill -0 "$BURN_PROOF_PROXY_PID" 2>/dev/null; then
            echo "ERROR: eth_getBlockReceipts proxy exited unexpectedly during startup." >&2
            if [[ "$BURN_PROOF_PROXY_DEBUG" != "1" ]]; then
                echo "--- proxy log ---" >&2
                cat "$BURN_PROOF_PROXY_LOG" >&2
            fi
            cleanup_burn_proxy
            exit 1
        fi
        if curl -s --max-time 0.5 "$BURN_PROOF_RPC" >/dev/null 2>&1; then
            _proxy_ready=1
            break
        fi
        sleep 0.2
    done

    if [[ "$_proxy_ready" -eq 0 ]]; then
        echo "ERROR: eth_getBlockReceipts proxy did not become ready within 10 s." >&2
        if [[ "$BURN_PROOF_PROXY_DEBUG" != "1" ]]; then
            echo "--- proxy log ---" >&2
            cat "$BURN_PROOF_PROXY_LOG" >&2
        fi
        cleanup_burn_proxy
        exit 1
    fi

    # JSON-RPC health probe: verify eth_getBlockReceipts returns a result field.
    _probe_resp="$(curl -s --max-time 5 -X POST "$BURN_PROOF_RPC" \
        -H 'content-type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["latest"]}')"
    if ! printf '%s' "$_probe_resp" | grep -q '"result"'; then
        echo "ERROR: eth_getBlockReceipts proxy health probe failed." >&2
        echo "Probe response: $_probe_resp" >&2
        if [[ "$BURN_PROOF_PROXY_DEBUG" != "1" ]]; then
            echo "--- proxy log ---" >&2
            cat "$BURN_PROOF_PROXY_LOG" >&2
        fi
        cleanup_burn_proxy
        exit 1
    fi

    echo "eth_getBlockReceipts proxy started on port $BURN_PROOF_PROXY_PORT (PID $BURN_PROOF_PROXY_PID)."
else
    echo "Warning: proxy.mjs not found or node not available; falling back to DEST_RPC directly." >&2
    BURN_PROOF_RPC="$DEST_RPC"
fi

# Pin burn proof to the exact block where executeBurn was mined.
# BlockNumberOrTag requires a 0x-prefixed hex string, not a decimal.
BURN_EXECUTION_BLOCK="${BURN_EXECUTION_BLOCK:-$(printf '0x%x' "$EXECUTE_BURN_BLOCK")}"

BURN_PROOF_LOG="$(mktemp)"
set +e
(
    cd "$BURN_RZ_DIR"
    RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
    RISC0_PROVER="$RISC0_PROVER_MODE" \
    RPC_URL="$BURN_PROOF_RPC" \
    EXECUTION_BLOCK="$BURN_EXECUTION_BLOCK" \
    cargo run -p burn-proof-host --bin burn-proof-host -- \
        --connector "$DEST_CONNECTOR" \
        --tx-id "$TX_ID" \
        --dest-chain-id "$DEST_CHAIN_ID"
) 2>&1 | tee "$BURN_PROOF_LOG"
BURN_PROOF_RC=${PIPESTATUS[0]}
set -e

# Shut down the proxy (idempotent; also called by the EXIT trap).
if declare -f cleanup_burn_proxy >/dev/null 2>&1; then
    cleanup_burn_proxy
fi

BURN_PROOF_OUTPUT="$(cat "$BURN_PROOF_LOG")"
rm -f "$BURN_PROOF_LOG"

if [[ "$BURN_PROOF_RC" -ne 0 ]]; then
    echo "Burn proof generation failed." >&2
    exit "$BURN_PROOF_RC"
fi

BURN_PROOF_PAYLOAD="$(extract_proof_value "$BURN_PROOF_OUTPUT" "proofPayload")"
echo "Burn proof payload extracted."

BURN_SUBMIT_TX="$(
    send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" \
        "submitBurnProof(uint8,bytes,bytes32)" \
        "$PROOF_TYPE_RISC0" \
        "$BURN_PROOF_PAYLOAD" \
        "$TX_ID" \
        --gas-limit "$BURN_PROOF_GAS_LIMIT"
)"
BURN_SUBMIT_BLOCK="$(wait_for_tx_receipt_block "$SOURCE_RPC" "$BURN_SUBMIT_TX")"
echo "submitBurnProof tx: $BURN_SUBMIT_TX (block $BURN_SUBMIT_BLOCK)"

SOURCE_STATUS_FINAL="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
echo "Source tx status after submitBurnProof: $SOURCE_STATUS_FINAL (expected 0 for NONE, refund complete)"

SOURCE_BALANCE_AFTER="$(query_erc20_balance "$SOURCE_RPC" "$SOURCE_TOKEN" "$DEPLOYER_ADDRESS")"
echo ""

# ── Summary ────────────────────────────────────────────────────────────────────
echo "============================================================"
echo "Refund E2E complete!"
echo "txId:                     $TX_ID"
echo "sourceConnector:          $SOURCE_CONNECTOR"
echo "destConnector:            $DEST_CONNECTOR"
echo "sourceToken:              $SOURCE_TOKEN"
echo "destToken:                $DEST_TOKEN"
echo ""
echo "  1. depositAndLock:        $DEPOSIT_TX_HASH (block $SOURCE_DEPOSIT_BLOCK)"
echo "  2. submitLockProof:       $LOCK_SUBMIT_TX (block $LOCK_SUBMIT_BLOCK)"
echo "  3. initiateRefund:        $INITIATE_REFUND_TX (block $INITIATE_REFUND_BLOCK)"
echo "  4. submitRefundClaimProof:$REFUND_CLAIM_SUBMIT_TX (block $REFUND_CLAIM_SUBMIT_BLOCK)"
echo "  5. executeBurn:           $EXECUTE_BURN_TX (block $EXECUTE_BURN_BLOCK)"
echo "  6. submitBurnProof:       $BURN_SUBMIT_TX (block $BURN_SUBMIT_BLOCK)"
echo ""
echo "Source token balance:"
echo "  Before: $SOURCE_BALANCE_BEFORE"
echo "  After:  $SOURCE_BALANCE_AFTER  (should equal before: full refund)"
echo ""
echo "Dest token total supply:"
echo "  Before burn: $DEST_SUPPLY_BEFORE"
echo "  After burn:  $DEST_SUPPLY_AFTER  (should be 0: tokens burned)"
echo ""
echo "Source tx final status: $SOURCE_STATUS_FINAL (0 = NONE)"
echo "Dest tx final status:   $DEST_STATUS_AFTER_BURN (0 = NONE)"
echo "============================================================"
