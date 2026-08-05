#!/usr/bin/env bash
# disarm.sh - Cancel a pending auto-run: remove the poller timer and mark the box consumed.
# Ported from disarm.ps1 (bash migration Phase 7, 2026-08-05).
# bash 3.2-compatible (ruling F).
set -uo pipefail   # NOT -e: disarming must be best-effort all the way through. Half-disarmed (timer
                   # gone, box still armed, or vice versa) is the worst outcome, so every step runs.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALEX_ROOT="$(cd "$PROJ_ROOT/../.." && pwd)"

BASE='https://n8n.shaheenkiarash.com'
TOKEN="$(node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --read qra-token 2>/dev/null || true)"

if command -v systemctl >/dev/null 2>&1; then
    systemctl --user stop PersonalOS-qra-poller.timer  >/dev/null 2>&1 || true
    systemctl --user stop PersonalOS-qra-poller.service >/dev/null 2>&1 || true
    systemctl --user reset-failed PersonalOS-qra-poller.service >/dev/null 2>&1 || true
fi
rm -f "$PROJ_ROOT/config/run.lock"

if [ -n "$TOKEN" ]; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/qra-disarm.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT INT TERM
    printf '%s' '{"status":"DISARMED","output":"","run_id":"manual-disarm"}' > "$tmp"
    curl -s -m 20 -H "X-QRA-Token: $TOKEN" -H 'Content-Type: application/json' \
         -X POST --data-binary "@$tmp" "$BASE/webhook/qra-result" >/dev/null 2>&1 || true
fi
echo "Disarmed: poller timer removed, box marked consumed (gate will read go=false)."
