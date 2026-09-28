#!/usr/bin/env bash
# Proves DestTxClosed (burn-proof stage, submitted on the origin) inside Docker.
# Set PROVER_ACTION=print-image-id to print the guest image ID instead.
# Shared behaviour and environment variables: ../../scripts/docker-prover.sh
set -euo pipefail

# shellcheck source=../../scripts/docker-prover.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/docker-prover.sh"

prover_init burn_event burn-proof-host
prover_require_env SOURCE_CHAIN_ID DEST_CHAIN_ID
prover_run \
    --source-chain-id "${SOURCE_CHAIN_ID:-}" \
    --dest-chain-id "${DEST_CHAIN_ID:-}"
