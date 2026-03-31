#!/usr/bin/env bash
# hue-pair.sh — One-time Hue bridge pairing and resource discovery for PFx
#
# Usage:
#   ./scripts/hue-pair.sh [bridge-ip]
#
# If bridge-ip is omitted, the script discovers bridges via discovery.meethue.com.
# Requires: curl, jq

set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BLD='\033[1m'
RST='\033[0m'

# ─── helpers ──────────────────────────────────────────────────────────────────

die()  { echo -e "${RED}ERROR: $*${RST}" >&2; exit 1; }
info() { echo -e "${GRN}▶ $*${RST}"; }
warn() { echo -e "${YLW}⚠  $*${RST}"; }
bold() { echo -e "${BLD}$*${RST}"; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed (apt install $1)"
}

require_cmd curl
require_cmd jq

BRIDGE_IP="${1:-}"

# ─── discover bridge if no IP provided ───────────────────────────────────────

if [[ -z "$BRIDGE_IP" ]]; then
    info "No bridge IP provided — querying https://discovery.meethue.com ..."
    DISCOVERY_JSON=$(curl -sSf --max-time 10 "https://discovery.meethue.com" 2>/dev/null || echo "[]")
    BRIDGE_COUNT=$(echo "$DISCOVERY_JSON" | jq 'length')

    if [[ "$BRIDGE_COUNT" -eq 0 ]]; then
        # Fallback: mDNS via avahi if available
        if command -v avahi-browse >/dev/null 2>&1; then
            warn "discovery.meethue.com returned no bridges. Trying mDNS (avahi)..."
            MDNS_RESULT=$(avahi-browse -r -t _hue._tcp 2>/dev/null | grep "address\|hostname" | head -20 || true)
            echo "$MDNS_RESULT"
        fi
        die "No Hue bridges found. Supply the bridge IP as an argument: $0 <bridge-ip>"
    fi

    if [[ "$BRIDGE_COUNT" -eq 1 ]]; then
        BRIDGE_IP=$(echo "$DISCOVERY_JSON" | jq -r '.[0].internalipaddress')
        info "Found bridge at ${BRIDGE_IP}"
    else
        echo ""
        bold "Multiple bridges found:"
        for i in $(seq 0 $((BRIDGE_COUNT - 1))); do
            IP=$(echo "$DISCOVERY_JSON" | jq -r ".[$i].internalipaddress")
            ID=$(echo "$DISCOVERY_JSON" | jq -r ".[$i].id")
            echo "  $((i+1))) ${IP}  (id: ${ID})"
        done
        echo ""
        read -rp "Select bridge [1-${BRIDGE_COUNT}]: " SELECTION
        IDX=$((SELECTION - 1))
        BRIDGE_IP=$(echo "$DISCOVERY_JSON" | jq -r ".[$IDX].internalipaddress")
    fi
fi

# ─── verify plain HTTP connectivity ──────────────────────────────────────────

info "Checking bridge at ${BRIDGE_IP} ..."
CONFIG_JSON=$(curl -sSf --max-time 5 "http://${BRIDGE_IP}/api/0/config" 2>/dev/null) \
    || die "Cannot reach bridge at http://${BRIDGE_IP} — check the IP and that the bridge is on the same network"

BRIDGE_ID=$(echo "$CONFIG_JSON" | jq -r '.bridgeid // "unknown"')
BRIDGE_NAME=$(echo "$CONFIG_JSON" | jq -r '.name // "unknown"')
SW_VERSION=$(echo "$CONFIG_JSON" | jq -r '.swversion // "unknown"')

info "Bridge found: ${BRIDGE_NAME} (id=${BRIDGE_ID}, sw=${SW_VERSION})"

# ─── link-button pairing ─────────────────────────────────────────────────────

echo ""
bold "=== PAIRING STEP ==="
echo ""
echo "  1. Press the round link button on top of the Hue bridge NOW."
echo "  2. Press Enter within 30 seconds."
echo ""
read -rp "  Press Enter after pressing the bridge button: "

PAIR_RESPONSE=$(curl -ksSf --max-time 10 \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"devicetype":"paradoxfx#pfx","generateclientkey":true}' \
    "https://${BRIDGE_IP}/api" 2>/dev/null) \
    || die "HTTPS request to bridge failed. Check that the bridge is reachable at https://${BRIDGE_IP}"

# Check for link-button error
if echo "$PAIR_RESPONSE" | jq -e '.[0].error' >/dev/null 2>&1; then
    ERR_DESC=$(echo "$PAIR_RESPONSE" | jq -r '.[0].error.description')
    die "Pairing failed: ${ERR_DESC}. Press the button on the bridge first, then re-run the script."
fi

APP_KEY=$(echo "$PAIR_RESPONSE" | jq -r '.[0].success.username // empty')
CLIENT_KEY=$(echo "$PAIR_RESPONSE" | jq -r '.[0].success.clientkey // empty')

[[ -n "$APP_KEY" ]] || die "Could not extract app key from response: ${PAIR_RESPONSE}"

info "Pairing successful — app key obtained."

# ─── discover rooms ──────────────────────────────────────────────────────────

info "Querying rooms ..."
ROOMS_JSON=$(curl -ksSf --max-time 10 \
    -H "hue-application-key: ${APP_KEY}" \
    "https://${BRIDGE_IP}/clip/v2/resource/room") \
    || die "Failed to query rooms"

ROOM_COUNT=$(echo "$ROOMS_JSON" | jq '.data | length')

info "Querying zones ..."
ZONES_JSON=$(curl -ksSf --max-time 10 \
    -H "hue-application-key: ${APP_KEY}" \
    "https://${BRIDGE_IP}/clip/v2/resource/zone") \
    || die "Failed to query zones"

ZONE_COUNT=$(echo "$ZONES_JSON" | jq '.data | length')

# ─── print room/zone table ───────────────────────────────────────────────────

echo ""
bold "=== ROOMS (${ROOM_COUNT}) ==="
echo ""
if [[ "$ROOM_COUNT" -gt 0 ]]; then
    # shellcheck disable=SC2016
    echo "$ROOMS_JSON" | jq -r '
        .data[] |
        . as $room |
        ($room.services[] | select(.rtype == "grouped_light") | .rid) as $gl_rid |
        "  Room: \($room.metadata.name)\n    room RID     : \($room.id)\n    grouped_light: \($gl_rid // "not found")\n"
    '
else
    echo "  (no rooms found)"
fi

echo ""
bold "=== ZONES (${ZONE_COUNT}) ==="
echo ""
if [[ "$ZONE_COUNT" -gt 0 ]]; then
    # shellcheck disable=SC2016
    echo "$ZONES_JSON" | jq -r '
        .data[] |
        . as $zone |
        ($zone.services[] | select(.rtype == "grouped_light") | .rid) as $gl_rid |
        "  Zone: \($zone.metadata.name)\n    zone RID     : \($zone.id)\n    grouped_light: \($gl_rid // "not found")\n"
    '
else
    echo "  (no zones found)"
fi

# ─── print ready-to-paste INI snippet ────────────────────────────────────────

echo ""
bold "=== READY-TO-PASTE INI CONFIG ==="
echo ""

# Print a snippet for each room
if [[ "$ROOM_COUNT" -gt 0 ]]; then
    echo "$ROOMS_JSON" | jq -r --arg bridge "$BRIDGE_IP" --arg key "$APP_KEY" '
        .data[] |
        . as $room |
        ($room.services[] | select(.rtype == "grouped_light") | .rid) as $gl_rid |
        "[light:\($room.metadata.name | ascii_downcase | gsub(" "; "-"))]\n" +
        "type              = light\n" +
        "backend           = hue\n" +
        "topic             = paradox/ROOM_NAME/lights/ZONE_NAME\n" +
        "\n" +
        "hue_bridge_host   = \($bridge)\n" +
        "hue_app_key       = \($key)\n" +
        "hue_resource_id   = \($gl_rid // "NOT_FOUND")\n" +
        "hue_resource_type = room\n" +
        "hue_profile       = color\n" +
        "\n"
    '
fi

echo ""
warn "Replace 'ROOM_NAME' and 'ZONE_NAME' in the topic with your actual room/zone identifiers."
warn "Store hue_app_key securely — it grants full control of your Hue bridge."
echo ""
info "Done. Store the app key and resource IDs in your INI config."
echo ""
echo "  hue_bridge_host = ${BRIDGE_IP}"
echo "  hue_app_key     = ${APP_KEY}"
if [[ -n "$CLIENT_KEY" ]]; then
    echo "  hue_client_key  = ${CLIENT_KEY}  (for future entertainment API use)"
fi
