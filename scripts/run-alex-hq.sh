#!/usr/bin/env bash
# Alex HQ scheduled wrapper (#16). Close-Out Gate hardened 2026-07-03.
# This IS the dashboard producer, so a failed run usually means HQ is unreachable and an HQ push
# would fail anyway - hence the empty close-out project. Failure is still detected, logged FAILED,
# and exits 1 for visibility.
#
# DETERMINISTIC NUMBER PATH (2026-07-21): the metrics, the 5 data JSONs and the ship are done by a
# script, NOT the model. The old wrapper asked headless Haiku to count its MCP tools and scheduled
# jobs and to scp the files; when tools went deferred (~07-17) it pushed mcp_tools=0 and stopped
# shipping (box files froze at 07-20). None of that is model work. hq_harvest_push.py harvests,
# builds, ships-with-verify, pushes, and read-back-verifies; the model call after it does only the
# HQ inbox + the narration ('status' = fetch + present, no recount).
#
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "alex-hq"

# No connector preflight needed: /alex-hq uses local files, ssh and curl only.
quota_gate 'alex-hq' || exit 0

set +e
harvest="$(python3 "$ALEX_ROOT/scripts/hq_harvest_push.py" 2>&1)"
harvest_code=$?
set -e
printf '%s\n' "$harvest" >> "$LOG"

# SELF-HEAL LOOP (Shaheen 2026-07-21): every HQ update also CHECKS + FIXES, it doesn't just display.
# Auto-safe mismatches are re-derived + read-back-verified; live-mutation fixes (workflow redeploy)
# and human-only items (phone/OAuth) are queued to the waiting-on-you list with a diagnosis.
# Zero-token. Best-effort: a broken self-heal must not take down the dashboard update.
set +e
heal="$(python3 "$ALEX_ROOT/scripts/hq_self_heal.py" 2>&1)"
set -e
printf '%s\n' "$heal" >> "$LOG"

# Model: Haiku (cost cut, Shaheen 2026-07-16). Numbers are already pushed above; the model only
# files HQ notes + presents. The 'status' argument means skip push, fetch + present + inbox check.
alex_claude --model claude-haiku-4-5-20251001 \
    -p "Run /alex-hq status. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

# The whole run's output is the deterministic halves PLUS the narration, so the Close-Out Gate sees
# everything, exactly as the PowerShell version accumulated into one $out.
OUT="=== hq_harvest_push (deterministic) ===
$harvest

=== hq_self_heal ===
$heal

$OUT"

# The deterministic harvest is the source of truth for run health: a stale ship or a failed push
# there fails the run even if the narration succeeded.
if [ "$harvest_code" -ne 0 ]; then
    CODE=$harvest_code
fi

close_out '' "$CODE"
