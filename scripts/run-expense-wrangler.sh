#!/usr/bin/env bash
# Expense Wrangler scheduled wrapper (#08). Close-Out Gate hardened 2026-07-03.
#
# THE CANONICAL WRAPPER. Ported first (bash migration Phase 3, 2026-08-05) and reviewed before the
# other 16 were written, because they are all this shape. If you are adding a wrapper, copy this one.
#
# bash 3.2-compatible (ruling F): no readlink -f, no associative arrays, no globstar, no GNU-only
# flag spellings. All judgment lives in scripts/lib/close-out.mjs; this file is process plumbing.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "expense-wrangler"

# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip
# this slot as a visible PARTIAL (an amber run_status is pushed by the gate itself), never silently.
quota_gate 'expenses' || exit 0

# Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16). The pin is the contract in
# system/manifest.json -> meta.model_routing.local_wrappers.pins, enforced by validator V13.
alex_claude --model claude-sonnet-4-6 \
    -p "Run /expense-wrangler. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out 'expenses' "$CODE"
