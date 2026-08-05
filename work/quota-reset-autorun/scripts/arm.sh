#!/usr/bin/env bash
# arm.sh - Arm the one-shot quota-reset auto-run.
# Usage: ./arm.sh "15:00"                    (fires at reset + 5 min; next day if already passed)
#        ./arm.sh "2026-07-14 15:00" 5
#
# Ported from arm.ps1 (bash migration Phase 7, 2026-08-05). curl STAYS the transport - it was already
# the more portable choice; the Windows-specific reason for it (.NET Invoke-RestMethod failing with
# "the underlying connection was closed" on that machine, error-log 2026-07-14) is deleted with the
# platform, but the decision is unchanged.
#
# bash 3.2-compatible (ruling F).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALEX_ROOT="$(cd "$PROJ_ROOT/../.." && pwd)"

RESET_TIME="${1:-}"
OFFSET_MINUTES="${2:-5}"
[ -n "$RESET_TIME" ] || { echo "usage: $0 \"HH:MM\" | \"YYYY-MM-DD HH:MM\" [offset-minutes]" >&2; exit 2; }

BASE='https://n8n.shaheenkiarash.com'
TOKEN="$(node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --read qra-token)"

# The prompt to run, pasted into payload-prompt.txt.
PAYLOAD="$PROJ_ROOT/payload-prompt.txt"
if [ ! -s "$PAYLOAD" ] || grep -q 'PASTE YOUR PROMPT HERE' "$PAYLOAD"; then
    echo "payload-prompt.txt is empty or still the placeholder. Paste your real prompt into it first: $PAYLOAD" >&2
    exit 1
fi

# fire_at = reset + offset, as UTC ISO for the box. Date arithmetic goes through Node deliberately:
# `date -d` is GNU-only and the BSD spelling is different, which is exactly the divergence class the
# migration's BSD-vs-GNU lint exists to keep out of shell files (ruling F).
FIRE_JSON="$(RESET="$RESET_TIME" OFFSET="$OFFSET_MINUTES" node -e '
const raw = process.env.RESET.trim();
const offset = parseInt(process.env.OFFSET, 10) || 0;
let d = /^\d{1,2}:\d{2}$/.test(raw)
  ? new Date(`${new Date().toISOString().slice(0, 10)}T${raw.padStart(5, "0")}:00`)
  : new Date(raw.replace(" ", "T"));
if (Number.isNaN(d.getTime())) { console.error(`unparseable reset time: ${raw}`); process.exit(1); }
if (d < new Date()) d = new Date(d.getTime() + 86400000);   // bare HH:mm already past -> next day
const fire = new Date(d.getTime() + offset * 60000);
process.stdout.write(JSON.stringify({
  resetLocal: d.toString(), fireLocal: fire.toString(),
  fireIso: fire.toISOString().replace(/\.\d{3}Z$/, "Z"),
  fireEpoch: Math.floor(fire.getTime() / 1000),
}));
')"
FIRE_ISO="$(printf '%s' "$FIRE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).fireIso))')"
FIRE_LOCAL="$(printf '%s' "$FIRE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).fireLocal))')"

# Arm the box. The body is BUILT IN NODE, not by string-concatenating shell variables: the prompt is
# arbitrary multi-line text and hand-rolled JSON quoting is how that breaks.
tmp="$(mktemp "${TMPDIR:-/tmp}/qra-arm.XXXXXX")"
trap 'rm -f "$tmp"' EXIT INT TERM
FIRE_ISO="$FIRE_ISO" PAYLOAD="$PAYLOAD" node -e '
const fs = require("fs");
process.stdout.write(JSON.stringify({
  fire_at: process.env.FIRE_ISO,
  prompt: fs.readFileSync(process.env.PAYLOAD, "utf8"),
}));
' > "$tmp"

arm_ok=""
for i in 1 2 3 4; do
    resp="$(curl -s -m 30 -H "X-QRA-Token: $TOKEN" -H 'Content-Type: application/json' \
            -X POST --data-binary "@$tmp" "$BASE/webhook/qra-arm" || true)"
    if printf '%s' "$resp" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
        arm_ok=1
        break
    fi
    echo "  (arm attempt $i hit a transient workflow error, retrying in 3s...)"
    sleep 3
done
[ -n "$arm_ok" ] || { echo "arm failed after 4 tries: ${resp:-no response}" >&2; exit 1; }
echo "Armed. fire_at(local)=$FIRE_LOCAL  fire_at(UTC)=$FIRE_ISO"

# Verify-after-write (standing order): read the gate back from the box.
sleep 1
gate="$(curl -s -m 30 -H "X-QRA-Token: $TOKEN" "$BASE/webhook/qra-gate" || true)"
echo "Gate reads back: $gate   (go should be false until fire_at)"

# Register a SINGLE-FIRE timer at fire time + 60s (a clock-skew cushion so the gate reads go=true).
# systemd-run --on-calendar with --collect gives the same one-shot-and-self-delete semantics the
# Windows DeleteExpiredTaskAfter hack approximated, without the hack.
if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --user --collect \
        --unit=PersonalOS-qra-poller \
        --on-calendar="$(printf '%s' "$FIRE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=new Date((JSON.parse(s).fireEpoch+60)*1000);const p=n=>String(n).padStart(2,"0");process.stdout.write(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`)})')" \
        "$SCRIPT_DIR/poll-and-run.sh"
    echo "Poller registered: fires ONCE ~60s after fire_at (no every-minute polling)."
else
    echo "NOTE: systemd-run not available on this machine, so NO poller was registered."
    echo "      The box is armed, but nothing local will act on it. Run poll-and-run.sh by hand at fire time,"
    echo "      or arm from the Linux host. (Expected on the macOS dev box, ruling C.)"
fi
