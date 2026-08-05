#!/usr/bin/env bash
# Personal CRM scheduled wrapper (#05). Rebuilt 2026-07-12 (upgrade P3) on the deterministic-core-
# first architecture, the sprint-tracker pattern.
#
# ORDER MATTERS. The zero-token core runs FIRST and is the must-succeed part: it computes the Monday
# follow-up list from vault/people frontmatter alone (channel-aware, spec-default cadences,
# state/cadence.json overrides) and pushes crm/run_status GREEN. Three straight quota-dead Mondays
# (the 06-26 class) can no longer take the list down.
# The Claude pass runs SECOND, behind the quota gate: scoring, Msgs 90d, Notion sync, gated drafts.
# If it is capped, the run is DEGRADED (list stands, HQ green), logged PARTIAL, exit 0.
#
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "personal-crm"

# ---- 1. Deterministic core (must succeed; writes the list + greens HQ) ----
set +e
OUT="$(node "$ALEX_ROOT/scripts/personal-crm-core.js" 2>&1)"
CODE=$?
set -e
{ echo "--- core ---"; printf '%s\n' "$OUT"; } >> "$LOG"
if [ "$CODE" -ne 0 ]; then
    # Core failure = real failure: RED push + retry ladder + exit 1.
    close_out 'crm' "$CODE"
fi

# ---- P3 quota gate: plan freshly capped -> skip the Claude pass, the list already stands ----
if ! quota_gate 'crm'; then
    echo "PARTIAL: Claude pass skipped by the quota gate (plan capped). Core list written + HQ green." >> "$LOG"
    exit 0
fi

# ---- 2. Claude pass (scoring, enrich, Notion sync, gated drafts) ----
# Soul-injection gate armed 2026-07-25 (stress-test fix F-04): this pass stages voice-matched reply
# drafts, so a run without soul.md in context ships off-voice prose in Shaheen's name. The core above
# already wrote the Monday list and greened HQ, so a canary miss degrades ONLY this pass - which is
# exactly the core-first design working.
soul_arm

# Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /personal-crm.${SOUL_INSTRUCTION} $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

soul_reason=""
if ! soul_check; then
    soul_reason="$SOUL_MISS_REASON"
fi

close_out 'crm' "$CODE" "$soul_reason"

# Success falls through: push GREEN so a stale red self-heals (P3 rider; the "full run clean" signal
# on top of the core's earlier "numbers landed" green).
hq_push 'crm' 'green' "full run clean $(date '+%Y-%m-%d')"
