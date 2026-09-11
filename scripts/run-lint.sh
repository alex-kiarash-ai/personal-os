#!/usr/bin/env bash
# Gated monthly /lint (Recovery Phase 3, live 2026-07-06). First Monday 10:00.
# THE GATE: the zero-token deterministic checker runs FIRST and nominates; the LLM judges ONLY the
# shortlist (deterministic checks are ~10,000x cheaper than judgment, so the script gates the judge).
# Detects + proposes, never auto-repairs: the same invariant as the checker itself.
#
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
# C31: the scheduler task is PersonalOS-lint-monthly, but the job (and its log) is "lint". Override
# so the completion signal keys on the registry name rather than the log name.
ALEX_TASK_NAME="PersonalOS-lint-monthly"
export ALEX_TASK_NAME
log_init "lint-monthly"

quota_gate 'recovery' || exit 0

# 1. The deterministic sweep (nomination pass). Exit 0 clean / 2 drift / 1 checker error.
set +e
node "$ALEX_ROOT/work/18-recovery-layer/check.mjs" >> "$LOG" 2>&1
sweep_exit=$?
set -e
echo "checker exit: $sweep_exit" >> "$LOG"
if [ "$sweep_exit" -eq 1 ]; then
    # The checker itself broke: its own fail-loud path already pushed RED integrity. Judge nothing
    # on a broken nomination pass - a shortlist you cannot trust is worse than no shortlist.
    echo "ABORT: checker error - /lint not run (no trustworthy shortlist)" >> "$LOG"
    exit 1
fi

# 2. The LLM judgment pass over the nominations only.
month="$(date '+%Y-%m')"
prompt="Run /lint in GATED mode (Recovery Phase 3). The deterministic checker just ran with exit code $sweep_exit. Read vault/projects/recovery/last-sweep.md as the nomination shortlist. Judge ONLY: (a) every item the sweep flagged, and (b) semantic drift (stale prose, superseded claims, contradictions, duplicate topics) on the specific pages those items touch, plus pages untouched for 90+ days that the sweep names. Write the findings report to vault/projects/recovery/lint-${month}.md, append vault/log.md, and PROPOSE fixes. Apply nothing without approval; identity files (soul.md, CLAUDE.md, brand) are always proposals. Run the Close-Out Gate."

# Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
alex_claude --model claude-sonnet-4-6 \
    -p "$prompt $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out 'recovery' "$CODE"
