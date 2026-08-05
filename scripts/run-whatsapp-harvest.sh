#!/usr/bin/env bash
# WhatsApp Harvest scheduled wrapper (#11). Close-Out Gate hardened 2026-07-03.
# The scheduled job is DISABLED by design (paused 2026-06-18); hardened for consistency so it is
# safe if re-enabled. No run_status tile; failure is detected, logged FAILED, and exits 1.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "whatsapp-harvest"

# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip
# this slot as a visible PARTIAL, never silently.
quota_gate '' || exit 0

# Model pin: the contract is system/manifest.json -> meta.model_routing.local_wrappers.pins (V13).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /whatsapp-harvest. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out '' "$CODE"
