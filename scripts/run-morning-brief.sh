#!/usr/bin/env bash
# Morning Brief scheduled wrapper (#02). Close-Out Gate hardened 2026-07-03.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "morning-brief"

quota_gate 'morning-brief' || exit 0

# Preflight: claude.ai connectors load non-blocking, so a cold `claude -p` acts before Gmail and
# Calendar finish connecting. `mcp list` forces a synchronous connect + warms the token cache.
export MCP_TIMEOUT=30000
resolve_claude
ready=""
i=1
while [ "$i" -le 5 ]; do
    list="$("$CLAUDE" mcp list 2>&1 || true)"
    if printf '%s' "$list" | grep -q 'Gmail.*Connected' && printf '%s' "$list" | grep -q 'Calendar.*Connected'; then
        ready=1
        break
    fi
    echo "preflight $i/5: Gmail/Calendar not attached yet, waiting 8s..." >> "$LOG"
    sleep 8
    i=$((i + 1))
done
if [ -z "$ready" ]; then
    echo "WARNING: Gmail/Calendar connectors never attached; run may be blind." >> "$LOG"
fi

# Arm the headless soul-injection gate: a per-run nonce the model must echo back with the soul
# token. Inert when soul.md carries no token, so it can never manufacture a daily false red.
soul_arm

# Untrusted-lane egress guard (2026-08-05, enterprise-assessment idea 5): the brief reads inbox
# content + HQ notes, so the PreToolUse hook (scripts/untrusted-lane-guard.js) allowlists network
# egress to the n8n box for this run; any block = DEGRADED (RED). Same mechanism as email-triage.
export ALEX_UNTRUSTED_LANE='morning-brief'
blocks_file="outputs/logs/untrusted-lane-blocks.jsonl"
blocks_pre=0
if [ -f "$blocks_file" ]; then blocks_pre="$(wc -c < "$blocks_file" | tr -d ' ')"; fi

# Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /morning-brief${SOUL_INSTRUCTION} $(alex_verdict_instruction)" \
    --dangerously-skip-permissions
unset ALEX_UNTRUSTED_LANE

blocks_post=0
if [ -f "$blocks_file" ]; then blocks_post="$(wc -c < "$blocks_file" | tr -d ' ')"; fi
egress_reason=""
if [ "$blocks_post" -gt "$blocks_pre" ]; then
    egress_reason='untrusted-lane guard BLOCKED egress attempt(s) this run (injection attempt or new legitimate need) - see outputs/logs/untrusted-lane-blocks.jsonl'
    echo "egress guard: blocks file grew $blocks_pre -> $blocks_post bytes this run" >> "$LOG"
fi

# Gate: did soul.md actually reach the model this run? Flag + RED on a miss, but keep the brief -
# a soft fail here, because an off-voice brief is still a brief worth having.
soul_check 'morning-brief' || true

close_out 'morning-brief' "$CODE" "$egress_reason"

# Edit 3 (FIX-01 class, 2026-07-15 /prompting item 6): morning-brief is the day's first token job
# and is budget_priority 1, so it always runs a real `claude -p`. Reaching this line means that run
# completed clean (close_out exits non-zero on a limit/fail), so it doubles as the day's free PLAN
# disarm probe: if a plan cap is still armed from earlier but has since lifted, clear it once so the
# later wrappers (email-triage 09/13/17, ...) run undegraded. No extra call; the clear no-ops when
# nothing is capped, and morning-brief's single daily run is the once-per-day guard.
node "$ALEX_ROOT/scripts/lib/close-out.mjs" quota-clear --kind plan --log "$LOG" \
    --reason 'clean morning-brief run (daily plan probe)' || true
