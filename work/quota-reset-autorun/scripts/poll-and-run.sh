#!/usr/bin/env bash
# poll-and-run.sh - ONE tick of the Quota-Reset Auto-Run poller.
# Registered by arm.sh as a single-fire timer. On the box's GO signal it runs the armed prompt via
# `claude -p` in full auto, posts the result back (marks consumed), saves a deterministic copy, then
# removes its own timer so it fires exactly once. Pull design: the laptop asks Hetzner "go yet?".
# Ported from poll-and-run.ps1 (bash migration Phase 7, 2026-08-05).
#
# NO MODEL PIN, deliberately (and this is declared, not accidental): this runs whatever heavy prompt
# Shaheen armed for a quota-reset window, so it inherits the global default on purpose. That is the
# same exemption the PowerShell version carried.
#
# bash 3.2-compatible (ruling F).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALEX_ROOT="$(cd "$PROJ_ROOT/../.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"

BASE='https://n8n.shaheenkiarash.com'
LOCK="$PROJ_ROOT/config/run.lock"
TOKEN="$(node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --read qra-token)"

# Guard against a second tick launching while a multi-minute run is in flight.
[ -f "$LOCK" ] && exit 0

# Ask the box: is it time? On any network hiccup, just wait for the next tick.
gate="$(curl -s -m 20 -H "X-QRA-Token: $TOKEN" "$BASE/webhook/qra-gate" || true)"
[ -n "$gate" ] || exit 0
go="$(printf '%s' "$gate" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).go?"1":"")}catch{process.stdout.write("")}})')"
[ -n "$go" ] || exit 0

# GO. Claim the lock, then run the armed prompt in full auto.
mkdir -p "$(dirname "$LOCK")"
: > "$LOCK"
prompt="$(printf '%s' "$gate" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).prompt||"")))')"
run_id="$(printf '%s' "$gate" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).run_id||"")))')"
out_dir="$ALEX_ROOT/outputs/prompting-scheduled/$(date '+%Y-%m-%d')"
mkdir -p "$out_dir"
out_file="$out_dir/$run_id.txt"

# Delivery coda: the single run also emails the result (a Gmail draft if hard-send is unavailable).
delivery='

---
When the task above is complete, deliver the full result to Shaheen by email: create a Gmail draft addressed to shaheen.kiarash@gmail.com with a clear subject and the result as the body (send directly if a send tool exists, otherwise a draft is fine).'

resolve_claude
status='GREEN'; err=''
# stdin, not a positional argument: a long prompt has no argument-length ceiling this way.
set +e
run_out="$(printf '%s%s' "$prompt" "$delivery" | "$CLAUDE" -p --dangerously-skip-permissions 2>&1)"
code=$?
set -e
if [ "$code" -ne 0 ]; then status='RED'; err="claude exit $code"; fi
printf '%s\n' "$run_out" > "$out_file"

# Post the result back - flips consumed=true on the box (belt to the local one-shot).
tmp="$(mktemp "${TMPDIR:-/tmp}/qra-result.XXXXXX")"
STATUS="$status" RUN_ID="$run_id" ERR="$err" OUT_FILE="$out_file" node -e '
const fs = require("fs");
process.stdout.write(JSON.stringify({
  status: process.env.STATUS,
  output: fs.readFileSync(process.env.OUT_FILE, "utf8"),
  run_id: process.env.RUN_ID,
  error: process.env.ERR,
}));
' > "$tmp" 2>/dev/null
curl -s -m 30 -H "X-QRA-Token: $TOKEN" -H 'Content-Type: application/json' \
     -X POST --data-binary "@$tmp" "$BASE/webhook/qra-result" >/dev/null 2>&1 || true
rm -f "$tmp"

# One-shot: the transient --collect unit removes itself, but stop the timer explicitly in case this
# was run by hand, then drop the lock.
command -v systemctl >/dev/null 2>&1 && systemctl --user stop PersonalOS-qra-poller.timer >/dev/null 2>&1
rm -f "$LOCK"
exit 0
