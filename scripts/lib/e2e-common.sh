#!/usr/bin/env bash
# scripts/lib/e2e-common.sh
#
# Shared library sourced by e2e-happy-path.sh and e2e-refund-path.sh.
# Do NOT execute this file directly.
#
# After sourcing, call:
#   e2e_parse_args "$@"           -- parse flags (sets SOURCE_NETWORK_PROFILE etc.)
#   e2e_apply_profile_defaults    -- fill RPC/chain from profile
#   e2e_validate_prerequisites    -- check commands, key, chain connectivity
#
# All shared environment variables are documented with their defaults below.
# ---------------------------------------------------------------------------

# ── Root resolution ─────────────────────────────────────────────────────────
_e2e_resolve_root() {
    local script_dir="$1"
    if [[ -d "$script_dir/../smart-contracts/src" && -d "$script_dir/../zk-proofs/risc_zero/lock_event" ]]; then
        echo "$(cd "$script_dir/.." && pwd)"
    elif [[ -d "$script_dir/../../smart-contracts/src" && -d "$script_dir/../../zk-proofs/risc_zero/lock_event" ]]; then
        echo "$(cd "$script_dir/../.." && pwd)"
    else
        echo "Could not infer project root from: $script_dir" >&2
        echo "Expected repo/scripts or repo/scripts/lib as script location." >&2
        return 1
    fi
}

# Callers set SCRIPT_DIR before sourcing; we resolve ROOT_DIR and SC_DIR here.
ROOT_DIR="${ROOT_DIR:-$(_e2e_resolve_root "${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}")}"
SC_DIR="$ROOT_DIR/smart-contracts"

# ── Default configuration ───────────────────────────────────────────────────
SOURCE_NETWORK_PROFILE="${SOURCE_NETWORK_PROFILE:-local-anvil}"
DEST_NETWORK_PROFILE="${DEST_NETWORK_PROFILE:-local-hardhat}"
SOURCE_RPC="${SOURCE_RPC:-}"
DEST_RPC="${DEST_RPC:-}"
SOURCE_CHAIN_ID="${SOURCE_CHAIN_ID:-}"
DEST_CHAIN_ID="${DEST_CHAIN_ID:-}"

PRIVATE_KEY="${PRIVATE_KEY:-}"
ACK_WINDOW_SECONDS="${ACK_WINDOW_SECONDS:-3600}"
AMOUNT_WEI="${AMOUNT_WEI:-1000000000000000000}"
TOKEN_NAME="${TOKEN_NAME:-Test USD}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-TUSD}"
DEST_TOKEN_NAME="${DEST_TOKEN_NAME:-Wrapped Test USD}"
DEST_TOKEN_SYMBOL="${DEST_TOKEN_SYMBOL:-wTUSD}"

LOCK_EXECUTION_BLOCK="${LOCK_EXECUTION_BLOCK:-}"
MINT_EXECUTION_BLOCK="${MINT_EXECUTION_BLOCK:-}"
ACK_EXECUTION_BLOCK="${ACK_EXECUTION_BLOCK:-}"
REFUND_CLAIM_EXECUTION_BLOCK="${REFUND_CLAIM_EXECUTION_BLOCK:-}"
BURN_PROOF_EXECUTION_BLOCK="${BURN_PROOF_EXECUTION_BLOCK:-}"

LOCK_PROOF_GAS_LIMIT="${LOCK_PROOF_GAS_LIMIT:-12000000}"
MINT_PROOF_GAS_LIMIT="${MINT_PROOF_GAS_LIMIT:-12000000}"
ACK_PROOF_GAS_LIMIT="${ACK_PROOF_GAS_LIMIT:-12000000}"
REFUND_CLAIM_PROOF_GAS_LIMIT="${REFUND_CLAIM_PROOF_GAS_LIMIT:-12000000}"
BURN_PROOF_GAS_LIMIT="${BURN_PROOF_GAS_LIMIT:-12000000}"
EXECUTE_BURN_GAS_LIMIT="${EXECUTE_BURN_GAS_LIMIT:-1000000}"
SET_VERIFIER_GAS_LIMIT="${SET_VERIFIER_GAS_LIMIT:-500000}"

RISC0_PROVER_MODE="${RISC0_PROVER_MODE:-local}"
USE_DOCKER_PROVER="${USE_DOCKER_PROVER:-0}"
RISC0_GUEST_USE_DOCKER="${RISC0_GUEST_USE_DOCKER:-1}"

STATELESS_CLIENT_DIR="${STATELESS_CLIENT_DIR:-$ROOT_DIR/stateless-client}"
STATELESS_CLIENT_AUTO_BUILD="${STATELESS_CLIENT_AUTO_BUILD:-1}"
STATELESS_CLIENT_RELAY_RETRIES="${STATELESS_CLIENT_RELAY_RETRIES:-6}"
STATELESS_CLIENT_RELAY_RETRY_DELAY_SEC="${STATELESS_CLIENT_RELAY_RETRY_DELAY_SEC:-12}"
STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_ATTEMPTS="${STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_ATTEMPTS:-45}"
STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_INTERVAL_SEC="${STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_INTERVAL_SEC:-2}"
STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS="${STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS:-50000}"
STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK="${STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK:-}"

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
COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL="${COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL:-https://rpc-gbc.chiadochain.net}"

# Port for eth_getBlockReceipts proxy used for burn proof on Hardhat destination.
BURN_PROOF_PROXY_PORT="${BURN_PROOF_PROXY_PORT:-18546}"
# Path to the bundled proxy script (resolved below if not overridden).
PROXY_SCRIPT="${PROXY_SCRIPT:-$ROOT_DIR/scripts/lib/hardhat-block-receipts-proxy.mjs}"

# RISC Zero Groth16 control IDs from risc0-ethereum ControlID.sol.
CONTROL_ROOT="0xa54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56"
BN254_CONTROL_ID="0x04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0"
BYTES32_ZERO="0x0000000000000000000000000000000000000000000000000000000000000000"

# Verifier routes (must match Enums.VerifierRoute in smart contracts).
ROUTE_ORIGIN_MINT=0
ROUTE_ORIGIN_BURN=1
ROUTE_DEST_LOCK=2
ROUTE_DEST_ACK=3
ROUTE_DEST_REFUND_CLAIM=4

PROOF_TYPE_RISC0=0
PROOF_TYPE_SNARKJS=1

# ── Capability metadata per profile ────────────────────────────────────────
# Returns "anvil", "hardhat", or "none" to select time-warp method.
profile_time_warp_method() {
    local profile="$1"
    case "$profile" in
        local-anvil)   echo "anvil" ;;
        local-hardhat) echo "hardhat" ;;
        *)             echo "none" ;;
    esac
}

# ── Argument parsing ────────────────────────────────────────────────────────
e2e_parse_args() {
    local show_help=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --source-profile|--source-network)
                SOURCE_NETWORK_PROFILE="$2"; shift 2 ;;
            --destination-profile|--destination-network)
                DEST_NETWORK_PROFILE="$2"; shift 2 ;;
            --source-rpc|--source-rpc-url)
                SOURCE_RPC="$2"; shift 2 ;;
            --destination-rpc|--dest-rpc|--destination-rpc-url)
                DEST_RPC="$2"; shift 2 ;;
            --source-chain-id)
                SOURCE_CHAIN_ID="$2"; shift 2 ;;
            --destination-chain-id|--dest-chain-id)
                DEST_CHAIN_ID="$2"; shift 2 ;;
            --private-key)
                PRIVATE_KEY="$2"; shift 2 ;;
            --amount)
                AMOUNT_WEI="$2"; shift 2 ;;
            --ack-window)
                ACK_WINDOW_SECONDS="$2"; shift 2 ;;
            --proof-backend)
                if [[ "$2" == "docker" ]]; then USE_DOCKER_PROVER=1; fi; shift 2 ;;
            --risc0-prover-mode)
                RISC0_PROVER_MODE="$2"; shift 2 ;;
            --repo-root)
                ROOT_DIR="$2"; SC_DIR="$ROOT_DIR/smart-contracts"; shift 2 ;;
            --reuse-source)
                REUSE_SOURCE_DEPLOYMENTS=1; shift ;;
            --reuse-dest)
                REUSE_DEST_DEPLOYMENTS=1; shift ;;
            --source-connector)
                EXISTING_SOURCE_CONNECTOR="$2"; REUSE_SOURCE_DEPLOYMENTS=1; shift 2 ;;
            --destination-connector)
                EXISTING_DEST_CONNECTOR="$2"; REUSE_DEST_DEPLOYMENTS=1; shift 2 ;;
            -h|--help)
                show_help=1; shift ;;
            *)
                echo "Unknown option: $1" >&2
                show_help=1; shift ;;
        esac
    done
    if [[ "$show_help" == "1" ]]; then
        echo "${E2E_USAGE:-Usage: $0 [--source-profile <profile>] [--destination-profile <profile>] [--private-key <hex>] [--help]}"
        exit 0
    fi
}

# ── Profile default resolution ──────────────────────────────────────────────
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
    local chain_var rpc_var colibri_prover_var colibri_beacon_var colibri_checkpointz_var
    local default_chain="" default_rpc="" default_prover="" default_beacon="" default_checkpointz=""

    if [[ "$side" == "source" ]]; then
        chain_var="SOURCE_CHAIN_ID"; rpc_var="SOURCE_RPC"
        colibri_prover_var="COLIBRI_SOURCE_PROVER_URLS"
        colibri_beacon_var="COLIBRI_SOURCE_BEACON_URLS"
        colibri_checkpointz_var="COLIBRI_SOURCE_CHECKPOINTZ_URLS"
    else
        chain_var="DEST_CHAIN_ID"; rpc_var="DEST_RPC"
        colibri_prover_var="COLIBRI_DEST_PROVER_URLS"
        colibri_beacon_var="COLIBRI_DEST_BEACON_URLS"
        colibri_checkpointz_var="COLIBRI_DEST_CHECKPOINTZ_URLS"
    fi

    case "$profile" in
        local-anvil)
            default_chain="31337"; default_rpc="http://127.0.0.1:8545" ;;
        local-hardhat)
            default_chain="31338"; default_rpc="http://127.0.0.1:8546" ;;
        mainnet)
            default_chain="1"
            default_rpc="https://mainnet1.colibri-proof.tech/execution"
            default_prover="https://mainnet1.colibri-proof.tech"
            default_beacon="https://mainnet1.colibri-proof.tech/consensus/" ;;
        sepolia)
            default_chain="11155111"
            default_rpc="https://ethereum-sepolia-rpc.publicnode.com"
            default_prover="https://sepolia.colibri-proof.tech"
            default_beacon="https://ethereum-sepolia-beacon-api.publicnode.com"
            default_checkpointz="https://ethereum-sepolia-beacon-api.publicnode.com" ;;
        holesky)
            default_chain="17000"
            default_rpc="https://ethereum-holesky-rpc.publicnode.com"
            default_beacon="https://ethereum-holesky-beacon-api.publicnode.com" ;;
        hoodi)
            default_chain="560048"
            default_rpc="https://ethereum-hoodi-rpc.publicnode.com"
            default_beacon="https://ethereum-hoodi-beacon-api.publicnode.com" ;;
        gnosis)
            default_chain="100"
            default_rpc="https://rpc.ankr.com/gnosis"
            default_prover="https://gnosis.colibri-proof.tech"
            default_beacon="https://gnosis.colibri-proof.tech" ;;
        chiado)
            default_chain="10200"
            default_rpc="https://gnosis-chiado-rpc.publicnode.com"
            default_prover="https://chiado.colibri-proof.tech"
            default_beacon="${COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL},https://gnosis-chiado-beacon-api.publicnode.com"
            default_checkpointz="${COLIBRI_CHIADO_PARENT_ROOT_BEACON_FALLBACK_URL},https://gnosis-chiado-beacon-api.publicnode.com" ;;
        *)
            echo "Unsupported ${side} network profile: $profile" >&2
            echo "Supported profiles: local-anvil, local-hardhat, mainnet, sepolia, holesky, hoodi, gnosis, chiado" >&2
            exit 1 ;;
    esac

    set_if_empty_var "$chain_var" "$default_chain"
    set_if_empty_var "$rpc_var" "$default_rpc"
    set_if_empty_var "$colibri_prover_var" "$default_prover"
    set_if_empty_var "$colibri_beacon_var" "$default_beacon"
    set_if_empty_var "$colibri_checkpointz_var" "$default_checkpointz"
}

e2e_apply_profile_defaults() {
    # Propagate global overrides to per-side vars before profile defaults.
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

# ── Prerequisite checks ──────────────────────────────────────────────────────
require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2; exit 1
    fi
}

require_env_value() {
    local name="$1" value="$2"
    if [[ -z "$value" ]]; then
        echo "Missing required env var: $name" >&2; exit 1
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
        candidate="$(awk -F= '/^[[:space:]]*(export[[:space:]]+)?PRIVATE_KEY[[:space:]]*=/ {print substr($0, index($0,"=")+1)}' "$env_file" | tail -n1)"
        candidate="${candidate%%#*}"
        candidate="$(trim_string "$candidate")"
        source="$env_file"
    fi

    if [[ -z "$candidate" ]]; then
        echo "Missing PRIVATE_KEY. Set PRIVATE_KEY env var or add PRIVATE_KEY=<hex> to $env_file" >&2; exit 1
    fi
    if [[ "$candidate" =~ ^[0-9a-fA-F]{64}$ ]]; then candidate="0x$candidate"; fi
    if [[ ! "$candidate" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        echo "Invalid PRIVATE_KEY format from $source." >&2; exit 1
    fi
    PRIVATE_KEY="$candidate"
    echo "Using private key from $source"
}

ensure_risc0_r0vm_available() {
    if command -v r0vm >/dev/null 2>&1; then return 0; fi
    local risc0_home="${RISC0_HOME:-$HOME/.risc0}"
    local candidate
    candidate="$(ls -1d "$risc0_home"/extensions/*-cargo-risczero-*/r0vm 2>/dev/null | sort -V | tail -n1 || true)"
    if [[ -n "$candidate" && -x "$candidate" ]]; then
        export PATH="$(dirname "$candidate"):$PATH"
        echo "Using r0vm from rzup extension path: $candidate"; return 0
    fi
    echo "Warning: r0vm not found in PATH; ImageID computation may be slow." >&2
}

e2e_validate_prerequisites() {
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
        if [[ "$RISC0_GUEST_USE_DOCKER" == "1" ]]; then require_cmd docker; fi
    fi

    ensure_risc0_r0vm_available
    resolve_private_key

    # Chain connectivity and ID validation.
    ACTUAL_SOURCE_CHAIN_ID="$(cast chain-id --rpc-url "$SOURCE_RPC")"
    ACTUAL_DEST_CHAIN_ID="$(cast chain-id --rpc-url "$DEST_RPC")"

    if [[ "$ACTUAL_SOURCE_CHAIN_ID" != "$SOURCE_CHAIN_ID" ]]; then
        echo "Source chain ID mismatch: expected $SOURCE_CHAIN_ID, got $ACTUAL_SOURCE_CHAIN_ID" >&2; exit 1
    fi
    if [[ "$ACTUAL_DEST_CHAIN_ID" != "$DEST_CHAIN_ID" ]]; then
        echo "Destination chain ID mismatch: expected $DEST_CHAIN_ID, got $ACTUAL_DEST_CHAIN_ID" >&2; exit 1
    fi
    if [[ "$SOURCE_CHAIN_ID" == "$DEST_CHAIN_ID" ]]; then
        echo "Source and destination chain IDs must differ." >&2; exit 1
    fi

    DEPLOYER_ADDRESS="$(cast wallet address --private-key "$PRIVATE_KEY")"
    echo "Deployer: $DEPLOYER_ADDRESS"
    echo "Source:   $SOURCE_RPC (chain $SOURCE_CHAIN_ID, profile $SOURCE_NETWORK_PROFILE)"
    echo "Dest:     $DEST_RPC (chain $DEST_CHAIN_ID, profile $DEST_NETWORK_PROFILE)"
    echo ""
}

# ── Stateless-client bootstrap ───────────────────────────────────────────────
ensure_stateless_client_ready() {
    require_cmd node
    require_cmd npm

    if [[ ! -d "$STATELESS_CLIENT_DIR" ]]; then
        echo "Missing stateless-client directory: $STATELESS_CLIENT_DIR" >&2; exit 1
    fi
    if [[ ! -d "$STATELESS_CLIENT_DIR/node_modules" ]]; then
        echo "Installing stateless-client npm dependencies..."
        (cd "$STATELESS_CLIENT_DIR" && npm install)
    fi
    if [[ "$STATELESS_CLIENT_AUTO_BUILD" == "1" ]]; then
        echo "Building stateless-client..."
        (cd "$STATELESS_CLIENT_DIR" && npm run build >/dev/null)
    fi
    if [[ ! -f "$STATELESS_CLIENT_DIR/dist/cli.js" ]]; then
        echo "Missing stateless-client CLI: $STATELESS_CLIENT_DIR/dist/cli.js" >&2; exit 1
    fi
    mkdir -p "$STATELESS_CLIENT_DIR/colibri-cache"
}

# ── eth_getBlockReceipts capability probe + proxy ────────────────────────────
BURN_PROOF_PROXY_PID=""

probe_block_receipts_support() {
    local rpc_url="$1"
    local latest_block
    latest_block="$(cast rpc --rpc-url "$rpc_url" eth_blockNumber 2>/dev/null || echo "0x0")"
    local result
    result="$(curl -sS -H "content-type: application/json" \
        --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBlockReceipts\",\"params\":[\"$latest_block\"]}" \
        "$rpc_url" 2>/dev/null || true)"
    if printf '%s' "$result" | grep -q '"result":\['; then
        return 0
    fi
    return 1
}

# Start the bundled Hardhat eth_getBlockReceipts proxy if destination does not
# support the method natively.  Sets DEST_RPC to the proxy URL for burn proof.
# On exit (trap) the proxy process is killed automatically.
ensure_block_receipts_available() {
    if probe_block_receipts_support "$DEST_RPC"; then
        echo "eth_getBlockReceipts supported on destination RPC — no proxy needed."
        return 0
    fi

    local dest_profile_warp
    dest_profile_warp="$(profile_time_warp_method "$DEST_NETWORK_PROFILE")"
    if [[ "$dest_profile_warp" == "none" ]]; then
        echo "ERROR: eth_getBlockReceipts is not supported by destination RPC ($DEST_RPC) and no fallback proxy is available for profile '$DEST_NETWORK_PROFILE'." >&2
        echo "Burn proof generation requires receipt trie access. Aborting." >&2
        exit 1
    fi

    if [[ ! -f "$PROXY_SCRIPT" ]]; then
        echo "ERROR: Bundled proxy script not found: $PROXY_SCRIPT" >&2; exit 1
    fi

    echo "Starting eth_getBlockReceipts proxy on port $BURN_PROOF_PROXY_PORT (wrapping $DEST_RPC)..."
    DEST_RPC_UPSTREAM="$DEST_RPC"
    node "$PROXY_SCRIPT" "$DEST_RPC_UPSTREAM" "$BURN_PROOF_PROXY_PORT" &
    BURN_PROOF_PROXY_PID=$!
    trap 'kill "$BURN_PROOF_PROXY_PID" 2>/dev/null || true' EXIT INT TERM

    # Wait for proxy readiness.
    local i
    for ((i = 1; i <= 20; i++)); do
        if curl -sS "http://127.0.0.1:$BURN_PROOF_PROXY_PORT" >/dev/null 2>&1; then
            echo "Proxy ready at http://127.0.0.1:$BURN_PROOF_PROXY_PORT"
            DEST_RPC_FOR_BURN="http://127.0.0.1:$BURN_PROOF_PROXY_PORT"
            return 0
        fi
        sleep 0.5
    done
    echo "ERROR: Proxy on port $BURN_PROOF_PROXY_PORT did not start in time." >&2
    exit 1
}

# ── TX / deployment helpers ──────────────────────────────────────────────────
send_tx_async() {
    local rpc_url="$1"; shift
    local output tx_hash
    output="$(cast send --async "$@" --rpc-url "$rpc_url" --private-key "$PRIVATE_KEY" 2>&1)"
    tx_hash="$(printf '%s\n' "$output" | sed -n 's/.*\(0x[0-9a-fA-F]\{64\}\).*/\1/p' | tail -n1)"
    if [[ -z "$tx_hash" ]]; then
        echo "Failed to parse tx hash from cast send output." >&2
        echo "$output" >&2; exit 1
    fi
    printf '%s' "$tx_hash"
}

wait_for_tx_receipt_block() {
    local rpc_url="$1" tx_hash="$2"
    local attempts="$TX_RECEIPT_WAIT_ATTEMPTS" interval_sec="$TX_RECEIPT_WAIT_INTERVAL_SEC"
    local i receipt block_hex status_hex block_dec

    for ((i = 1; i <= attempts; i++)); do
        receipt="$(cast rpc --rpc-url "$rpc_url" eth_getTransactionReceipt "$tx_hash" 2>/dev/null || true)"
        block_hex="$(printf '%s' "$receipt" | sed -n 's/.*"blockNumber":"\([^"]*\)".*/\1/p' | head -n1)"
        if [[ "$block_hex" =~ ^0x[0-9a-fA-F]+$ ]]; then
            status_hex="$(printf '%s' "$receipt" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -n1)"
            block_dec="$(cast --to-dec "$block_hex")"
            if [[ "$status_hex" == "0x0" ]]; then
                echo "Transaction $tx_hash reverted in block $block_dec on $rpc_url." >&2; exit 1
            fi
            printf '%s\n' "$block_dec"; return 0
        fi
        sleep "$interval_sec"
    done
    echo "Timed out waiting for receipt of tx $tx_hash on $rpc_url." >&2; exit 1
}

normalize_execution_block_tag() {
    local value="$1" lowered
    lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    case "$lowered" in
        latest|safe|finalized|pending|earliest) printf '%s' "$lowered"; return 0 ;;
    esac
    if [[ "$value" =~ ^0x[0-9a-fA-F]+$ ]]; then printf '%s' "$value"; return 0; fi
    if [[ "$value" =~ ^[0-9]+$ ]]; then printf "0x%x" "$value"; return 0; fi
    printf '%s' "$value"
}

deploy_contract() {
    local rpc_url="$1"; shift
    local output address rc attempt=1

    while true; do
        set +e
        output="$(cd "$SC_DIR" && forge create --broadcast --rpc-url "$rpc_url" --private-key "$PRIVATE_KEY" "$@" 2>&1)"
        rc=$?
        set -e
        echo "$output" >&2
        if [[ "$rc" -eq 0 ]]; then
            address="$(echo "$output" | awk '/Deployed to:/ {print $3}' | tail -n1)"
            [[ -n "$address" ]] || { echo "Failed to parse deployed address." >&2; exit 1; }
            printf '%s' "$address"; return 0
        fi
        if [[ "$output" == *"nonce too low"* || "$output" == *"replacement transaction underpriced"* ]] \
            && [[ "$attempt" -lt "$DEPLOY_RETRY_ATTEMPTS" ]]; then
            echo "Deployment nonce sync issue. Retrying in ${DEPLOY_RETRY_DELAY_SEC}s ($attempt/$DEPLOY_RETRY_ATTEMPTS)..." >&2
            attempt=$((attempt+1)); sleep "$DEPLOY_RETRY_DELAY_SEC"; continue
        fi
        echo "forge create failed after $attempt attempt(s)." >&2; exit "$rc"
    done
}

compute_tx_id() {
    local sender="$1" receiver="$2" amount="$3" currency_from="$4" currency_to="$5"
    local src_connector="$6" dst_connector="$7" nonce="$8"
    local encoded
    encoded="$(cast abi-encode "f(address,address,uint256,address,address,address,address,uint256)" \
        "$sender" "$receiver" "$amount" "$currency_from" "$currency_to" \
        "$src_connector" "$dst_connector" "$nonce")"
    cast keccak "$encoded"
}

to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

query_tx_status() {
    local rpc_url="$1" connector="$2" tx_id="$3"
    local errfile status rc calldata rpc_payload rpc_result raw_status

    errfile="$(mktemp)"
    set +e
    status="$(cast call "$connector" "txStatus(bytes32)(uint8)" "$tx_id" --rpc-url "$rpc_url" 2>"$errfile")"
    rc=$?; set -e
    if [[ "$rc" -eq 0 ]]; then rm -f "$errfile"; printf '%s' "$status"; return 0; fi

    echo "Warning: cast call txStatus failed; using eth_call fallback." >&2
    if [[ -f "$errfile" ]]; then tail -n1 "$errfile" >&2 || true; fi; rm -f "$errfile"
    calldata="$(cast calldata "txStatus(bytes32)" "$tx_id")"
    rpc_payload="$(printf '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"]}' "$connector" "$calldata")"
    rpc_result="$(curl -sS -H "content-type: application/json" --data "$rpc_payload" "$rpc_url" || true)"
    raw_status="$(printf '%s' "$rpc_result" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"
    [[ -z "$raw_status" ]] && { printf '%s' "unknown"; return 0; }
    cast --to-dec "$raw_status"
}

query_tx_nonce() {
    local rpc_url="$1" connector="$2" nonce
    nonce="$(cast call "$connector" "txNonce()(uint256)" --rpc-url "$rpc_url" 2>/dev/null || true)"
    [[ -z "$nonce" ]] && { echo "Failed to query txNonce() on $connector via $rpc_url" >&2; exit 1; }
    printf '%s' "$nonce"
}

query_erc20_balance() {
    local rpc_url="$1" token="$2" account="$3"
    local errfile balance rc calldata rpc_payload rpc_result raw_balance

    errfile="$(mktemp)"
    set +e
    balance="$(cast call "$token" "balanceOf(address)(uint256)" "$account" --rpc-url "$rpc_url" 2>"$errfile")"
    rc=$?; set -e
    if [[ "$rc" -eq 0 ]]; then rm -f "$errfile"; printf '%s' "$balance"; return 0; fi
    if [[ -f "$errfile" ]]; then tail -n1 "$errfile" >&2 || true; fi; rm -f "$errfile"

    calldata="$(cast calldata "balanceOf(address)" "$account")"
    rpc_payload="$(printf '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"]}' "$token" "$calldata")"
    rpc_result="$(curl -sS -H "content-type: application/json" --data "$rpc_payload" "$rpc_url" || true)"
    raw_balance="$(printf '%s' "$rpc_result" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"
    [[ -z "$raw_balance" ]] && { printf '%s' "unknown"; return 0; }
    cast --to-dec "$raw_balance"
}

# ── Time-warp helpers ────────────────────────────────────────────────────────
get_chain_timestamp() {
    local rpc_url="$1"
    local result ts
    result="$(curl -sS -H "content-type: application/json" \
        --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}' \
        "$rpc_url" 2>/dev/null || true)"
    ts="$(printf '%s' "$result" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p' | head -n1)"
    if [[ "$ts" =~ ^0x ]]; then ts="$(cast --to-dec "$ts")"; fi
    printf '%s' "${ts:-0}"
}

warp_time_anvil() {
    local rpc_url="$1" new_timestamp="$2"
    cast rpc --rpc-url "$rpc_url" anvil_setNextBlockTimestamp "$new_timestamp" >/dev/null
    cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
    echo "Warped Anvil time to $new_timestamp."
}

warp_time_hardhat() {
    local rpc_url="$1" new_timestamp="$2"
    local current_ts
    current_ts="$(get_chain_timestamp "$rpc_url")"
    if [[ -n "$current_ts" && "$current_ts" -ge "$new_timestamp" ]]; then
        cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
        echo "Hardhat already at timestamp $current_ts (>= $new_timestamp); mined a block."; return 0
    fi
    cast rpc --rpc-url "$rpc_url" evm_setNextBlockTimestamp "$new_timestamp" >/dev/null
    cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
    echo "Warped Hardhat time to $new_timestamp."
}

# Warp both chains past the given Unix timestamp using per-profile method.
warp_both_chains_past() {
    local target_timestamp="$1"
    local src_method dest_method
    src_method="$(profile_time_warp_method "$SOURCE_NETWORK_PROFILE")"
    dest_method="$(profile_time_warp_method "$DEST_NETWORK_PROFILE")"

    if [[ "$src_method" == "none" || "$dest_method" == "none" ]]; then
        echo "ERROR: Time-warp is not supported for profile pair '$SOURCE_NETWORK_PROFILE' -> '$DEST_NETWORK_PROFILE'." >&2
        echo "The refund path requires local chain profiles that support evm_setNextBlockTimestamp." >&2
        exit 1
    fi

    echo "Warping both chains past timestamp $target_timestamp..."
    case "$src_method" in
        anvil)   warp_time_anvil   "$SOURCE_RPC" "$target_timestamp" ;;
        hardhat) warp_time_hardhat "$SOURCE_RPC" "$target_timestamp" ;;
    esac
    case "$dest_method" in
        anvil)   warp_time_anvil   "$DEST_RPC" "$target_timestamp" ;;
        hardhat) warp_time_hardhat "$DEST_RPC" "$target_timestamp" ;;
    esac
}

# ── stateless-client relay-resume runner ─────────────────────────────────────
extract_stateless_client_value() {
    local cli_output="$1" key="$2" value
    value="$(printf '%s\n' "$cli_output" | awk -F': ' -v k="$key" '$1 == k {print $2}' | tail -n1)"
    if [[ -z "$value" ]]; then
        echo "Failed to extract '$key' from stateless-client output." >&2; exit 1
    fi
    printf '%s' "$value"
}

to_decimal_block_if_fixed() {
    local block_tag="$1"
    if [[ "$block_tag" =~ ^0x[0-9a-fA-F]+$ ]]; then
        cast --to-dec "$block_tag" 2>/dev/null || true; return 0
    fi
    if [[ "$block_tag" =~ ^[0-9]+$ ]]; then printf '%s' "$block_tag"; return 0; fi
    printf ''
}

wait_for_successor_execution_block() {
    local rpc_url="$1" block_tag="$2" stage_label="$3"
    local attempts="$STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_ATTEMPTS"
    local interval_sec="$STATELESS_CLIENT_SUCCESSOR_BLOCK_WAIT_INTERVAL_SEC"
    local target_dec current_head i

    target_dec="$(to_decimal_block_if_fixed "$block_tag")"
    [[ ! "$target_dec" =~ ^[0-9]+$ ]] && return 0

    current_head="$(cast block-number --rpc-url "$rpc_url" 2>/dev/null || true)"
    if [[ "$current_head" =~ ^[0-9]+$ ]] && (( current_head > target_dec )); then return 0; fi

    echo "Waiting for stage '$stage_label' successor block after $target_dec on $rpc_url..."
    for ((i = 1; i <= attempts; i++)); do
        current_head="$(cast block-number --rpc-url "$rpc_url" 2>/dev/null || true)"
        if [[ "$current_head" =~ ^[0-9]+$ ]] && (( current_head > target_dec )); then
            echo "Observed successor block for '$stage_label': head=$current_head"; return 0
        fi
        sleep "$interval_sec"
    done
    echo "Warning: did not observe successor block for '$stage_label' after $attempts attempts." >&2
}

is_colibri_sync_backwards_error() {
    local output="$1"
    [[ "$output" == *"last sync state is higher than the required period"* && "$output" == *"cannot sync backwards"* ]]
}

run_stateless_client_cli_with_retry() {
    local command="$1"; shift
    local max_retries="$STATELESS_CLIENT_RELAY_RETRIES"
    local retry_delay_sec="$STATELESS_CLIENT_RELAY_RETRY_DELAY_SEC"
    local effective_log_lookback="$STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS"
    local attempt=0 output rc max_range_from_error

    while true; do
        set +e
        output="$(
            cd "$STATELESS_CLIENT_DIR/colibri-cache"
            RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
            STATELESS_CLIENT_LOG_LOOKBACK_BLOCKS="$effective_log_lookback" \
            STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK="$STATELESS_CLIENT_CHIADO_SYNC_BACKWARDS_RPC_FALLBACK" \
            node ../dist/cli.js "$command" "$@" 2>&1
        )"
        rc=$?; set -e
        if [[ "$rc" -eq 0 ]]; then printf '%s' "$output"; return 0; fi

        if [[ "$output" == *"parentBeaconBlockRoot"* \
            || "$output" == *"Block after "* \
            || "$output" == *"can not be found in the execution layer"* \
            || "$output" == *"cannot be found in the execution layer"* \
            || "$output" == *"has not been signed yet and cannot be verified"* \
            || "$output" == *"requested block has not been signed yet"* \
            || "$output" == *"Invalid offset for container"* \
            || "$output" == *"Invalid SSZ structure in bootstrap data"* ]]; then
            if [[ "$attempt" -lt "$max_retries" ]]; then
                attempt=$((attempt+1))
                echo "stateless-client $command hit transient error. Retrying in ${retry_delay_sec}s ($attempt/$max_retries)..."
                sleep "$retry_delay_sec"; continue
            fi
        fi

        max_range_from_error="$(printf '%s\n' "$output" | sed -n 's/.*exceed maximum block range: \([0-9][0-9]*\).*/\1/p' | head -n1)"
        if [[ "$max_range_from_error" =~ ^[0-9]+$ && "$effective_log_lookback" =~ ^[0-9]+$ ]] \
            && (( effective_log_lookback > max_range_from_error )) && [[ "$attempt" -lt "$max_retries" ]]; then
            attempt=$((attempt+1))
            effective_log_lookback="$max_range_from_error"
            echo "stateless-client $command hit RPC log range limit; reducing lookback to ${effective_log_lookback} and retrying ($attempt/$max_retries)..."
            sleep "$retry_delay_sec"; continue
        fi

        printf '%s' "$output"; return "$rc"
    done
}

# Build the common args array passed to every relay-resume invocation.
# Stores result in the caller-provided array name (use nameref via eval).
build_relay_resume_common_args() {
    local -n _arr="$1"
    local proof_backend="local"
    [[ "$USE_DOCKER_PROVER" == "1" ]] && proof_backend="docker"

    _arr=(
        --tx-id "$TX_ID"
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
    )

    [[ -n "$COLIBRI_SOURCE_PROVER_URLS" ]]     && _arr+=(--source-prover-urls "$COLIBRI_SOURCE_PROVER_URLS")
    [[ -n "$COLIBRI_DEST_PROVER_URLS" ]]       && _arr+=(--destination-prover-urls "$COLIBRI_DEST_PROVER_URLS")
    [[ -n "$COLIBRI_SOURCE_BEACON_URLS" ]]     && _arr+=(--source-beacon-urls "$COLIBRI_SOURCE_BEACON_URLS")
    [[ -n "$COLIBRI_DEST_BEACON_URLS" ]]       && _arr+=(--destination-beacon-urls "$COLIBRI_DEST_BEACON_URLS")
    [[ -n "$COLIBRI_SOURCE_CHECKPOINTZ_URLS" ]] && _arr+=(--source-checkpointz-urls "$COLIBRI_SOURCE_CHECKPOINTZ_URLS")
    [[ -n "$COLIBRI_DEST_CHECKPOINTZ_URLS" ]]  && _arr+=(--destination-checkpointz-urls "$COLIBRI_DEST_CHECKPOINTZ_URLS")
}

# Run relay-resume once and assert the planned action matches expected_action.
# Outputs the CLI output and stores submissionTxHash / submissionBlock / resultingStatus
# in the caller-visible vars LAST_SUBMISSION_TX_HASH, LAST_SUBMISSION_BLOCK, LAST_RESULTING_STATUS.
LAST_SUBMISSION_TX_HASH=""
LAST_SUBMISSION_BLOCK=""
LAST_RESULTING_STATUS=""

run_relay_resume_for_action() {
    local expected_action="$1"; shift    # remaining args appended to common_args
    local -a common_args; build_relay_resume_common_args common_args

    local output rc
    set +e
    output="$(run_stateless_client_cli_with_retry relay-resume "${common_args[@]}" "$@")"
    rc=$?; set -e

    if [[ "$rc" -ne 0 ]]; then
        printf '%s\n' "$output"
        echo "stateless-client relay-resume failed." >&2; exit 1
    fi
    printf '%s\n' "$output"

    local planned_action
    planned_action="$(extract_stateless_client_value "$output" "plannedAction")"
    if [[ "$planned_action" != "$expected_action" ]]; then
        echo "ERROR: Expected planned action '$expected_action', got '$planned_action'." >&2; exit 1
    fi

    # These fields are absent for noop; tolerate that.
    LAST_SUBMISSION_TX_HASH="$(printf '%s\n' "$output" | awk -F': ' '$1 == "submissionTxHash" {print $2}' | tail -n1 || true)"
    LAST_SUBMISSION_BLOCK="$(printf '%s\n' "$output" | awk -F': ' '$1 == "submissionBlock" {print $2}' | tail -n1 || true)"
    LAST_RESULTING_STATUS="$(printf '%s\n' "$output" | awk -F': ' '$1 == "resultingStatus" {print $2}' | tail -n1 || true)"
}

# ── Deployment helpers ────────────────────────────────────────────────────────
deploy_source_contracts() {
    if [[ "$REUSE_SOURCE_DEPLOYMENTS" == "1" ]]; then
        require_env_value "EXISTING_SOURCE_CONNECTOR" "$EXISTING_SOURCE_CONNECTOR"
        require_env_value "EXISTING_SOURCE_TOKEN" "$EXISTING_SOURCE_TOKEN"
        SOURCE_CONNECTOR="$EXISTING_SOURCE_CONNECTOR"
        SOURCE_TOKEN="$EXISTING_SOURCE_TOKEN"
        SOURCE_RISC0_ADAPTER="${EXISTING_SOURCE_RISC0_ADAPTER:-}"
        echo "Reusing source contracts: connector=$SOURCE_CONNECTOR token=$SOURCE_TOKEN"
        return 0
    fi

    echo "Deploying source contracts on chain $SOURCE_CHAIN_ID..."

    local groth16_verifier
    groth16_verifier="$(deploy_contract "$SOURCE_RPC" "src/Groth16Verifier.sol:Groth16Verifier")"
    echo "Source Groth16Verifier: $groth16_verifier"

    SOURCE_RISC0_ADAPTER="$(deploy_contract "$SOURCE_RPC" \
        "src/Risc0ProofAdapter.sol:Risc0ProofAdapter" \
        --constructor-args "$groth16_verifier" "$CONTROL_ROOT" "$BN254_CONTROL_ID")"
    echo "Source Risc0Adapter: $SOURCE_RISC0_ADAPTER"

    local snarkjs_adapter
    snarkjs_adapter="$(deploy_contract "$SOURCE_RPC" "src/SnarkJsProofAdapter.sol:SnarkJsProofAdapter")"
    echo "Source SnarkJsAdapter: $snarkjs_adapter"

    local src_chain_id_normalized dest_chain_id_normalized
    src_chain_id_normalized="$(to_lower "$(cast to-bytes32 "$SOURCE_CHAIN_ID")")"
    dest_chain_id_normalized="$(to_lower "$(cast to-bytes32 "$DEST_CHAIN_ID")")"

    SOURCE_CONNECTOR="$(deploy_contract "$SOURCE_RPC" \
        "src/connectors/Connector.sol:Connector" \
        --constructor-args "$src_chain_id_normalized" "$dest_chain_id_normalized" \
            "$ACK_WINDOW_SECONDS" "$PROOF_TYPE_RISC0")"
    echo "Source Connector: $SOURCE_CONNECTOR"

    local set_lock_tx set_mint_tx
    set_lock_tx="$(send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" "setVerifier(uint8,address)" "$ROUTE_DEST_LOCK" "$SOURCE_RISC0_ADAPTER" \
        --gas-limit "$SET_VERIFIER_GAS_LIMIT")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$set_lock_tx" >/dev/null
    set_mint_tx="$(send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" "setVerifier(uint8,address)" "$ROUTE_ORIGIN_MINT" "$SOURCE_RISC0_ADAPTER" \
        --gas-limit "$SET_VERIFIER_GAS_LIMIT")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$set_mint_tx" >/dev/null

    SOURCE_TOKEN="$(deploy_contract "$SOURCE_RPC" \
        "src/TestERC20.sol:TestERC20" \
        --constructor-args "$TOKEN_NAME" "$TOKEN_SYMBOL" "$(cast to-bytes32 "$SOURCE_CHAIN_ID")")"
    echo "Source Token: $SOURCE_TOKEN"
}

deploy_destination_contracts() {
    if [[ "$REUSE_DEST_DEPLOYMENTS" == "1" ]]; then
        require_env_value "EXISTING_DEST_CONNECTOR" "$EXISTING_DEST_CONNECTOR"
        require_env_value "EXISTING_DEST_TOKEN" "$EXISTING_DEST_TOKEN"
        DEST_CONNECTOR="$EXISTING_DEST_CONNECTOR"
        DEST_TOKEN="$EXISTING_DEST_TOKEN"
        DEST_RISC0_ADAPTER="${EXISTING_DEST_RISC0_ADAPTER:-}"
        echo "Reusing dest contracts: connector=$DEST_CONNECTOR token=$DEST_TOKEN"
        return 0
    fi

    echo "Deploying destination contracts on chain $DEST_CHAIN_ID..."

    local groth16_verifier
    groth16_verifier="$(deploy_contract "$DEST_RPC" "src/Groth16Verifier.sol:Groth16Verifier")"

    DEST_RISC0_ADAPTER="$(deploy_contract "$DEST_RPC" \
        "src/Risc0ProofAdapter.sol:Risc0ProofAdapter" \
        --constructor-args "$groth16_verifier" "$CONTROL_ROOT" "$BN254_CONTROL_ID")"
    echo "Dest Risc0Adapter: $DEST_RISC0_ADAPTER"

    local dest_snarkjs_adapter
    dest_snarkjs_adapter="$(deploy_contract "$DEST_RPC" "src/SnarkJsProofAdapter.sol:SnarkJsProofAdapter")"

    local src_chain_id_normalized dest_chain_id_normalized
    src_chain_id_normalized="$(to_lower "$(cast to-bytes32 "$SOURCE_CHAIN_ID")")"
    dest_chain_id_normalized="$(to_lower "$(cast to-bytes32 "$DEST_CHAIN_ID")")"

    DEST_CONNECTOR="$(deploy_contract "$DEST_RPC" \
        "src/connectors/Connector.sol:Connector" \
        --constructor-args "$dest_chain_id_normalized" "$src_chain_id_normalized" \
            "$ACK_WINDOW_SECONDS" "$PROOF_TYPE_RISC0")"
    echo "Dest Connector: $DEST_CONNECTOR"

    local set_lock_tx set_ack_tx
    set_lock_tx="$(send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" "setVerifier(uint8,address)" "$ROUTE_DEST_LOCK" "$DEST_RISC0_ADAPTER" \
        --gas-limit "$SET_VERIFIER_GAS_LIMIT")"
    wait_for_tx_receipt_block "$DEST_RPC" "$set_lock_tx" >/dev/null
    set_ack_tx="$(send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" "setVerifier(uint8,address)" "$ROUTE_DEST_ACK" "$DEST_RISC0_ADAPTER" \
        --gas-limit "$SET_VERIFIER_GAS_LIMIT")"
    wait_for_tx_receipt_block "$DEST_RPC" "$set_ack_tx" >/dev/null

    DEST_TOKEN="$(deploy_contract "$DEST_RPC" \
        "src/BurnableTestERC20.sol:BurnableTestERC20" \
        --constructor-args "$DEST_TOKEN_NAME" "$DEST_TOKEN_SYMBOL" "$(cast to-bytes32 "$DEST_CHAIN_ID")")"
    echo "Dest Token: $DEST_TOKEN"
}

deploy_destination_refund_verifiers() {
    # Set refund-claim and burn-proof verifiers on destination connector.
    local set_refund_tx set_burn_tx
    set_refund_tx="$(send_tx_async "$DEST_RPC" \
        "$DEST_CONNECTOR" "setVerifier(uint8,address)" "$ROUTE_DEST_REFUND_CLAIM" "$DEST_RISC0_ADAPTER" \
        --gas-limit "$SET_VERIFIER_GAS_LIMIT")"
    wait_for_tx_receipt_block "$DEST_RPC" "$set_refund_tx" >/dev/null

    # burn-proof submitted on source connector; use source risc0 adapter.
    local set_source_burn_tx
    set_source_burn_tx="$(send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" "setVerifier(uint8,address)" "$ROUTE_ORIGIN_BURN" "$SOURCE_RISC0_ADAPTER" \
        --gas-limit "$SET_VERIFIER_GAS_LIMIT")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$set_source_burn_tx" >/dev/null
}

# ── Deposit and txId setup ───────────────────────────────────────────────────
perform_deposit() {
    local src_nonce dest_connector_bytes32
    src_nonce="$(query_tx_nonce "$SOURCE_RPC" "$SOURCE_CONNECTOR")"

    local source_token_bytes32 dest_chain_bytes32
    source_token_bytes32="$(to_lower "$(cast to-bytes32 "$SOURCE_CHAIN_ID")")"
    dest_chain_bytes32="$(to_lower "$(cast to-bytes32 "$DEST_CHAIN_ID")")"

    # Approve the source connector to pull tokens.
    local approve_tx
    approve_tx="$(send_tx_async "$SOURCE_RPC" \
        "$SOURCE_TOKEN" "approve(address,uint256)" "$SOURCE_CONNECTOR" "$AMOUNT_WEI")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$approve_tx" >/dev/null

    # depositAndLock
    local deposit_tx
    deposit_tx="$(send_tx_async "$SOURCE_RPC" \
        "$SOURCE_CONNECTOR" "depositAndLock(address,address,address,address,uint256)" \
            "$DEPLOYER_ADDRESS" "$DEST_CONNECTOR" "$SOURCE_TOKEN" "$DEST_TOKEN" "$AMOUNT_WEI")"
    SOURCE_DEPOSIT_BLOCK="$(wait_for_tx_receipt_block "$SOURCE_RPC" "$deposit_tx")"
    echo "depositAndLock tx: $deposit_tx (block $SOURCE_DEPOSIT_BLOCK)"

    TX_ID="$(compute_tx_id "$DEPLOYER_ADDRESS" "$DEPLOYER_ADDRESS" "$AMOUNT_WEI" \
        "$SOURCE_TOKEN" "$DEST_TOKEN" "$SOURCE_CONNECTOR" "$DEST_CONNECTOR" "$src_nonce")"
    echo "txId: $TX_ID"
}
