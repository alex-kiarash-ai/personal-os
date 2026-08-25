#!/usr/bin/env bash
# Email Triage scheduled wrapper (#07). Close-Out Gate hardened 2026-07-03.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "email-triage"

quota_gate 'email-triage' || exit 0

# Preflight: claude.ai connectors load non-blocking, so a cold `claude -p` acts before Gmail
# finishes connecting. `mcp list` forces a synchronous connect + warms the token cache.
export MCP_TIMEOUT=30000
resolve_claude
ready=""
i=1
while [ "$i" -le 5 ]; do
    if "$CLAUDE" mcp list 2>&1 | grep -q 'Gmail.*Connected'; then
        ready=1
        break
    fi
    echo "preflight $i/5: Gmail not attached yet, waiting 8s..." >> "$LOG"
    sleep 8
    i=$((i + 1))
done
if [ -z "$ready" ]; then
    echo "WARNING: Gmail connector never attached; run may be blind." >> "$LOG"
fi

# Arm the headless soul-injection gate (2026-07-25, stress-test fix F-04). This lane writes REPLY
# DRAFTS in Shaheen's name, so a run where soul.md never reached the model ships off-voice prose -
# the exact silent class found 2026-07-07 (writers running on generic instructions for weeks).
soul_arm

# Untrusted-lane egress guard (2026-08-05, enterprise-assessment idea 5): this run feeds attacker-
# controllable email bodies into a permissions-skipped model, so the PreToolUse hook
# (scripts/untrusted-lane-guard.js, armed by this env var) denies WebFetch/WebSearch and any
# shell egress to a host outside the n8n-box allowlist. The size snapshot below is the tripwire:
# a run during which the guard blocked ANYTHING is reported DEGRADED (RED), because a block is
# either an injection attempt or a new legitimate need, and both must reach Shaheen.
export ALEX_UNTRUSTED_LANE='email-triage'
blocks_file="outputs/logs/untrusted-lane-blocks.jsonl"
blocks_pre=0
if [ -f "$blocks_file" ]; then blocks_pre="$(wc -c < "$blocks_file" | tr -d ' ')"; fi

# Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
alex_claude --model claude-sonnet-4-6 \
    -p "Run /email-triage scheduled.${SOUL_INSTRUCTION} $(alex_verdict_instruction)" \
    --dangerously-skip-permissions
unset ALEX_UNTRUSTED_LANE

blocks_post=0
if [ -f "$blocks_file" ]; then blocks_post="$(wc -c < "$blocks_file" | tr -d ' ')"; fi
egress_reason=""
if [ "$blocks_post" -gt "$blocks_pre" ]; then
    egress_reason='untrusted-lane guard BLOCKED egress attempt(s) this run (injection attempt or new legitimate need) - see outputs/logs/untrusted-lane-blocks.jsonl'
    echo "egress guard: blocks file grew $blocks_pre -> $blocks_post bytes this run" >> "$LOG"
fi

# A canary miss on a voice-shipping lane is a DEGRADED run, so it is routed through the ONE existing
# degraded-run path (precise RED headline + the retry ladder + exit 1) rather than a parallel exit,
# which would have skipped both. soul_check is called WITHOUT a project so exactly one HQ push
# happens, from close_out, carrying the precise reason.
soul_reason=""
if ! soul_check; then
    soul_reason="$SOUL_MISS_REASON"
fi

# Both degradation signals (soul miss, egress block) ride the ONE degraded path; join when both fire.
degraded_reason="$soul_reason"
if [ -n "$egress_reason" ]; then
    degraded_reason="${degraded_reason:+$degraded_reason; }$egress_reason"
fi

close_out 'email-triage' "$CODE" "$degraded_reason"
