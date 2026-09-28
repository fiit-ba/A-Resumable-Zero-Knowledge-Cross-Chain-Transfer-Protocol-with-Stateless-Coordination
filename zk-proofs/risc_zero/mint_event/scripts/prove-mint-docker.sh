#!/usr/bin/env bash
# Proves FundsReleased (mint stage, submitted on the origin) inside Docker.
# Set PROVER_ACTION=print-image-id to print the guest image ID instead.
# Shared behaviour and environment variables: ../../scripts/docker-prover.sh
set -euo pipefail

# shellcheck source=../../scripts/docker-prover.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/docker-prover.sh"

prover_init mint_event mint-proof-host
prover_resolve_dest_chain_id
prover_run \
    --destination-chain-id "${DEST_ID:-}"
