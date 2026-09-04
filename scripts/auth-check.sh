#!/usr/bin/env bash
# Weekly auth-freshness probe (audit step 2 + self-review proposal 3, live 2026-07-06). Sunday 19:30.
# The largest recorded outage class is headless-claude auth/quota dying silently between runs (the
# 06-26/29/30 sprint blackout). This probe catches login expiry SUNDAY EVENING, before the Monday
# morning job train, instead of it being discovered by a dead week.
#
# One micro-prompt (~zero cost) decides infra/auth_ok and this script's exit code. `claude mcp list`
# (zero tokens - a health probe, no LLM call) decides infra/mcp_ok and is strictly additive.
# Recovery command when the MCP tile goes red, run interactively:
#     claude mcp login <name>              (opens a browser to re-authorize the connector)
#     claude mcp login <name> --no-browser (SSH/headless: prints the auth URL, paste the redirect back)
#
# The judgment lives in scripts/lib/auth-probe.mjs; this file only spawns and captures.
# bash 3.2-compatible (ruling F).
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "auth-check"

resolve_claude

# 1. The auth micro-prompt. Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
probe_file="$(mktemp "${TMPDIR:-/tmp}/alex-authprobe.XXXXXX")"
mcp_file="$(mktemp "${TMPDIR:-/tmp}/alex-authmcp.XXXXXX")"
trap '_alex_rc=$?; rm -f "$TMPOUT" "$probe_file" "$mcp_file"; alex_signal_exit "$_alex_rc"' EXIT INT TERM  # signal chains the C31 dead-man switch (stress-test S-D3)

set +e
"$CLAUDE" --model claude-sonnet-4-6 -p "Reply with exactly: OK" > "$probe_file" 2>&1
probe_code=$?
# 2. The MCP connectivity probe. Best-effort: a failure here is a finding, never a crash.
"$CLAUDE" mcp list > "$mcp_file" 2>&1
set -e
cat "$probe_file" >> "$LOG"

dry=()
if [ -n "${ALEX_DRY_RUN:-}" ]; then
    dry=(--dry-run)
fi

node "$ALEX_ROOT/scripts/lib/auth-probe.mjs" \
    --log "$LOG" \
    --probe-file "$probe_file" \
    --probe-code "$probe_code" \
    --mcp-file "$mcp_file" \
    "${dry[@]+"${dry[@]}"}"
