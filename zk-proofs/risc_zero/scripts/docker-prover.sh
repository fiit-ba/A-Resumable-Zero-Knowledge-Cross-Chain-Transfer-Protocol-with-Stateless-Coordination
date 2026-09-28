#!/usr/bin/env bash
# Shared implementation of the per-workspace `*/scripts/prove-*-docker.sh` wrappers.
#
# Builds (once) a Docker image containing the RISC Zero toolchain, then runs a
# proof host inside it with the repository mounted read-only at /workspace and a
# persistent cargo cache volume. The workspaces depend on risc0-ethereum from
# smart-contracts/lib, so run `make install` in smart-contracts/ first.
# Wrappers source this file and call, in order:
#
#   prover_init <workspace-dir> <host-package>   defaults + common validation
#   prover_require_env VAR...                     stage-specific inputs (prove only)
#   prover_resolve_dest_chain_id                  sets DEST_ID from DEST_CHAIN_ID
#                                                 or DESTINATION_CHAIN_ID (prove only)
#   prover_run [host args...]                     build image if needed, then run
#
# Environment:
#   PROVER_ACTION        prove (default) | print-image-id
#   RPC_URL, CONNECTOR, TX_ID
#                        required for prove; localhost RPCs are rewritten to
#                        host.docker.internal so the container can reach them
#   EXECUTION_BLOCK      block the proof is anchored to (default: latest)
#   RISC0_PROVER_MODE    local (default) | bonsai
#   DOCKER_IMAGE         default: risc0-<stage>-proof-prover:latest
#   DOCKER_CACHE_VOLUME  default: risc0-<stage>-proof-cache
#   DOCKER_PLATFORM      default: linux/amd64 (rzup does not support linux/aarch64)
#   DOCKER_REBUILD       1 forces an image rebuild
#   DOCKERFILE_PATH      default: zk-proofs/risc_zero/Dockerfile.prover
#   GITHUB_TOKEN         optional; forwarded as a build arg to avoid rate limits

RISC0_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$RISC0_DIR/../.." && pwd)"

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

prover_init() {
    WORKSPACE="$1"
    HOST_PACKAGE="$2"
    local stage_slug="${HOST_PACKAGE%-host}" # e.g. lock-proof-host -> lock-proof
    local workspace_dir="$RISC0_DIR/$WORKSPACE"

    PROVER_ACTION="${PROVER_ACTION:-prove}"
    DOCKER_IMAGE="${DOCKER_IMAGE:-risc0-${stage_slug}-prover:latest}"
    DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
    DOCKER_REBUILD="${DOCKER_REBUILD:-0}"
    DOCKER_CACHE_VOLUME="${DOCKER_CACHE_VOLUME:-risc0-${stage_slug}-cache}"
    DOCKERFILE_PATH="${DOCKERFILE_PATH:-$RISC0_DIR/Dockerfile.prover}"

    require_cmd docker
    if [[ ! -f "$REPO_ROOT/smart-contracts/lib/risc0-ethereum/contracts/Cargo.toml" ]]; then
        echo "Missing smart-contracts/lib/risc0-ethereum; run 'make install' in smart-contracts/ first." >&2
        exit 1
    fi

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
        "$REPO_ROOT:/workspace:ro"
        -v
        "$DOCKER_CACHE_VOLUME:/cache"
        -e
        CARGO_HOME=/cache/cargo
        -e
        CARGO_TARGET_DIR=/cache/target
        -w
        /workspace/zk-proofs/risc_zero
    )

    if [[ -n "$DOCKER_PLATFORM" ]]; then
        DOCKER_BUILD_ARGS+=(--platform "$DOCKER_PLATFORM")
        DOCKER_RUN_ARGS+=(--platform "$DOCKER_PLATFORM")
    fi
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        DOCKER_BUILD_ARGS+=(--build-arg "GITHUB_TOKEN=$GITHUB_TOKEN")
    fi
    DOCKER_BUILD_ARGS+=(-f "$DOCKERFILE_PATH" -t "$DOCKER_IMAGE" "$workspace_dir")

    case "$PROVER_ACTION" in
        print-image-id)
            ;;
        prove)
            prover_require_env RPC_URL CONNECTOR TX_ID
            EXECUTION_BLOCK="${EXECUTION_BLOCK:-latest}"
            RISC0_PROVER_MODE="${RISC0_PROVER_MODE:-local}"
            DOCKER_RPC_URL="$(map_rpc_for_docker "$RPC_URL")"
            ;;
        *)
            echo "Unsupported PROVER_ACTION: $PROVER_ACTION (expected: prove | print-image-id)" >&2
            exit 1
            ;;
    esac
}

prover_require_env() {
    [[ "$PROVER_ACTION" == "prove" ]] || return 0
    local name
    for name in "$@"; do
        if [[ -z "${!name:-}" ]]; then
            echo "$name is required for PROVER_ACTION=prove" >&2
            exit 1
        fi
    done
}

prover_resolve_dest_chain_id() {
    [[ "$PROVER_ACTION" == "prove" ]] || return 0
    DEST_ID="${DEST_CHAIN_ID:-${DESTINATION_CHAIN_ID:-}}"
    if [[ -z "$DEST_ID" ]]; then
        echo "DEST_CHAIN_ID or DESTINATION_CHAIN_ID is required for PROVER_ACTION=prove" >&2
        exit 1
    fi
}

prover_build_image_if_needed() {
    local need_build=0
    if [[ "$DOCKER_REBUILD" == "1" ]] || ! docker image inspect "$DOCKER_IMAGE" >/dev/null 2>&1; then
        need_build=1
    fi

    if [[ "$need_build" -eq 0 ]] && [[ -n "$DOCKER_PLATFORM" ]]; then
        local target_arch local_arch
        target_arch="$(printf '%s' "$DOCKER_PLATFORM" | cut -d/ -f2)"
        local_arch="$(docker image inspect "$DOCKER_IMAGE" --format '{{.Architecture}}' 2>/dev/null || true)"
        if [[ -n "$target_arch" ]] && [[ -n "$local_arch" ]] && [[ "$target_arch" != "$local_arch" ]]; then
            echo "Local image arch '$local_arch' does not match requested '$target_arch'; rebuilding." >&2
            need_build=1
        fi
    fi

    if [[ "$need_build" -eq 1 ]]; then
        echo "Building prover Docker image: $DOCKER_IMAGE (platform: $DOCKER_PLATFORM)" >&2
        docker "${DOCKER_BUILD_ARGS[@]}"
    else
        echo "Using prover Docker image: $DOCKER_IMAGE (platform: $DOCKER_PLATFORM)" >&2
    fi
}

# Host args are ignored for print-image-id.
prover_run() {
    prover_build_image_if_needed

    local manifest="/workspace/zk-proofs/risc_zero/$WORKSPACE/Cargo.toml"
    if [[ "$PROVER_ACTION" == "print-image-id" ]]; then
        echo "Running image-id helper in Docker..." >&2
        docker "${DOCKER_RUN_ARGS[@]}" \
            "$DOCKER_IMAGE" \
            cargo run -q --manifest-path "$manifest" -p "$HOST_PACKAGE" --bin print_image_id
    else
        echo "Running proof generation in Docker..." >&2
        docker "${DOCKER_RUN_ARGS[@]}" \
            -e "RISC0_PROVER=$RISC0_PROVER_MODE" \
            -e "RPC_URL=$DOCKER_RPC_URL" \
            -e "EXECUTION_BLOCK=$EXECUTION_BLOCK" \
            "$DOCKER_IMAGE" \
            cargo run --manifest-path "$manifest" -p "$HOST_PACKAGE" --bin "$HOST_PACKAGE" -- \
                --connector "$CONNECTOR" \
                --tx-id "$TX_ID" \
                "$@"
    fi
}
