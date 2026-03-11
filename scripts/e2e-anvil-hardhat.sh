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

RZ_DIR="$ROOT_DIR/zk-proofs/risc_zero/lock_event"

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
LOCK_PROOF_GAS_LIMIT="${LOCK_PROOF_GAS_LIMIT:-12000000}"
RISC0_PROVER_MODE="${RISC0_PROVER_MODE:-local}"
USE_DOCKER_PROVER="${USE_DOCKER_PROVER:-0}"
DOCKER_PROVER_SCRIPT="${DOCKER_PROVER_SCRIPT:-$RZ_DIR/scripts/prove-lock-docker.sh}"
RISC0_GUEST_USE_DOCKER="${RISC0_GUEST_USE_DOCKER:-1}"

# RISC Zero Groth16 verifier params from risc0-ethereum ControlID.sol.
CONTROL_ROOT="0xa54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56"
BN254_CONTROL_ID="0x04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0"
SOURCE_DUMMY_IMAGE_ID="0x0000000000000000000000000000000000000000000000000000000000000001"

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
    if [[ ! -f "$DOCKER_PROVER_SCRIPT" ]]; then
        echo "Docker prover script not found: $DOCKER_PROVER_SCRIPT" >&2
        exit 1
    fi
    IMAGE_ID="$(
        cd "$ROOT_DIR"
        PROVER_ACTION=print-image-id \
        bash "$DOCKER_PROVER_SCRIPT"
    )"
else
    (
        cd "$RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo build -p lock-proof-host --bin print_image_id >/dev/null
    )

    IMAGE_ID="$(
        cd "$RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        cargo run -q -p lock-proof-host --bin print_image_id
    )"
fi
echo "Guest image ID: $IMAGE_ID"

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
        --constructor-args "$DEST_RISC0_VERIFIER" "$IMAGE_ID"
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

echo "Deploying source chain contracts..."
SOURCE_MOCK_RISC0_VERIFIER="$(
    deploy_contract \
        "$SOURCE_RPC" \
        "script/Connector.s.sol:MockRiscZeroVerifier"
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
        --constructor-args "$SOURCE_MOCK_RISC0_VERIFIER" "$SOURCE_DUMMY_IMAGE_ID"
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
    "$SOURCE_TOKEN" \
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
        "$SOURCE_TOKEN" \
        "$SOURCE_CONNECTOR" \
        "$DEST_CONNECTOR" \
        0
)"
echo "Computed txId: $TX_ID"

echo "Generating RISC Zero proof..."
echo "Proof generation can take several minutes on first run."
PROOF_LOG="$(mktemp)"
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
        bash "$DOCKER_PROVER_SCRIPT"
    ) 2>&1 | tee "$PROOF_LOG"
    PROOF_STATUS=${PIPESTATUS[0]}
else
    (
        cd "$RZ_DIR"
        RISC0_GUEST_USE_DOCKER="$RISC0_GUEST_USE_DOCKER" \
        RISC0_PROVER="$RISC0_PROVER_MODE" \
        RPC_URL="$SOURCE_RPC" \
        EXECUTION_BLOCK="$EXECUTION_BLOCK" \
        cargo run -p lock-proof-host --bin lock-proof-host -- \
            --connector "$SOURCE_CONNECTOR" \
            --tx-id "$TX_ID" \
            --source-chain-id "$SOURCE_CHAIN_ID" \
            --destination-chain-id "$DEST_CHAIN_ID"
    ) 2>&1 | tee "$PROOF_LOG"
    PROOF_STATUS=${PIPESTATUS[0]}
fi
set -e
if [[ "$PROOF_STATUS" -ne 0 ]]; then
    echo "Proof generation failed." >&2
    rm -f "$PROOF_LOG"
    exit "$PROOF_STATUS"
fi
PROOF_OUTPUT="$(cat "$PROOF_LOG")"
rm -f "$PROOF_LOG"

PROOF_PAYLOAD="$(extract_proof_value "$PROOF_OUTPUT" "proofPayload")"
PROOF_TX_ID="$(extract_proof_value "$PROOF_OUTPUT" "txId")"
PROOF_AMOUNT="$(extract_proof_value "$PROOF_OUTPUT" "amount")"
PROOF_SENDER="$(extract_proof_value "$PROOF_OUTPUT" "sender")"
PROOF_RECEIVER="$(extract_proof_value "$PROOF_OUTPUT" "receiver")"
PROOF_CURRENCY_FROM="$(extract_proof_value "$PROOF_OUTPUT" "currencyFrom")"
PROOF_CURRENCY_TO="$(extract_proof_value "$PROOF_OUTPUT" "currencyTo")"
PROOF_SRC_CONNECTOR="$(extract_proof_value "$PROOF_OUTPUT" "srcChainConnector")"
PROOF_ORIGIN_ACK_DEADLINE="$(extract_proof_value "$PROOF_OUTPUT" "originAckDeadline")"
PROOF_NONCE="$(extract_proof_value "$PROOF_OUTPUT" "nonce")"
PROOF_SOURCE_CHAIN_ID="$(extract_proof_value "$PROOF_OUTPUT" "sourceChainId")"
PROOF_DEST_CHAIN_ID="$(extract_proof_value "$PROOF_OUTPUT" "destChainId")"

if [[ "$(to_lower "$PROOF_TX_ID")" != "$(to_lower "$TX_ID")" ]]; then
    echo "Proof txId mismatch: expected $TX_ID, got $PROOF_TX_ID" >&2
    exit 1
fi
if [[ "$PROOF_DEST_CHAIN_ID" != "$DEST_CHAIN_ID" ]]; then
    echo "Proof destination chain id mismatch: expected $DEST_CHAIN_ID, got $PROOF_DEST_CHAIN_ID" >&2
    exit 1
fi

echo "Submitting lock proof on destination chain..."
cast send \
    "$DEST_CONNECTOR" \
    "submitLockProof(uint8,bytes,bytes32,uint256,address,address,address,address,address,uint64,uint256,uint256)" \
    0 \
    "$PROOF_PAYLOAD" \
    "$TX_ID" \
    "$PROOF_AMOUNT" \
    "$PROOF_CURRENCY_FROM" \
    "$PROOF_CURRENCY_TO" \
    "$PROOF_SENDER" \
    "$PROOF_RECEIVER" \
    "$PROOF_SRC_CONNECTOR" \
    "$PROOF_ORIGIN_ACK_DEADLINE" \
    "$PROOF_NONCE" \
    "$PROOF_SOURCE_CHAIN_ID" \
    --gas-limit "$LOCK_PROOF_GAS_LIMIT" \
    --rpc-url "$DEST_RPC" \
    --private-key "$PRIVATE_KEY" >/dev/null

DEST_STATUS=""
set +e
DEST_STATUS="$(cast call "$DEST_CONNECTOR" "txStatus(bytes32)(uint8)" "$TX_ID" --rpc-url "$DEST_RPC" 2>/tmp/cast_txstatus_err.log)"
TXSTATUS_RC=$?
set -e
if [[ "$TXSTATUS_RC" -ne 0 ]]; then
    echo "Warning: failed to query destination tx status via cast call." >&2
    echo "Hardhat returned a JSON parse error; lock proof submission transaction may still be successful." >&2
    if [[ -f /tmp/cast_txstatus_err.log ]]; then
        tail -n1 /tmp/cast_txstatus_err.log >&2 || true
    fi
    CALLDATA="$(cast calldata "txStatus(bytes32)" "$TX_ID")"
    RPC_PAYLOAD="$(printf '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"]}' "$DEST_CONNECTOR" "$CALLDATA")"
    RPC_RESULT="$(curl -sS -H "content-type: application/json" --data "$RPC_PAYLOAD" "$DEST_RPC" || true)"
    RAW_STATUS="$(printf '%s' "$RPC_RESULT" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"
    if [[ -n "$RAW_STATUS" ]]; then
        DEST_STATUS="$(cast --to-dec "$RAW_STATUS")"
    else
        DEST_STATUS="unknown (status query failed)"
    fi
fi
rm -f /tmp/cast_txstatus_err.log

echo
echo "Done."
echo "sourceConnector: $SOURCE_CONNECTOR"
echo "destConnector:   $DEST_CONNECTOR"
echo "sourceToken:     $SOURCE_TOKEN"
echo "imageId:         $IMAGE_ID"
echo "proofPayload:    $PROOF_PAYLOAD"
echo "destination txStatus(txId): $DEST_STATUS (expected 4 for MINTED_IN_HOLDING)"
