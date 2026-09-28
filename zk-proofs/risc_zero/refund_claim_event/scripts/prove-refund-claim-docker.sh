#!/usr/bin/env bash
# Proves RefundClaimed (refund-claim stage, submitted on the destination) inside Docker.
# Set PROVER_ACTION=print-image-id to print the guest image ID instead.
# Shared behaviour and environment variables: ../../scripts/docker-prover.sh
set -euo pipefail

# shellcheck source=../../scripts/docker-prover.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/docker-prover.sh"

prover_init refund_claim_event refund-claim-proof-host
prover_require_env SOURCE_CHAIN_ID
prover_run \
    --source-chain-id "${SOURCE_CHAIN_ID:-}"
