#!/usr/bin/env bash
# Alex Reviews Alex scheduled wrapper (#23). Weekly Sunday 20:00, a quiet slot before the Monday brief.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "self-review"

# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip
# this slot as a visible PARTIAL, never silently.
quota_gate 'self-review' || exit 0

# Model pin: the contract is system/manifest.json -> meta.model_routing.local_wrappers.pins (V13).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /self-review. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out 'self-review' "$CODE"
