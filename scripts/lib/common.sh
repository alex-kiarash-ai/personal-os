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
    echo "=== run $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"
    unset _alex_job
}

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
