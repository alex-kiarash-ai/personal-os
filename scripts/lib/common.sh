# scripts/lib/common.sh
# Shared shell helpers for the scheduled wrappers (bash migration Phase 1, 2026-08-05).
#
# BASH 3.2 COMPATIBLE, DELIBERATELY (ruling F of bash-migration-plan.md).
# macOS ships bash 3.2.57 (frozen 2007); Linux ships 5.x. Development happens on macOS and the
# job train runs on Linux, so every wrapper must run unmodified on both. That costs nothing here
# because all real logic lives in Node by design (see the language split in the migration plan).
#
# THE RULES for this file and every scripts/run-*.sh that sources it:
#   - NO `readlink -f`      (BSD readlink has no -f)
#   - NO associative arrays (`declare -A`, bash 4+)
#   - NO `${var^^}` / `${var,,}` case conversion (bash 4+)
#   - NO `mapfile` / `readarray` (bash 4+)
#   - NO `**` globstar (bash 4+)
#   - NO `sed -i`, `date -d`, `stat -c`  (GNU-only spellings; BSD differs)
#   If you need any of those, do it in Node instead. scripts/tests/portability-check.mjs
#   enforces this and will fail the build.
#
# Usage from a wrapper:
#   ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   . "$ALEX_ROOT/scripts/lib/common.sh"
#   alex_root_cd
#   log_init "expense-wrangler"

# --- bash version guard ------------------------------------------------------------------------
# Fail LOUD on an older shell rather than degrade subtly. 3.2 is the floor because that is what
# macOS ships; anything older is a genuinely broken environment.
if [ -z "${BASH_VERSION:-}" ]; then
    echo "FATAL: common.sh must be sourced from bash, not sh/dash/zsh." >&2
    exit 1
fi
_alex_bash_major="${BASH_VERSINFO[0]}"
_alex_bash_minor="${BASH_VERSINFO[1]}"
if [ "$_alex_bash_major" -lt 3 ] || { [ "$_alex_bash_major" -eq 3 ] && [ "$_alex_bash_minor" -lt 2 ]; }; then
    echo "FATAL: bash >= 3.2 required, found $BASH_VERSION" >&2
    exit 1
fi
unset _alex_bash_major _alex_bash_minor

# --- die: the one way a wrapper reports a fatal setup problem ------------------------------------
# Writes to stderr AND (if a log is open) to the log, so a scheduled run leaves evidence.
die() {
    echo "FATAL: $*" >&2
    if [ -n "${LOG:-}" ] && [ -w "$(dirname "$LOG")" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') FATAL: $*" >> "$LOG"
    fi
    exit 1
}

# --- alex_root_cd: resolve the repo root and cd into it ------------------------------------------
# Every legacy .ps1 hardcoded C:\Users\Thinkpad\Desktop\personal-os. Never do that again: the root
# is derived from this file's own location, so the repo can live anywhere on any machine.
# BASH 3.2 NOTE: `readlink -f` is unavailable on BSD/macOS. The cd+pwd idiom below is portable and
# also resolves symlinked parents correctly, which is what we actually need.
alex_root_cd() {
    if [ -z "${ALEX_ROOT:-}" ]; then
        # BASH_SOURCE[0] is this file; the repo root is two levels up (scripts/lib/ -> repo).
        ALEX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || die "cannot resolve ALEX_ROOT"
        export ALEX_ROOT
    fi
    [ -f "$ALEX_ROOT/CLAUDE.md" ] || die "ALEX_ROOT=$ALEX_ROOT does not look like the personal-os root (no CLAUDE.md)"
    cd "$ALEX_ROOT" || die "cannot cd to $ALEX_ROOT"
}

# --- resolve_claude: find the Claude Code CLI ----------------------------------------------------
# Was $env:APPDATA\npm\claude.ps1 in 16 wrappers. Order: explicit override, PATH, the usual local
# install, then the npm global prefix. Fails loud and named; a wrapper that cannot find claude must
# never silently "succeed" with empty output (that is the exact blank-output failure class the
# Close-Out Gate exists to catch).
resolve_claude() {
    if [ -n "${ALEX_CLAUDE_BIN:-}" ]; then
        [ -x "$ALEX_CLAUDE_BIN" ] || die "ALEX_CLAUDE_BIN=$ALEX_CLAUDE_BIN is not executable"
        CLAUDE="$ALEX_CLAUDE_BIN"
        export CLAUDE
        return 0
    fi
    if command -v claude >/dev/null 2>&1; then
        CLAUDE="$(command -v claude)"
        export CLAUDE
        return 0
    fi
    if [ -x "$HOME/.local/bin/claude" ]; then
        CLAUDE="$HOME/.local/bin/claude"
        export CLAUDE
        return 0
    fi
    _npm_prefix=""
    if command -v npm >/dev/null 2>&1; then
        _npm_prefix="$(npm prefix -g 2>/dev/null)"
    fi
    if [ -n "$_npm_prefix" ] && [ -x "$_npm_prefix/bin/claude" ]; then
        CLAUDE="$_npm_prefix/bin/claude"
        unset _npm_prefix
        export CLAUDE
        return 0
    fi
    unset _npm_prefix
    die "claude CLI not found (tried \$ALEX_CLAUDE_BIN, PATH, ~/.local/bin, npm global prefix). Install it or set ALEX_CLAUDE_BIN."
}

# --- log_init: open the run log and a temp file for captured output ------------------------------
# Sets $LOG (append-only run log, read by the checkers) and $TMPOUT (a real temp FILE, because
# process substitution <(...) is a bashism the close-out CLI should not depend on).
# Registers a trap so $TMPOUT is always removed, including on SIGINT/SIGTERM, not just clean exit.
log_init() {
    [ -n "${1:-}" ] || die "log_init requires a job name"
    _alex_job="$1"
    mkdir -p "$ALEX_ROOT/outputs/logs" || die "cannot create outputs/logs"
    LOG="$ALEX_ROOT/outputs/logs/${_alex_job}.log"
    export LOG
    TMPOUT="$(mktemp "${TMPDIR:-/tmp}/alex-${_alex_job}.XXXXXX")" || die "mktemp failed"
    export TMPOUT
    # shellcheck disable=SC2064  # expand TMPOUT now, on purpose: the trap must know the real path
    trap "rm -f '$TMPOUT'" EXIT INT TERM
    # The wrapper's own absolute path, for the Close-Out Gate's retry ladder. PowerShell sniffed it
    # from Get-PSCallStack; bash has no equivalent, so it is captured here once and passed on.
    ALEX_WRAPPER="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    export ALEX_WRAPPER
    echo "=== run $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"
    unset _alex_job
}

# --- parse_common_flags: the flags every wrapper accepts -----------------------------------------
# --dry-run  : no HQ pushes, no retry registration (sets ALEX_DRY_RUN, honored by close-out.mjs)
# --claude X : swap the claude binary, the -ClaudeCmd parameter the PowerShell wrappers carried for
#              stub-testing. It maps onto the ALEX_CLAUDE_BIN override resolve_claude already reads.
parse_common_flags() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --dry-run) ALEX_DRY_RUN=1; export ALEX_DRY_RUN ;;
            --claude)  shift; ALEX_CLAUDE_BIN="${1:-}"; export ALEX_CLAUDE_BIN ;;
            *)         die "unknown flag: $1 (accepted: --dry-run, --claude <path>)" ;;
        esac
        shift
    done
}

# --- the Close-Out Gate, from bash ---------------------------------------------------------------
# Every one of these is a one-line hop into scripts/lib/close-out.mjs, which is where the logic
# lives by design (migration plan §0): bash does process plumbing, Node does judgment. Keeping the
# hops here means a wrapper reads as the ~25 lines of plumbing it actually is.

_close_out_mjs() { echo "$ALEX_ROOT/scripts/lib/close-out.mjs"; }

# quota_gate <project> -> returns non-zero when this slot should be SKIPPED (plan capped, and this
# project is not a budget-priority winner). An amber run_status is already pushed by then. Use as:
#     quota_gate 'crm' || exit 0
# Fail-open lives inside close-out.mjs: any internal error returns "proceed", never "skip".
quota_gate() {
    node "$(_close_out_mjs)" quota-gate --log "$LOG" --project "${1:-}"
}

# alex_claude <args...> -> runs the CLI, capturing combined output into $OUT and its code into $CODE,
# and appends the output to the log. Never aborts the wrapper on a non-zero exit: judging that code
# is the Close-Out Gate's job, and a wrapper that dies here would skip its own RED push.
alex_claude() {
    resolve_claude
    set +e
    OUT="$("$CLAUDE" "$@" 2>&1)"
    CODE=$?
    set -e
    printf '%s\n' "$OUT" >> "$LOG"
}

# close_out <project> <exit-code> [degraded-reason] -> the A1/A4 gate. Exits 1 on a detected
# failure, so calling it as a wrapper's last statement gives the wrapper the right exit code.
# Pass '' as the project for a wrapper with no run_status tile.
close_out() {
    _co_project="${1:-}"
    _co_code="${2:-0}"
    _co_reason="${3:-}"
    printf '%s' "${OUT:-}" > "$TMPOUT"
    _co_args=(check --log "$LOG" --project "$_co_project" --code "$_co_code" \
              --out-file "$TMPOUT" --wrapper "$ALEX_WRAPPER")
    if [ -n "$_co_reason" ]; then
        _co_args=("${_co_args[@]}" --degraded-reason "$_co_reason")
    fi
    if [ -n "${ALEX_DRY_RUN:-}" ]; then
        _co_args=("${_co_args[@]}" --dry-run)
    fi
    node "$(_close_out_mjs)" "${_co_args[@]}"
}

# hq_push <project> <status> <headline> [metric_key] [value_num]
# The GREEN/AMBER heartbeat several wrappers send on success. The token stays inside Node: it is
# never an argument here, so it never appears in `ps` output. Always returns 0 - an undeliverable
# heartbeat is a logged problem, never a failed run.
hq_push() {
    _hq_args=(hq-push --log "$LOG" --project "${1:-}" --status "${2:-green}" --headline "${3:-}")
    if [ -n "${4:-}" ]; then _hq_args=("${_hq_args[@]}" --metric "$4"); fi
    if [ -n "${5:-}" ]; then _hq_args=("${_hq_args[@]}" --value "$5"); fi
    if [ -n "${ALEX_DRY_RUN:-}" ]; then _hq_args=("${_hq_args[@]}" --dry-run); fi
    node "$(_close_out_mjs)" "${_hq_args[@]}" || true
}

# --- the soul canary, from bash ------------------------------------------------------------------
# soul_arm  -> sets $SOUL_NONCE and $SOUL_INSTRUCTION when soul.md carries a canary token; leaves
#              both EMPTY when it does not. Inert-unless-armed is the whole safety property: an
#              untokened soul.md must never manufacture a daily false red.
# soul_check <project> -> returns non-zero on a canary miss. Voice-shipping lanes route that into
#              close_out's degraded-reason rather than exiting on their own, so exactly one HQ push
#              happens and it carries the precise reason (stress-test fix F-04).
_soul_canary_mjs() { echo "$ALEX_ROOT/scripts/lib/soul-canary.mjs"; }

soul_arm() {
    SOUL_NONCE=""
    SOUL_INSTRUCTION=""
    if node "$(_soul_canary_mjs)" armed >/dev/null 2>&1; then
        SOUL_NONCE="$(node "$(_soul_canary_mjs)" nonce)"
        SOUL_INSTRUCTION="$(node "$(_soul_canary_mjs)" instruction --nonce "$SOUL_NONCE")"
    fi
}

soul_check() {
    [ -n "${SOUL_NONCE:-}" ] || return 0   # not armed: inert, never a failure
    printf '%s' "${OUT:-}" > "$TMPOUT"
    _sc_args=(assert --nonce "$SOUL_NONCE" --log "$LOG" --out-file "$TMPOUT" --soft-fail)
    if [ -n "${1:-}" ]; then _sc_args=("${_sc_args[@]}" --project "$1"); fi
    if [ -n "${ALEX_DRY_RUN:-}" ]; then _sc_args=("${_sc_args[@]}" --dry-run); fi
    node "$(_soul_canary_mjs)" "${_sc_args[@]}"
}

# The reason string a voice-shipping lane hands to close_out on a canary miss. One wording, so the
# HQ headline reads the same whichever lane produced it.
SOUL_MISS_REASON='soul canary failed: soul.md did not reach the model this run (voice-shipping lane, drafts are written in his name)'

# --- alex_verdict_instruction: the completion-sentinel string ------------------------------------
# THE SINGLE SOURCE is close-out.mjs, exactly as it was $AlexVerdictInstruction in close-out.ps1:
# one definition, so a future format change is one edit. Wired in Phase 2; this helper exists now
# so the wrappers written in Phase 3 have a stable name to call.
alex_verdict_instruction() {
    _co="$ALEX_ROOT/scripts/lib/close-out.mjs"
    [ -f "$_co" ] || die "close-out.mjs not found at $_co (Phase 2 of the bash migration is not done)"
    node "$_co" verdict-instruction || die "could not read the verdict instruction from close-out.mjs"
    unset _co
}
