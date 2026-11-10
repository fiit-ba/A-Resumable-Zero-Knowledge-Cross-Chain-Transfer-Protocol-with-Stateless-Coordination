#!/usr/bin/env bash
# scripts/e2e-finality-delays.sh
#
# Propose or apply the finality delays of two deployed connectors on chains that cannot warp
# past the 48 h timelock (every profile but the local ones). The full refund test there takes
# three steps:
#   1. deploy (for example with e2e-happy-path.sh), then run "propose" on the new connectors;
#   2. 48 h later, and within the 7 days after that, run "apply";
#   3. run e2e-non-accept-path.sh / e2e-refund-path.sh on the same contracts
#      (--source-connector, --destination-connector, EXISTING_SOURCE_TOKEN, EXISTING_DEST_TOKEN)
#      with the same delays; they check that the delays are applied.
# As in the refund scripts, each connector holds the delay of the other network.
#
# Usage: see E2E_USAGE below (scripts/e2e-finality-delays.sh --help).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./lib/e2e-common.sh
source "$SCRIPT_DIR/lib/e2e-common.sh"

# ── Usage ───────────────────────────────────────────────────────────────────
export E2E_USAGE="Usage: $0 <propose|apply> [OPTIONS]

Propose or apply the finality delays of two deployed connectors on chains that cannot warp past
the 48 h timelock. Each connector holds the delay of the other network.

  propose   Propose the delays; they can be applied 48 h later
  apply     Apply the proposed delays, 48 h after propose and within the 7 days after that

Network selection (as in e2e-happy-path.sh --help):
  --source-profile <profile>, --destination-profile <profile>
  --source-chain-id <id>, --destination-chain-id <id>
  --source-rpc-url <url>, --destination-rpc-url <url>

Connectors and delays (the same values for propose and apply):
  --source-connector <addr>               Source connector
  --destination-connector <addr>          Destination connector
  --source-finality-delay <seconds>       Source network delay, held by the destination connector
  --destination-finality-delay <seconds>  Destination network delay, held by the source connector

Signing:
  --private-key <hex>                     The connectors' admin key (or set PRIVATE_KEY env var)

Misc:
  -h, --help

Example:
  $0 propose --source-profile sepolia --destination-profile chiado --source-connector 0x... --destination-connector 0x... --source-finality-delay 1200 --destination-finality-delay 1200
"

ACTION="${1:-}"
case "$ACTION" in
    propose|apply)
        shift ;;
    -h|--help)
        echo "$E2E_USAGE"; exit 0 ;;
    *)
        echo "$E2E_USAGE" >&2; exit 1 ;;
esac

e2e_parse_args "$@"
e2e_apply_profile_defaults

require_cmd cast
require_env_value "EXISTING_SOURCE_CONNECTOR (--source-connector)" "$EXISTING_SOURCE_CONNECTOR"
require_env_value "EXISTING_DEST_CONNECTOR (--destination-connector)" "$EXISTING_DEST_CONNECTOR"
if [[ "$SOURCE_FINALITY_DELAY" == "0" && "$DEST_FINALITY_DELAY" == "0" ]]; then
    echo "No finality delays given: use --source-finality-delay and --destination-finality-delay." >&2; exit 1
fi
if [[ "$(cast chain-id --rpc-url "$SOURCE_RPC")" != "$SOURCE_CHAIN_ID" ]]; then
    echo "The source RPC $SOURCE_RPC is not chain $SOURCE_CHAIN_ID." >&2; exit 1
fi
if [[ "$(cast chain-id --rpc-url "$DEST_RPC")" != "$DEST_CHAIN_ID" ]]; then
    echo "The destination RPC $DEST_RPC is not chain $DEST_CHAIN_ID." >&2; exit 1
fi
resolve_private_key

SOURCE_CONNECTOR="$EXISTING_SOURCE_CONNECTOR"
DEST_CONNECTOR="$EXISTING_DEST_CONNECTOR"

if [[ "$ACTION" == "propose" ]]; then
    [[ "$DEST_FINALITY_DELAY" != "0" ]] && propose_finality_delay "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$DEST_CHAIN_ID" "$DEST_FINALITY_DELAY"
    [[ "$SOURCE_FINALITY_DELAY" != "0" ]] && propose_finality_delay "$DEST_RPC" "$DEST_CONNECTOR" "$SOURCE_CHAIN_ID" "$SOURCE_FINALITY_DELAY"
    echo "Proposed: source connector ${DEST_FINALITY_DELAY}s for chain $DEST_CHAIN_ID," \
        "dest connector ${SOURCE_FINALITY_DELAY}s for chain $SOURCE_CHAIN_ID."
    echo "Run '$0 apply' with the same options after 48 h and within the 7 days after that."
else
    [[ "$DEST_FINALITY_DELAY" != "0" ]] && apply_finality_delay "$SOURCE_RPC" "$SOURCE_CONNECTOR" "$DEST_CHAIN_ID" "$DEST_FINALITY_DELAY"
    [[ "$SOURCE_FINALITY_DELAY" != "0" ]] && apply_finality_delay "$DEST_RPC" "$DEST_CONNECTOR" "$SOURCE_CHAIN_ID" "$SOURCE_FINALITY_DELAY"
    echo "Delays in place: source connector ${DEST_FINALITY_DELAY}s for chain $DEST_CHAIN_ID," \
        "dest connector ${SOURCE_FINALITY_DELAY}s for chain $SOURCE_CHAIN_ID."
fi
