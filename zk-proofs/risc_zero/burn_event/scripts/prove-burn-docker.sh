#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RZ_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$RZ_DIR/../.." && pwd)"

PROVER_ACTION="${PROVER_ACTION:-prove}"
DOCKER_IMAGE="${DOCKER_IMAGE:-risc0-burn-proof-prover:latest}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
DOCKER_REBUILD="${DOCKER_REBUILD:-0}"
DOCKER_CACHE_VOLUME="${DOCKER_CACHE_VOLUME:-risc0-burn-proof-cache}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-$RZ_DIR/Dockerfile.prover}"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

map_rpc_for_docker() {
    local rpc="$1"
    if [[ "$rpc" =~ ^https?://(127\.0\.0\.1|localhost)(:|/|$) ]]; then
        echo "${rpc/localhost/host.docker.internal}" | sed 's#127\.0\.0\.1#host.docker.internal#'
    else
        echo "$rpc"
    fi
}

require_cmd docker

case "$DOCKER_PLATFORM" in
    linux/arm64|linux/aarch64)
        echo "DOCKER_PLATFORM=$DOCKER_PLATFORM is not supported by rzup (linux/aarch64)." >&2
        echo "Falling back to DOCKER_PLATFORM=linux/amd64 for RISC Zero toolchain compatibility." >&2
        DOCKER_PLATFORM="linux/amd64"
        ;;
esac

DOCKER_BUILD_ARGS=(build)
DOCKER_RUN_ARGS=(
    run
    --rm
    --add-host
    host.docker.internal:host-gateway
    -v
    "$ROOT_DIR:/workspace:ro"
    -v
    "$DOCKER_CACHE_VOLUME:/cache"
    -e
    CARGO_HOME=/cache/cargo
    -e
    CARGO_TARGET_DIR=/cache/target
    -w
    /workspace/risc_zero
)

if [[ -n "$DOCKER_PLATFORM" ]]; then
    DOCKER_BUILD_ARGS+=(--platform "$DOCKER_PLATFORM")
    DOCKER_RUN_ARGS+=(--platform "$DOCKER_PLATFORM")
fi
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    DOCKER_BUILD_ARGS+=(--build-arg "GITHUB_TOKEN=$GITHUB_TOKEN")
fi
DOCKER_BUILD_ARGS+=(-f "$DOCKERFILE_PATH" -t "$DOCKER_IMAGE" "$RZ_DIR")

case "$PROVER_ACTION" in
    print-image-id)
        ;;
    prove)
        : "${RPC_URL:?RPC_URL is required for PROVER_ACTION=prove}"
        : "${CONNECTOR:?CONNECTOR is required for PROVER_ACTION=prove}"
        : "${TX_ID:?TX_ID is required for PROVER_ACTION=prove}"
        : "${DEST_CHAIN_ID:?DEST_CHAIN_ID is required for PROVER_ACTION=prove}"

        EXECUTION_BLOCK="${EXECUTION_BLOCK:-latest}"
        RISC0_PROVER_MODE="${RISC0_PROVER_MODE:-local}"
        DOCKER_RPC_URL="$(map_rpc_for_docker "$RPC_URL")"

        ;;
    *)
        echo "Unsupported PROVER_ACTION: $PROVER_ACTION (expected: prove | print-image-id)" >&2
        exit 1
        ;;
esac

if [[ "$DOCKER_REBUILD" == "1" ]] || ! docker image inspect "$DOCKER_IMAGE" >/dev/null 2>&1; then
    NEED_BUILD=1
else
    NEED_BUILD=0
fi

if [[ "$NEED_BUILD" -eq 0 ]] && [[ -n "$DOCKER_PLATFORM" ]]; then
    TARGET_ARCH="$(printf '%s' "$DOCKER_PLATFORM" | cut -d/ -f2)"
    LOCAL_ARCH="$(docker image inspect "$DOCKER_IMAGE" --format '{{.Architecture}}' 2>/dev/null || true)"
    if [[ -n "$TARGET_ARCH" ]] && [[ -n "$LOCAL_ARCH" ]] && [[ "$TARGET_ARCH" != "$LOCAL_ARCH" ]]; then
        echo "Local image arch '$LOCAL_ARCH' does not match requested '$TARGET_ARCH'; rebuilding." >&2
        NEED_BUILD=1
    fi
fi

if [[ "$NEED_BUILD" -eq 1 ]]; then
    echo "Building prover Docker image: $DOCKER_IMAGE (platform: $DOCKER_PLATFORM)" >&2
    docker "${DOCKER_BUILD_ARGS[@]}"
else
    echo "Using prover Docker image: $DOCKER_IMAGE (platform: $DOCKER_PLATFORM)" >&2
fi

if [[ "$PROVER_ACTION" == "print-image-id" ]]; then
    echo "Running image-id helper in Docker..." >&2
    docker "${DOCKER_RUN_ARGS[@]}" \
        "$DOCKER_IMAGE" \
        cargo run -q --manifest-path /workspace/risc_zero/burn_event/Cargo.toml -p burn-proof-host --bin print_image_id
else
    echo "Running proof generation in Docker..." >&2
    docker "${DOCKER_RUN_ARGS[@]}" \
        -e "RISC0_PROVER=$RISC0_PROVER_MODE" \
        -e "RPC_URL=$DOCKER_RPC_URL" \
        -e "EXECUTION_BLOCK=$EXECUTION_BLOCK" \
        "$DOCKER_IMAGE" \
        cargo run --manifest-path /workspace/risc_zero/burn_event/Cargo.toml -p burn-proof-host --bin burn-proof-host -- \
            --connector "$CONNECTOR" \
            --tx-id "$TX_ID" \
            --dest-chain-id "$DEST_CHAIN_ID"
fi
