#!/usr/bin/env bash
# Application Engine (local ops) scheduled wrapper (#03). Close-Out Gate hardened 2026-07-03.
# Local surveillance only; the live pipeline is n8n (#03) and its health is tracked by the Pipeline
# Stats sidecar (app-engine-bi tile), so a local-ops failure does NOT push a run_status tile - hence
# the empty close-out project. The QUOTA gate still names app-engine-bi, because that is what its
# amber degraded-slot push belongs to.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "application-engine"

# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip
# this slot as a visible PARTIAL, never silently.
quota_gate 'app-engine-bi' || exit 0

# Model pin: the contract is system/manifest.json -> meta.model_routing.local_wrappers.pins (V13).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /application-engine. $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out '' "$CODE"
