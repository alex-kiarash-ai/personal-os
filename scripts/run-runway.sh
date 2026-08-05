#!/usr/bin/env bash
# Runway Command Center scheduled wrapper (#20). Monthly, last day 21:15, AFTER /expense-wrangler
# (20:00) so it reads the freshest expense + booking data.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "runway"

# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip
# this slot as a visible PARTIAL, never silently.
quota_gate 'runway' || exit 0

# Model pin: the contract is system/manifest.json -> meta.model_routing.local_wrappers.pins (V13).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /runway. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out 'runway' "$CODE"
