#!/usr/bin/env bash
# scripts/lib/e2e-common.sh
#
# Shared library sourced by e2e-happy-path.sh, e2e-refund-path.sh and e2e-non-accept-path.sh.
# Do NOT execute this file directly.
#
# After sourcing, call:
#   e2e_parse_args "$@"           -- parse flags (sets SOURCE_NETWORK_PROFILE etc.)
#   e2e_apply_profile_defaults    -- fill RPC/chain from profile
#   e2e_validate_prerequisites    -- check commands, key, chain connectivity
#   ensure_stateless_client_ready -- install and build the relay client
#   deploy_contracts              -- `make deploy-prod-full` on both chains
#   set_finality_delays           -- connector finality delays (local chains only)
#   perform_deposit               -- mint, approve and depositAndLock; sets TX_ID
#
# Every relay stage runs through `stateless-client relay-resume`. Proof backends:
#   local / docker  real RISC Zero proofs, deployed with the image IDs of this checkout's guests
#   test            SNARKJS test proofs from chain data, no proof host; local chains only
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
# Receiver of the wrapped tokens on the destination; defaults to the deployer.
RECEIVER_ADDRESS="${RECEIVER_ADDRESS:-}"

# Finality delay of each network in seconds; 0 leaves the connector check off. The destination
# connector holds the source delay (refund-claim proofs about source blocks), the source
# connector holds the destination delay (non-acceptance proofs about destination blocks).
SOURCE_FINALITY_DELAY="${SOURCE_FINALITY_DELAY:-0}"
DEST_FINALITY_DELAY="${DEST_FINALITY_DELAY:-0}"

LOCK_EXECUTION_BLOCK="${LOCK_EXECUTION_BLOCK:-}"
MINT_EXECUTION_BLOCK="${MINT_EXECUTION_BLOCK:-}"
ACK_EXECUTION_BLOCK="${ACK_EXECUTION_BLOCK:-}"
REFUND_CLAIM_EXECUTION_BLOCK="${REFUND_CLAIM_EXECUTION_BLOCK:-}"
BURN_PROOF_EXECUTION_BLOCK="${BURN_PROOF_EXECUTION_BLOCK:-}"

RISC0_PROVER_MODE="${RISC0_PROVER_MODE:-local}"
# local | docker | test (see the header); USE_DOCKER_PROVER=1 is kept as an alias for docker.
PROOF_BACKEND="${PROOF_BACKEND:-local}"
if [[ "${USE_DOCKER_PROVER:-0}" == "1" ]]; then PROOF_BACKEND="docker"; fi
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

# deploy-prod-full always deploys both sides, so reusing either side reuses both. The reused
# connectors keep the finality delays they hold; pass the same delays to the scripts.
# EXISTING_DEST_TOKEN is the destination's BridgeWrappedToken.
REUSE_SOURCE_DEPLOYMENTS="${REUSE_SOURCE_DEPLOYMENTS:-0}"
REUSE_DEST_DEPLOYMENTS="${REUSE_DEST_DEPLOYMENTS:-0}"
EXISTING_SOURCE_CONNECTOR="${EXISTING_SOURCE_CONNECTOR:-}"
EXISTING_SOURCE_TOKEN="${EXISTING_SOURCE_TOKEN:-}"
EXISTING_DEST_CONNECTOR="${EXISTING_DEST_CONNECTOR:-}"
EXISTING_DEST_TOKEN="${EXISTING_DEST_TOKEN:-}"

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

# Connector admin changes (finality delays) wait out a 48 h timelock; on local chains the
# scripts warp past it.
ADMIN_TIMELOCK_SECONDS=172801

# Proof workspace -> deploy-prod-full image-ID variable for the route that workspace proves.
IMAGE_ID_VARIABLES=(
    "lock_event:DEST_LOCK_IMAGE_ID"
    "mint_event:ORIGIN_MINT_IMAGE_ID"
    "ack_event:DEST_ACK_IMAGE_ID"
    "refund_claim_event:DEST_REFUND_CLAIM_IMAGE_ID"
    "burn_event:ORIGIN_BURN_IMAGE_ID"
    "non_accept_event:ORIGIN_NON_ACCEPT_IMAGE_ID"
)

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
            --receiver)
                RECEIVER_ADDRESS="$2"; shift 2 ;;
            --source-finality-delay)
                SOURCE_FINALITY_DELAY="$2"; shift 2 ;;
            --destination-finality-delay|--dest-finality-delay)
                DEST_FINALITY_DELAY="$2"; shift 2 ;;
            --proof-backend)
                PROOF_BACKEND="$2"; shift 2 ;;
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
                echo "Run $0 --help for usage." >&2
                exit 1 ;;
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

    require_cmd make

    case "$PROOF_BACKEND" in
        local)
            require_cmd cargo
            if [[ "$RISC0_GUEST_USE_DOCKER" == "1" ]]; then require_cmd docker; fi
            ensure_risc0_r0vm_available ;;
        docker)
            require_cmd docker ;;
        test)
            require_test_backend_setup ;;
        *)
            echo "Unsupported --proof-backend '$PROOF_BACKEND'. Expected local, docker or test." >&2; exit 1 ;;
    esac

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
    set_if_empty_var "RECEIVER_ADDRESS" "$DEPLOYER_ADDRESS"
    echo "Deployer: $DEPLOYER_ADDRESS"
    echo "Receiver: $RECEIVER_ADDRESS"
    echo "Proofs:   $PROOF_BACKEND"
    echo "Source:   $SOURCE_RPC (chain $SOURCE_CHAIN_ID, profile $SOURCE_NETWORK_PROFILE)"
    echo "Dest:     $DEST_RPC (chain $DEST_CHAIN_ID, profile $DEST_NETWORK_PROFILE)"
    echo ""
}

# Test proofs carry no proof, so they only work on local chains and only with the mock
# SnarkJS verifier deploy-prod-full deploys when no SNARK_VERIFIER is configured.
require_test_backend_setup() {
    if [[ "$(profile_time_warp_method "$SOURCE_NETWORK_PROFILE")" == "none" \
        || "$(profile_time_warp_method "$DEST_NETWORK_PROFILE")" == "none" ]]; then
        echo "--proof-backend test needs local chain profiles (local-anvil, local-hardhat)." >&2; exit 1
    fi
    if [[ -n "${SNARK_VERIFIER:-}" ]] || { [[ -f "$SC_DIR/.env" ]] \
        && grep -Eq "^[[:space:]]*(export[[:space:]]+)?SNARK_VERIFIER[[:space:]]*=[[:space:]]*[^[:space:]#]" "$SC_DIR/.env"; }; then
        echo "--proof-backend test needs the mock SnarkJS verifier; unset SNARK_VERIFIER (environment or $SC_DIR/.env)." >&2
        exit 1
    fi
}

# Refund flows warp time, so both profiles must be local chains.
assert_time_warp_capable() {
    local src_method dest_method
    src_method="$(profile_time_warp_method "$SOURCE_NETWORK_PROFILE")"
    dest_method="$(profile_time_warp_method "$DEST_NETWORK_PROFILE")"

    if [[ "$src_method" == "none" || "$dest_method" == "none" ]]; then
        echo "ERROR: This flow requires local time-warp support on both chains." >&2
        echo "  source profile '$SOURCE_NETWORK_PROFILE' -> time-warp: $src_method" >&2
        echo "  dest profile '$DEST_NETWORK_PROFILE' -> time-warp: $dest_method" >&2
        echo "Use local-anvil or local-hardhat for both profiles." >&2
        exit 1
    fi
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

# Ask the way the burn-proof host does: receipts by block hash, as an EIP-1898 object.
probe_block_receipts_support() {
    local rpc_url="$1"
    local latest_hash
    latest_hash="$(cast block latest --field hash --rpc-url "$rpc_url" 2>/dev/null || true)"
    local result
    result="$(curl -sS -H "content-type: application/json" \
        --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBlockReceipts\",\"params\":[{\"blockHash\":\"$latest_hash\"}]}" \
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
    printf '%s' "${nonce%% *}"
}

query_erc20_balance() {
    local rpc_url="$1" token="$2" account="$3"
    local errfile balance rc calldata rpc_payload rpc_result raw_balance

    errfile="$(mktemp)"
    set +e
    balance="$(cast call "$token" "balanceOf(address)(uint256)" "$account" --rpc-url "$rpc_url" 2>"$errfile")"
    rc=$?; set -e
    # cast appends a short form to large numbers, e.g. "1000000000000000000 [1e18]"
    if [[ "$rc" -eq 0 ]]; then rm -f "$errfile"; printf '%s' "${balance%% *}"; return 0; fi
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
    local current_ts
    current_ts="$(get_chain_timestamp "$rpc_url")"
    if [[ -n "$current_ts" && "$current_ts" -ge "$new_timestamp" ]]; then
        cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
        echo "Anvil already at timestamp $current_ts (>= $new_timestamp); mined a block."; return 0
    fi
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
        echo "This flow requires local chain profiles that support evm_setNextBlockTimestamp." >&2
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

# Move one local chain's clock forward by a number of seconds (Anvil and Hardhat alike).
advance_chain_time() {
    local rpc_url="$1" seconds="$2"
    cast rpc --rpc-url "$rpc_url" evm_increaseTime "$seconds" >/dev/null
    cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null
}

# Bring both clocks to the later of the two. Connectors compare the origin's ackDeadline with
# destination block time, and a refund run moves only one chain past its finality delay, so a
# later run on the same chains starts from aligned clocks.
align_chain_clocks() {
    local source_ts dest_ts
    source_ts="$(get_chain_timestamp "$SOURCE_RPC")"
    dest_ts="$(get_chain_timestamp "$DEST_RPC")"
    if (( source_ts > dest_ts )); then
        warp_both_chains_past "$source_ts"
    elif (( dest_ts > source_ts )); then
        warp_both_chains_past "$dest_ts"
    fi
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

    # A local Anvil/Hardhat node mines only on transactions: mine the successor block instead
    # of waiting for one that never comes.
    if [[ "$rpc_url" =~ ^https?://(127\.0\.0\.1|localhost)(:|/|$) ]] \
        && cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null 2>&1; then
        echo "Mined successor block for '$stage_label' on local $rpc_url."; return 0
    fi

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

# Fill the global RELAY_COMMON_ARGS with the args shared by every relay-resume call
# (bash 3.2: no namerefs).
RELAY_COMMON_ARGS=()
build_relay_resume_common_args() {
    RELAY_COMMON_ARGS=(
        --tx-id "$TX_ID"
        --private-key "$PRIVATE_KEY"
        --proof-backend "$PROOF_BACKEND"
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

    [[ -n "$COLIBRI_SOURCE_PROVER_URLS" ]]     && RELAY_COMMON_ARGS+=(--source-prover-urls "$COLIBRI_SOURCE_PROVER_URLS")
    [[ -n "$COLIBRI_DEST_PROVER_URLS" ]]       && RELAY_COMMON_ARGS+=(--destination-prover-urls "$COLIBRI_DEST_PROVER_URLS")
    [[ -n "$COLIBRI_SOURCE_BEACON_URLS" ]]     && RELAY_COMMON_ARGS+=(--source-beacon-urls "$COLIBRI_SOURCE_BEACON_URLS")
    [[ -n "$COLIBRI_DEST_BEACON_URLS" ]]       && RELAY_COMMON_ARGS+=(--destination-beacon-urls "$COLIBRI_DEST_BEACON_URLS")
    [[ -n "$COLIBRI_SOURCE_CHECKPOINTZ_URLS" ]] && RELAY_COMMON_ARGS+=(--source-checkpointz-urls "$COLIBRI_SOURCE_CHECKPOINTZ_URLS")
    [[ -n "$COLIBRI_DEST_CHECKPOINTZ_URLS" ]]  && RELAY_COMMON_ARGS+=(--destination-checkpointz-urls "$COLIBRI_DEST_CHECKPOINTZ_URLS")
    return 0
}

# Run relay-resume once and assert the planned action matches expected_action.
# Outputs the CLI output and stores submissionTxHash / submissionBlock / resultingStatus
# in the caller-visible vars LAST_SUBMISSION_TX_HASH, LAST_SUBMISSION_BLOCK, LAST_RESULTING_STATUS.
LAST_SUBMISSION_TX_HASH=""
LAST_SUBMISSION_BLOCK=""
LAST_RESULTING_STATUS=""

run_relay_resume_for_action() {
    local expected_action="$1"; shift    # remaining args appended to RELAY_COMMON_ARGS
    build_relay_resume_common_args

    local output rc
    set +e
    output="$(run_stateless_client_cli_with_retry relay-resume "${RELAY_COMMON_ARGS[@]}" "$@")"
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

# Run relay-resume for a refund proof that the connector must still refuse because the finality
# delay of the remote chain has not passed yet.
expect_finality_not_reached() {
    local expected_action="$1"; shift
    build_relay_resume_common_args

    local output rc
    set +e
    output="$(run_stateless_client_cli_with_retry relay-resume "${RELAY_COMMON_ARGS[@]}" "$@")"
    rc=$?; set -e

    if [[ "$rc" -eq 0 ]]; then
        printf '%s\n' "$output"
        echo "ERROR: $expected_action was accepted before the finality delay passed." >&2; exit 1
    fi
    if [[ "$output" != *"FinalityNotReached"* ]]; then
        printf '%s\n' "$output"
        echo "ERROR: $expected_action failed, but not with FinalityNotReached." >&2; exit 1
    fi
    echo "$expected_action refused before the finality delay, as expected."
}

# ── Deployment helpers ────────────────────────────────────────────────────────
# Print the image ID of one proof workspace's guest, built the same way the relay will run it.
print_image_id() {
    local workspace="$1"
    local stage="${workspace%_event}"
    stage="${stage//_/-}"
    local output image_id
    if [[ "$PROOF_BACKEND" == "docker" ]]; then
        output="$(cd "$ROOT_DIR" && PROVER_ACTION=print-image-id \
            bash "zk-proofs/risc_zero/$workspace/scripts/prove-$stage-docker.sh" 2>&1)" || {
            echo "$output" >&2; echo "Could not print the $workspace image ID." >&2; exit 1; }
    else
        output="$(cd "$ROOT_DIR/zk-proofs/risc_zero/$workspace" \
            && RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
            cargo run --quiet -p "$stage-proof-host" --bin print_image_id 2>&1)" || {
            echo "$output" >&2; echo "Could not print the $workspace image ID." >&2; exit 1; }
    fi
    image_id="$(printf '%s\n' "$output" | grep -E '^0x[0-9a-fA-F]{64}$' | tail -n1)"
    [[ -n "$image_id" ]] || { echo "$output" >&2; echo "No $workspace image ID in the output." >&2; exit 1; }
    printf '%s' "$image_id"
}

# Image-ID overrides for deploy-prod-full. Real proofs come from this checkout's guests, whose
# IDs can differ from the Makefile defaults; test proofs are SNARKJS and need none.
IMAGE_ID_ARGS=()
collect_image_ids() {
    IMAGE_ID_ARGS=()
    [[ "$PROOF_BACKEND" == "test" ]] && return 0
    local entry workspace variable image_id
    for entry in "${IMAGE_ID_VARIABLES[@]}"; do
        workspace="${entry%%:*}"
        variable="${entry##*:}"
        echo "Building $workspace for its image ID (first build takes a while)..."
        image_id="$(print_image_id "$workspace")"
        echo "  $variable=$image_id"
        IMAGE_ID_ARGS+=("$variable=$image_id")
    done
}

# One `  NAME=value` line from the deploy-prod-full summary.
deployed_value() {
    local output="$1" name="$2" value
    value="$(printf '%s\n' "$output" | sed -n "s/^  $name=\(0x[0-9a-fA-F]\{40\}\)$/\1/p" | tail -n1)"
    [[ -n "$value" ]] || { echo "make deploy-prod-full printed no $name." >&2; exit 1; }
    printf '%s' "$value"
}

# Deploy both sides with `make deploy-prod-full`: adapters, token, connectors, wrapped token and
# the token route on both chains. Addresses from smart-contracts/.env are blanked so nothing is
# reused. Sets SOURCE_CONNECTOR, SOURCE_TOKEN, DEST_CONNECTOR and DEST_TOKEN (the destination's
# BridgeWrappedToken).
deploy_contracts() {
    if [[ "$REUSE_SOURCE_DEPLOYMENTS" == "1" || "$REUSE_DEST_DEPLOYMENTS" == "1" ]]; then
        require_env_value "EXISTING_SOURCE_CONNECTOR" "$EXISTING_SOURCE_CONNECTOR"
        require_env_value "EXISTING_SOURCE_TOKEN" "$EXISTING_SOURCE_TOKEN"
        require_env_value "EXISTING_DEST_CONNECTOR" "$EXISTING_DEST_CONNECTOR"
        require_env_value "EXISTING_DEST_TOKEN" "$EXISTING_DEST_TOKEN"
        SOURCE_CONNECTOR="$EXISTING_SOURCE_CONNECTOR"
        SOURCE_TOKEN="$EXISTING_SOURCE_TOKEN"
        DEST_CONNECTOR="$EXISTING_DEST_CONNECTOR"
        DEST_TOKEN="$EXISTING_DEST_TOKEN"
        echo "Reusing contracts: source connector=$SOURCE_CONNECTOR token=$SOURCE_TOKEN," \
            "dest connector=$DEST_CONNECTOR wrapped token=$DEST_TOKEN"
        return 0
    fi

    collect_image_ids

    echo "Deploying both chains with make deploy-prod-full..."
    local output
    if ! output="$(make -C "$SC_DIR" --no-print-directory deploy-prod-full \
        PRIVATE_KEY="$PRIVATE_KEY" \
        RPC_URL_SOURCE="$SOURCE_RPC" \
        RPC_URL_DEST="$DEST_RPC" \
        REGISTRATION_TIMELOCK=0 \
        AUTO_DETECT_FINALITY=0 \
        ACK_WINDOW_SECONDS_SOURCE="$ACK_WINDOW_SECONDS" \
        ACK_WINDOW_SECONDS_DEST="$ACK_WINDOW_SECONDS" \
        RISC0_ADAPTER_SOURCE= RISC0_ADAPTER_DEST= SNARK_ADAPTER_SOURCE= SNARK_ADAPTER_DEST= \
        SOURCE_TOKEN= SOURCE_CONNECTOR= DEST_CONNECTOR= DEST_WRAPPED_TOKEN= \
        WRAPPED_TOKEN_FACTORY_SOURCE= WRAPPED_TOKEN_FACTORY_DEST= RISC0_VERIFIER= \
        ${IMAGE_ID_ARGS[@]+"${IMAGE_ID_ARGS[@]}"} 2>&1)"; then
        printf '%s\n' "$output" >&2
        echo "make deploy-prod-full failed." >&2; exit 1
    fi

    SOURCE_CONNECTOR="$(deployed_value "$output" SOURCE_CONNECTOR)"
    SOURCE_TOKEN="$(deployed_value "$output" SOURCE_TOKEN)"
    DEST_CONNECTOR="$(deployed_value "$output" DEST_CONNECTOR)"
    DEST_TOKEN="$(deployed_value "$output" DEST_WRAPPED_TOKEN)"
    echo "Source connector: $SOURCE_CONNECTOR  token: $SOURCE_TOKEN"
    echo "Dest connector:   $DEST_CONNECTOR  wrapped token: $DEST_TOKEN"
}

# Propose a connector's finality delay for a remote chain; applied after the timelock.
propose_finality_delay() {
    local rpc_url="$1" connector="$2" remote_chain_id="$3" seconds="$4" tx
    tx="$(send_tx_async "$rpc_url" "$connector" "proposeChainFinalityDelay(uint256,uint64)" "$remote_chain_id" "$seconds")"
    wait_for_tx_receipt_block "$rpc_url" "$tx" >/dev/null
}

apply_finality_delay() {
    local rpc_url="$1" connector="$2" remote_chain_id="$3" seconds="$4" tx stored
    tx="$(send_tx_async "$rpc_url" "$connector" "applyChainFinalityDelay(uint256)" "$remote_chain_id")"
    wait_for_tx_receipt_block "$rpc_url" "$tx" >/dev/null
    stored="$(cast call "$connector" "chainFinalityDelaySeconds(uint256)(uint64)" "$remote_chain_id" --rpc-url "$rpc_url")"
    stored="${stored%% *}"
    if [[ "$stored" != "$seconds" ]]; then
        echo "Connector $connector holds a delay of ${stored}s for chain $remote_chain_id, not ${seconds}s." >&2; exit 1
    fi
}

# Set each connector's finality delay for the other network: propose, move both local clocks
# past the 48 h timelock, apply. A delay of 0 leaves the check off.
set_finality_delays() {
    if [[ "$SOURCE_FINALITY_DELAY" == "0" && "$DEST_FINALITY_DELAY" == "0" ]]; then
        echo "No finality delays requested; the connectors' finality check stays off."
        return 0
    fi
    if [[ "$(profile_time_warp_method "$SOURCE_NETWORK_PROFILE")" == "none" \
        || "$(profile_time_warp_method "$DEST_NETWORK_PROFILE")" == "none" ]]; then
        echo "ERROR: Finality delays wait out a 48 h timelock; only local chain profiles can warp past it." >&2; exit 1
    fi

    [[ "$DEST_FINALITY_DELAY" != "0" ]] && propose_finality_delay "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$DEST_CHAIN_ID" "$DEST_FINALITY_DELAY"
    [[ "$SOURCE_FINALITY_DELAY" != "0" ]] && propose_finality_delay "$DEST_RPC" "$DEST_CONNECTOR" "$SOURCE_CHAIN_ID" "$SOURCE_FINALITY_DELAY"

    echo "Moving both clocks past the ${ADMIN_TIMELOCK_SECONDS}s finality-delay timelock..."
    advance_chain_time "$SOURCE_RPC" "$ADMIN_TIMELOCK_SECONDS"
    advance_chain_time "$DEST_RPC" "$ADMIN_TIMELOCK_SECONDS"

    [[ "$DEST_FINALITY_DELAY" != "0" ]] && apply_finality_delay "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$DEST_CHAIN_ID" "$DEST_FINALITY_DELAY"
    [[ "$SOURCE_FINALITY_DELAY" != "0" ]] && apply_finality_delay "$DEST_RPC" "$DEST_CONNECTOR" "$SOURCE_CHAIN_ID" "$SOURCE_FINALITY_DELAY"
    echo "Finality delays: source connector ${DEST_FINALITY_DELAY}s for chain $DEST_CHAIN_ID," \
        "dest connector ${SOURCE_FINALITY_DELAY}s for chain $SOURCE_CHAIN_ID"
}

# ── Deposit and txId setup ───────────────────────────────────────────────────
# Same as Connector._deriveOriginTxId on the source chain.
compute_tx_id() {
    local sender="$1" receiver="$2" amount="$3" currency_from="$4" currency_to="$5"
    local src_connector="$6" dst_connector="$7" nonce="$8" src_chain_id="$9" dst_chain_id="${10}"
    local encoded
    encoded="$(cast abi-encode "f(address,address,uint256,address,address,address,address,uint256,uint256,uint256)" \
        "$sender" "$receiver" "$amount" "$currency_from" "$currency_to" \
        "$src_connector" "$dst_connector" "$nonce" "$src_chain_id" "$dst_chain_id")"
    cast keccak "$encoded"
}

# ackDeadline: word 11 (0-based) of the 16-word static CrossChainTx returned by getTx.
query_ack_deadline() {
    local rpc_url="$1" connector="$2" tx_id="$3" raw
    raw="$(cast call "$connector" "getTx(bytes32)" "$tx_id" --rpc-url "$rpc_url")"
    cast --to-dec "0x${raw:$((2 + 64 * 11)):64}"
}

# Mint AMOUNT_WEI to the deployer, approve the source connector and lock it for RECEIVER_ADDRESS.
# Sets TX_ID, SOURCE_DEPOSIT_BLOCK and ACK_DEADLINE.
perform_deposit() {
    local nonce mint_tx approve_tx deposit_tx status
    nonce="$(query_tx_nonce "$SOURCE_RPC" "$SOURCE_CONNECTOR")"

    mint_tx="$(send_tx_async "$SOURCE_RPC" "$SOURCE_TOKEN" "mint(address,uint256)" "$DEPLOYER_ADDRESS" "$AMOUNT_WEI")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$mint_tx" >/dev/null
    approve_tx="$(send_tx_async "$SOURCE_RPC" "$SOURCE_TOKEN" "approve(address,uint256)" "$SOURCE_CONNECTOR" "$AMOUNT_WEI")"
    wait_for_tx_receipt_block "$SOURCE_RPC" "$approve_tx" >/dev/null

    deposit_tx="$(send_tx_async "$SOURCE_RPC" "$SOURCE_CONNECTOR" \
        "depositAndLock(address,address,address,uint256,address,uint256)" \
        "$SOURCE_TOKEN" "$DEST_TOKEN" "$RECEIVER_ADDRESS" "$AMOUNT_WEI" "$DEST_CONNECTOR" "$DEST_CHAIN_ID")"
    SOURCE_DEPOSIT_BLOCK="$(wait_for_tx_receipt_block "$SOURCE_RPC" "$deposit_tx")"
    echo "depositAndLock tx: $deposit_tx (block $SOURCE_DEPOSIT_BLOCK)"

    TX_ID="$(compute_tx_id "$DEPLOYER_ADDRESS" "$RECEIVER_ADDRESS" "$AMOUNT_WEI" "$SOURCE_TOKEN" "$DEST_TOKEN" \
        "$SOURCE_CONNECTOR" "$DEST_CONNECTOR" "$nonce" "$SOURCE_CHAIN_ID" "$DEST_CHAIN_ID")"
    status="$(query_tx_status "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
    if [[ "$status" != "1" ]]; then
        echo "Computed txId $TX_ID is not DEPOSIT_LOCKED on the source (status $status)." >&2; exit 1
    fi
    ACK_DEADLINE="$(query_ack_deadline "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$TX_ID")"
    echo "txId: $TX_ID  ackDeadline: $ACK_DEADLINE"
}
