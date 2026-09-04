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
# Prompt cache TTL (2026-08-28, report Phase 0 cost item). Measured across 558 session logs:
# cache WRITES are ~90% of token cost, because the default 5-minute cache expires mid-run while
# tool calls are slow, so one scheduled run rebuilds its own ~60k-token prefix dozens of times.
# ENABLE_PROMPT_CACHING_1H is the documented switch (code.claude.com/docs/en/env-vars).
#
# Two caveats kept here rather than in a commit message, because both decide whether this HELPS:
#  1. A 1-hour cache WRITE bills at 2x input against the 5-minute write at 1.25x. It only pays on a
#     high-churn workload. These runs are high-churn by measurement; a future low-churn job is not,
#     and would cost MORE with this on.
#  2. Subscription users inside included usage already get a 1-hour TTL automatically, so on those
#     runs this is a no-op. It bites when a run draws on usage credits.
# So this is set, not claimed: re-measure before quoting a saving.
export ENABLE_PROMPT_CACHING_1H=1

log_init() {
    [ -n "${1:-}" ] || die "log_init requires a job name"
    _alex_job="$1"
    mkdir -p "$ALEX_ROOT/outputs/logs" || die "cannot create outputs/logs"
    LOG="$ALEX_ROOT/outputs/logs/${_alex_job}.log"
    export LOG
    TMPOUT="$(mktemp "${TMPDIR:-/tmp}/alex-${_alex_job}.XXXXXX")" || die "mktemp failed"
    export TMPOUT
    # shellcheck disable=SC2064  # expand TMPOUT now, on purpose: the trap must know the real path
    # The EXIT trap ALSO emits the C31 dead-man signal (stress-test S-D3), so the zero-token scripts
    # that never call close_out (vault-backup, git-backup, run-vault-index, auth-check) still prove
    # they ran. $? is captured FIRST because the rm resets it. A script that overrides this EXIT trap
    # must call alex_signal_exit itself.
    trap "_alex_rc=\$?; rm -f '$TMPOUT'; alex_signal_exit \"\$_alex_rc\"" EXIT INT TERM
    # The wrapper's own absolute path, for the Close-Out Gate's retry ladder. PowerShell sniffed it
    # from Get-PSCallStack; bash has no equivalent, so it is captured here once and passed on.
    ALEX_WRAPPER="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    export ALEX_WRAPPER
    # C31 dead-man switch: the scheduler task name this wrapper answers to. The registry keys on the
    # Task Scheduler name, and a wrapper's job name is that name minus the prefix, so it is derived once
    # here rather than repeated in 20 wrappers. A wrapper whose name differs overrides ALEX_TASK_NAME
    # before calling log_init (run-lint.sh is the one such case).
    ALEX_TASK_NAME="${ALEX_TASK_NAME:-PersonalOS-${_alex_job}}"
    export ALEX_TASK_NAME
    # --- P1.1 RUN ID (run-47 merged plan, 2026-08-23): the shared join key ------------------------
    # Three write-paths record the same run - vault/log.md prose, outputs/ledger.jsonl rows, and
    # system/heal-log.jsonl - and NONE of them shared a key, so "what else happened in that run?"
    # was a manual excavation across three formats and three clock conventions (run-46 defect D1).
    # Both run-47 research lanes proposed this identical fix independently without seeing each
    # other, which is the strongest internal signal that pipeline produces.
    # Defined HERE because every scheduled wrapper calls log_init before it does anything: one
    # definition, 17 wrappers, no per-wrapper drift. Interactive sessions simply have no
    # ALEX_RUN_ID, and that absence is itself information (it means "a human was driving").
    # Shape: <job>-<yyyyMMddHHmm> in UTC. UTC because P1.2 makes every machine-written stamp UTC-Z,
    # and a join key that shifts twice a year is not a key.
    if [ -z "${ALEX_RUN_ID:-}" ]; then
        ALEX_RUN_ID="${_alex_job}-$(date -u '+%Y%m%d%H%M')"
        export ALEX_RUN_ID
    fi
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

# --- P3.8 STALL WATCHDOG (run-47 merged plan, 2026-08-23; ported from close-out.ps1) -------------
# The only backstop against a hung `claude -p` used to be the scheduler's own job time limit
# (PT2H under Task Scheduler; the systemd units carry no RuntimeMaxSec at all). Two problems with
# that as the sole guard: it burns up to two hours of the usage window on a run that is already
# dead; and when the scheduler kills the process the wrapper never reaches close_out, so there is
# no RED push and no log line - the run simply vanishes, which is the "job cannot announce its own
# failure" class this whole layer exists to kill.
#
# run_with_watchdog <timeout-minutes> <cmd...> runs the command with a wall-clock cap well under
# any scheduler limit, kills the process GROUP on breach (GNU timeout signals the group when run
# non-foreground; a child that setsids away escapes, accepted), and sets a distinct STALLED flag
# with CODE=124 so the caller can push RED with a diagnosable state rather than a generic failure.
# Stall and failure are different diagnoses and must not share a word.
#
# NOT WIRED INTO ANY WRAPPER, deliberately: changing how 17 live scheduled jobs invoke claude is
# the highest-blast-radius edit in the whole plan, and it belongs in its own session with
# per-wrapper verification. The function ships proven so adoption is a one-line change per wrapper
# (alex_claude ... -> run_with_watchdog 25 "$CLAUDE" ...). Sets $OUT/$CODE/$STALLED like
# alex_claude sets $OUT/$CODE.
run_with_watchdog() {
    _wd_min="${1:-25}"   # generous: a real brief/triage run is minutes
    shift
    STALLED=""
    if command -v timeout >/dev/null 2>&1; then
        set +e
        OUT="$(timeout --signal=TERM --kill-after=30 "$((_wd_min * 60))" "$@" 2>&1)"
        CODE=$?
        set -e
        if [ "$CODE" -eq 124 ] || [ "$CODE" -eq 137 ]; then
            STALLED=1
            CODE=124
            echo "STALLED: no exit after ${_wd_min} min - process group killed (run=${ALEX_RUN_ID:-})" >> "$LOG"
        fi
    else
        # No coreutils timeout on this box (macOS ships without it): run uncapped and say so,
        # loudly, so the absence of the guard is a logged fact rather than a silent downgrade.
        echo "watchdog: 'timeout' not found - running UNCAPPED" >> "$LOG"
        set +e
        OUT="$("$@" 2>&1)"
        CODE=$?
        set -e
    fi
    printf '%s\n' "$OUT" >> "$LOG"
    unset _wd_min
}

# close_out <project> <exit-code> [degraded-reason] -> the A1/A4 gate. Exits 1 on a detected
# failure, so calling it as a wrapper's last statement gives the wrapper the right exit code.
# Pass '' as the project for a wrapper with no run_status tile.
# --- C31 dead-man switch: emit the task completion signal (recovery check C31).
# THE CONTRACT: this is the LAST thing a wrapper does, and it runs on success AND on failure, because
# the two carry different verdicts. A fresh signal with exit 0 is green; a fresh signal with a nonzero
# exit is WENT-WRONG (it ran, finished, and reported its own failure); NO signal inside the task's
# window is MISSING, which is what a process that never started or died mid-run produces.
#
# Why it exists: on ~2026-08-25 all 23 scheduled jobs failed silently for two days because they invoked
# wrapper scripts a platform migration had deleted, and the failure reporter lived INSIDE the wrapper
# that never launched. Absence is the only signal that survives that, so absence is what C31 reads.
#
# Deliberately dependency-free and non-fatal: an append that fails must never take down the run it is
# reporting on, and it must not need node, jq or the network.
task_signal() {
    # Idempotent per process (stress-test S-D3, 2026-09-04): both close_out and the log_init EXIT
    # trap call this, and close_out runs FIRST carrying the accurate determined code, so first-call
    # wins and the trap's later call with a raw $? is skipped. A script that never reaches close_out
    # (the zero-token backups, a git-backup that exits on a failed push) still signals via the trap.
    [ -n "${_ALEX_SIGNALLED:-}" ] && return 0
    _ts_task="${ALEX_TASK_NAME:-${1:-}}"
    _ts_code="${2:-0}"
    [ -n "$_ts_task" ] || return 0
    [ -n "${ALEX_DRY_RUN:-}" ] && return 0
    _ts_file="${ALEX_ROOT:-.}/system/task-signals.jsonl"
    _ts_when="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || return 0
    printf '{"task":"%s","at":"%s","exit":%s,"wrapper":"%s"}\n'         "$_ts_task" "$_ts_when" "$_ts_code" "${ALEX_WRAPPER:-unknown}" >> "$_ts_file" 2>/dev/null || true
    _ALEX_SIGNALLED=1
    return 0
}

# EXIT-trap signal: fire the C31 dead-man signal no matter HOW the script ends - an early exit, an
# error, or a path that never reaches close_out. log_init installs this on the EXIT trap; a script
# that sets its OWN EXIT trap (vault-backup, auth-check) must call this from it. Idempotent via
# task_signal's guard, so close_out's accurate-code call still wins when it runs. (stress-test S-D3.)
alex_signal_exit() { task_signal "" "${1:-$?}"; }

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
    _co_rc=$?
    # FINAL ACT. After close-out has run, and carrying the run's real exit code, so C31 can tell a job
    # that reported its own failure from a job that never ran at all.
    task_signal "" "$_co_code"
    return $_co_rc
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
