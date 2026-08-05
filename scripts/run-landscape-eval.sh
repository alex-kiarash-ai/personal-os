#!/usr/bin/env bash
# Landscape Eval wrapper (#25 Evolution, P2-S2). ONE claude -p call per week.
# Flow: node assembler (zero-token) -> claude -p on the assembled prompt -> save digest ->
#       overlap guard -> open a GitHub issue if gh is installed, else keep the digest local ->
#       skills installer -> HQ push -> close-out.
# An empty week means the assembler exits 3, this wrapper posts nothing and stays GREEN. It never
# invents items to have something to say.
#
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "landscape-eval"

# n8n creds into the environment (from the ledger, never from code) so the skills installer's
# `generate-alex.js --only=claude,docs` doc-regen passes its live model-routing validation (V6).
# --only=claude,docs does a read-only n8n check; it does NOT sync or write workflows. An absent
# credential just means the installer keeps the install but skips the doc regen.
if [ -z "${N8N_API_KEY:-}" ] && node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --check n8n-api-key >/dev/null 2>&1; then
    N8N_API_KEY="$(node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --read n8n-api-key)"
    export N8N_API_KEY
fi
: "${N8N_API_URL:=https://n8n.shaheenkiarash.com/api/v1}"
export N8N_API_URL

quota_gate 'evolution' || exit 0

# 1. Deterministic assembler (zero-token). Exit 3 = nothing new this week; exit 0 = prompt path printed.
set +e
prompt_path="$(node "$ALEX_ROOT/scripts/landscape-eval.js" 2>&1)"
asm_code=$?
set -e
prompt_path="$(printf '%s' "$prompt_path" | tail -n 1)"

if [ "$asm_code" -eq 3 ]; then
    echo "nothing new in the last 7 days - posting nothing, GREEN" >> "$LOG"
    hq_push 'evolution' 'green' 'evolution: quiet week, nothing to review'
    exit 0
fi
if [ "$asm_code" -ne 0 ] || [ ! -f "$prompt_path" ]; then
    OUT="WRAPPER EXCEPTION: eval assembler failed (exit $asm_code) - $prompt_path"
    printf '%s\n' "$OUT" >> "$LOG"
    close_out 'evolution' 1
    exit 1
fi

# 2. The ONE model call: the assembled prompt goes to claude -p over STDIN, not as a positional
#    argument. The skills lane grew the prompt past ~30KB; stdin has no argument-length ceiling and
#    `claude -p` with no prompt argument reads from stdin. (The Windows-era reason was the command
#    line limit specifically; the stdin approach is simply the right one on any platform.)
stamp="$(date '+%Y-%m-%d')"
out_dir="$ALEX_ROOT/outputs/evolution/$stamp"
mkdir -p "$out_dir"
digest_path="$out_dir/digest.md"

resolve_claude
set +e
OUT="$( { cat "$prompt_path"; printf ' %s' "$(alex_verdict_instruction)"; } \
        | "$CLAUDE" --model claude-sonnet-4-6 -p --dangerously-skip-permissions 2>&1 )"
CODE=$?
set -e
printf '%s\n' "$OUT" >> "$LOG"

# 3. Real output -> save the digest, then the guards, then the issue, then the skills lane.
blocked=1
if [ "$(printf '%s' "$OUT" | tr -d '[:space:]' | wc -c | tr -d ' ')" -ge 200 ]; then
    blocked=0
fi

if [ "$CODE" -eq 0 ] && [ "$blocked" -eq 0 ] && ! printf '%s' "$OUT" | grep -q 'WRAPPER EXCEPTION'; then
    printf '%s\n' "$OUT" > "$digest_path"
    echo "digest saved: $digest_path" >> "$LOG"

    # 3a. Deterministic platform-overlap guard (three-plan validation P4). Every `platform` item the
    #     eval's pre-scan flagged as overlapping a project MUST be resolved to Recommend/Skip in the
    #     digest. The model cannot police itself (work/25 no-model-verifier-chains). A miss fails RED
    #     and skills do NOT install this week - fix the digest/prompt, never paper over a dropped
    #     capability signal.
    overlap_path="$out_dir/overlaps.json"
    if [ -f "$overlap_path" ]; then
        set +e
        ov_out="$(node "$ALEX_ROOT/scripts/landscape-eval-check.js" "$digest_path" "$overlap_path" 2>&1)"
        ov_code=$?
        set -e
        printf '%s\n' "$ov_out" >> "$LOG"
        if [ "$ov_code" -ne 0 ]; then
            hq_push 'evolution' 'red' "evolution: RED - unresolved platform overlap ($stamp)"
            OUT="$OUT

OVERLAP GUARD FAILED:
$ov_out"
            close_out 'evolution' 1
            exit 1
        fi
    fi

    if command -v gh >/dev/null 2>&1; then
        gh label create ai-landscape-update --color 1f6feb --description "Weekly Alex evolution digest" >/dev/null 2>&1 || true
        if gh issue create --title "ai-landscape-update $stamp" --label ai-landscape-update --body-file "$digest_path" >> "$LOG" 2>&1; then
            echo "GitHub issue created (label ai-landscape-update)" >> "$LOG"
        else
            echo "gh issue create failed - digest is local at $digest_path" >> "$LOG"
        fi
    else
        echo "gh not installed - digest saved locally only ($digest_path). Install + auth gh to auto-open the ai-landscape-update issue." >> "$LOG"
    fi

    # 3b. Skills lane (#25, 2026-07-11): hand the digest's json install block to the deterministic,
    #     audited installer. It installs allowlisted+clean skills live, wires each into the recall
    #     architecture, and git-commits per install; the rest are flagged in its report. Zero tokens.
    set +e
    install_out="$(node "$ALEX_ROOT/scripts/skills-installer.js" "$digest_path" 2>&1)"
    set -e
    printf '%s\n' "$install_out" >> "$LOG"
    if [ -n "$install_out" ]; then
        { echo; echo "---"; printf '%s\n' "$install_out"; } >> "$digest_path"
    fi

    installed_n="$(printf '%s' "$install_out" | sed -n 's/.*Installed \([0-9][0-9]*\).*/\1/p' | head -n 1)"
    if [ -n "$installed_n" ] && [ "$installed_n" -gt 0 ] 2>/dev/null; then
        headline="evolution: digest ready + $installed_n skill(s) auto-installed ($stamp) - undo via git revert"
    else
        headline="evolution: weekly digest ready ($stamp)"
    fi
    hq_push 'evolution' 'green' "$headline"
fi

close_out 'evolution' "$CODE"
