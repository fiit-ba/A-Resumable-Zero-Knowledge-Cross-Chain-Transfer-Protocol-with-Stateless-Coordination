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

SOURCE_RPC="${SOURCE_RPC:-http://127.0.0.1:8545}"
DEST_RPC="${DEST_RPC:-http://127.0.0.1:8546}"
SOURCE_CHAIN_ID="${SOURCE_CHAIN_ID:-31337}"
DEST_CHAIN_ID="${DEST_CHAIN_ID:-31338}"

PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
ACK_WINDOW_SECONDS="${ACK_WINDOW_SECONDS:-3600}"
AMOUNT_WEI="${AMOUNT_WEI:-1000000000000000000}" # 1 token with 18 decimals
EXECUTION_BLOCK="${EXECUTION_BLOCK:-latest}"
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

# RISC Zero Groth16 verifier params from risc0-ethereum ControlID.sol.
CONTROL_ROOT="0xa54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56"
BN254_CONTROL_ID="0x04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

deploy_contract() {
    local rpc_url="$1"
    shift

    local output address
    output="$(
        cd "$SC_DIR"
        forge create --broadcast --rpc-url "$rpc_url" --private-key "$PRIVATE_KEY" "$@"
    )"
    echo "$output" >&2

    address="$(echo "$output" | awk '/Deployed to:/ {print $3}' | tail -n1)"
    if [[ -z "$address" ]]; then
        echo "Failed to parse deployed address from forge output." >&2
        exit 1
    fi
    printf '%s' "$address"
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

require_cmd cast
require_cmd forge
require_cmd awk
require_cmd tr
require_cmd curl
require_cmd sed
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    require_cmd docker
else
    require_cmd cargo
    if [[ "$RISC0_GUEST_USE_DOCKER" == "1" ]]; then
        require_cmd docker
    fi
fi

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
echo "Source RPC: $SOURCE_RPC (chain $SOURCE_CHAIN_ID)"
echo "Dest RPC: $DEST_RPC (chain $DEST_CHAIN_ID)"
echo "RISC0 prover: $RISC0_PROVER_MODE"
echo "Docker prover: $USE_DOCKER_PROVER"
echo "RISC0 guest docker build: $RISC0_GUEST_USE_DOCKER"

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
        --constructor-args "$DEST_RISC0_VERIFIER" "$LOCK_IMAGE_ID"
)"
DEST_ACK_RISC0_ADAPTER="$(
    deploy_contract \
        "$DEST_RPC" \
        "src/zk-proof/adapters/RiscZeroAdapter.sol:RiscZeroAdapter" \
        --constructor-args "$DEST_RISC0_VERIFIER" "$ACK_IMAGE_ID"
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
        --constructor-args "$DEST_RISC0_ADAPTER" "$DEST_SNARK_ADAPTER" "$ACK_WINDOW_SECONDS"
)"
DEST_TOKEN="$(
    deploy_contract \
        "$DEST_RPC" \
        "script/MockERC20.s.sol:MockERC20" \
        --constructor-args "$DEST_TOKEN_NAME" "$DEST_TOKEN_SYMBOL"
)"

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
        --constructor-args "$SOURCE_RISC0_VERIFIER" "$MINT_IMAGE_ID"
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
        --constructor-args "$SOURCE_RISC0_ADAPTER" "$SOURCE_SNARK_ADAPTER" "$ACK_WINDOW_SECONDS"
)"
SOURCE_TOKEN="$(
    deploy_contract \
        "$SOURCE_RPC" \
        "script/MockERC20.s.sol:MockERC20" \
        --constructor-args "$TOKEN_NAME" "$TOKEN_SYMBOL"
)"

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

cast send \
    "$SOURCE_CONNECTOR" \
    "depositAndLock(address,address,address,uint256,address)" \
    "$SOURCE_TOKEN" \
    "$DEST_TOKEN" \
    "$DEPLOYER_ADDRESS" \
    "$AMOUNT_WEI" \
    "$DEST_CONNECTOR" \
    --rpc-url "$SOURCE_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

TX_ID="$(
    compute_tx_id \
        "$DEPLOYER_ADDRESS" \
        "$DEPLOYER_ADDRESS" \
        "$AMOUNT_WEI" \
        "$SOURCE_TOKEN" \
        "$DEST_TOKEN" \
        "$SOURCE_CONNECTOR" \
        "$DEST_CONNECTOR" \
        0
)"
echo "Computed txId: $TX_ID"

echo "Generating RISC Zero lock proof..."
echo "Proof generation can take several minutes on first run."
LOCK_PROOF_LOG="$(mktemp)"
set +e
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    (
        cd "$ROOT_DIR"
        PROVER_ACTION=prove \
        RISC0_PROVER_MODE="$RISC0_PROVER_MODE" \
        RPC_URL="$SOURCE_RPC" \
        EXECUTION_BLOCK="$EXECUTION_BLOCK" \
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
        EXECUTION_BLOCK="$EXECUTION_BLOCK" \
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
cast send \
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
    --gas-limit "$LOCK_PROOF_GAS_LIMIT" \
    --rpc-url "$DEST_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

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

echo "Generating RISC Zero mint proof from destination FundsReleased..."
MINT_PROOF_LOG="$(mktemp)"
set +e
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    (
        cd "$ROOT_DIR"
        PROVER_ACTION=prove \
        RISC0_PROVER_MODE="$RISC0_PROVER_MODE" \
        RPC_URL="$DEST_RPC" \
        EXECUTION_BLOCK="$EXECUTION_BLOCK" \
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
        EXECUTION_BLOCK="$EXECUTION_BLOCK" \
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
cast send \
    "$SOURCE_CONNECTOR" \
    "submitMintProof(uint8,bytes,bytes32)" \
    0 \
    "$MINT_PROOF_PAYLOAD" \
    "$TX_ID" \
    --gas-limit "$MINT_PROOF_GAS_LIMIT" \
    --rpc-url "$SOURCE_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

if [[ "$DEST_STATUS" != "4" && "$DEST_STATUS" != unknown* ]]; then
    echo "Destination tx status mismatch: expected 4 (MINTED_IN_HOLDING), got $DEST_STATUS" >&2
    exit 1
fi

echo "Switching destination RISC0 verifier to ack image adapter..."
cast send \
    "$DEST_CONNECTOR" \
    "setVerifier(uint8,address)" \
    0 \
    "$DEST_ACK_RISC0_ADAPTER" \
    --gas-limit "$SET_VERIFIER_GAS_LIMIT" \
    --rpc-url "$DEST_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

echo "Generating RISC Zero ack proof from source AckReady..."
ACK_PROOF_LOG="$(mktemp)"
set +e
if [[ "$USE_DOCKER_PROVER" == "1" ]]; then
    (
        cd "$ROOT_DIR"
        PROVER_ACTION=prove \
        RISC0_PROVER_MODE="$RISC0_PROVER_MODE" \
        RPC_URL="$SOURCE_RPC" \
        EXECUTION_BLOCK="$EXECUTION_BLOCK" \
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
        EXECUTION_BLOCK="$EXECUTION_BLOCK" \
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
