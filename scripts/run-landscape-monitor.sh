#!/usr/bin/env bash
# Landscape Monitor wrapper (#25 Evolution, P2-S1). ZERO-TOKEN: runs Node, never calls claude.
# On all-sources-fail the node script exits 1 -> close-out logs FAILED, pushes RED to Alex HQ, and
# self-schedules a +90min retry.
#
# Declared in the model-routing contract under `deterministic_no_pin`, precisely because it makes no
# `claude -p` call. V13 asserts that, so this file staying token-free is machine-checked, not a note.
#
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "landscape-monitor"

# P13 (b30): pass the n8n API creds so the deployed-versions probe can read the live writer model
# (the n8n-version half uses ssh + needs no key). Resolved through the credentials ledger, never a
# literal path, and never printed. Graceful: no key just means the model half of the row is skipped.
if node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --check n8n-api-key >/dev/null 2>&1; then
    N8N_API_URL="https://n8n.shaheenkiarash.com/api/v1"
    N8N_API_KEY="$(node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --read n8n-api-key)"
    export N8N_API_URL N8N_API_KEY
fi

set +e
OUT="$(node "$ALEX_ROOT/scripts/landscape-monitor.js" 2>&1)"
CODE=$?
set -e
printf '%s\n' "$OUT" >> "$LOG"

# GREEN heartbeat on success. Lands on the Alex HQ 'evolution' tile once activation sets hq_project;
# a harmless orphan metric until then.
if [ "$CODE" -eq 0 ] && ! printf '%s' "$OUT" | grep -q 'WRAPPER EXCEPTION'; then
    hq_push 'evolution' 'green' 'landscape monitor ok'
fi

close_out 'evolution' "$CODE"
