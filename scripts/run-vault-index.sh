#!/usr/bin/env bash
# Nightly vault-search index rebuild (upgrade-scan item 1, built 2026-07-07).
# ZERO LLM tokens - pure Python/SQLite + Node, same class as work/18-recovery-layer/check.mjs.
# Rebuilds the FTS5 keyword index over vault/**/*.md so cross-session recall scales past
# read-the-index-and-drill (2026-07-06 audit weakness 2). The .db lives in a gitignored in-repo dir,
# so the 21:45 encrypted vault backup picks it up automatically; it is also fully regenerable from
# the markdown, so a missed night is harmless.
# Scheduled: PersonalOS-vault-index nightly 21:35 (before the 21:45 vault backup).
# On failure: log + RED infra/vault_index to Alex HQ (never silent). No retry ladder (not a claude
# run; the next night rebuilds, and on-demand `build` is always available).
#
# THREE INDEPENDENT LANES, and the independence is the design (2026-07-25): the FTS5 index, the
# Recall Spine fact harvest, and the lesson harvest each report their own health. A harvest tripwire
# pushes its OWN red metric without marking the index job red, and vice versa - so one lane failing
# never hides or fakes the state of another.
#
# bash 3.2-compatible (ruling F). Declared deterministic_no_pin: it makes no claude call.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "vault-index"

# Resolve python: an in-repo venv first (so a pinned interpreter wins), then PATH. The Windows
# per-user-install fallback (%LOCALAPPDATA%\Programs\Python\Python312) is gone with the platform.
if [ -x "$ALEX_ROOT/.venv/bin/python3" ]; then
    PY="$ALEX_ROOT/.venv/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python3)"
else
    PY=""
fi

# ---- 0. S1 Compiled Surfaces P2 (2026-08-16): rotate over-budget status.md files BEFORE the index
# build, so tonight's index already reflects the moves (a block searched right after rotation must
# resolve to its history/ home, not a stale chunk). Best-effort + write-locked (defer = exit 2);
# an unchanged estate is a fast no-op; C24 (Monday) ambers on any file still over budget.
if [ -z "${ALEX_DRY_RUN:-}" ]; then
    set +e
    rot_out="$(node "$ALEX_ROOT/scripts/status-rotate.js" 2>&1)"
    rot_code=$?
    set -e
    printf '%s\n' "$rot_out" | grep 'status-rotate:' | tail -n 1 >> "$LOG" || true
    [ "$rot_code" -ne 1 ] || echo "status-rotate FAILED (exit 1) - see log above" >> "$LOG"
fi

# ---- 1. The FTS5 index -------------------------------------------------------------------------
reason=""
chunks=0
if [ -z "$PY" ]; then
    reason="python3 not found on PATH or in .venv"
elif [ -n "${ALEX_DRY_RUN:-}" ]; then
    echo "DRYRUN: would run $PY scripts/vault_search.py build" >> "$LOG"
else
    set +e
    idx_out="$("$PY" "$ALEX_ROOT/scripts/vault_search.py" build 2>&1)"
    idx_code=$?
    set -e
    printf '%s\n' "$idx_out" >> "$LOG"
    if [ "$idx_code" -ne 0 ]; then
        reason="indexer exit $idx_code"
    else
        chunks="$(printf '%s' "$idx_out" | sed -n 's/.*indexed  *[0-9][0-9]*  *files  *->  *\([0-9][0-9]*\)  *chunks.*/\1/p' | tail -n 1)"
        [ -n "$chunks" ] || chunks=0
        # A suspiciously small index is a REFUSAL, not a green run. Same family as the vault-backup
        # thin-blob guards: shipping a nearly-empty index quietly would break recall for a week
        # before anyone noticed the searches had gone bad.
        if [ "$chunks" -lt 50 ]; then
            reason="index suspiciously small ($chunks chunks) - refusing to report green"
        else
            echo "built: $chunks chunks" >> "$LOG"
        fi
    fi
fi
[ -z "$reason" ] || echo "FAILED: $reason" >> "$LOG"

# ---- 2. Recall Spine bi-temporal fact ledger (2026-07-25) ---------------------------------------
# Populates facts.db beside the vault index. Zero-token Node/SQLite, same class as the index build.
recall_reason=""
recall_summary=""
if [ -z "${ALEX_DRY_RUN:-}" ]; then
    set +e
    rec_out="$(node "$ALEX_ROOT/system/recall/harvest.js" --quiet 2>&1)"
    rec_code=$?
    set -e
    printf '%s\n' "$rec_out" >> "$LOG"
    if [ "$rec_code" -ne 0 ]; then
        recall_reason="harvest exit $rec_code (mass-drift tripwire or fatal - see log)"
        echo "recall harvest FAILED: $recall_reason" >> "$LOG"
    else
        recall_summary="$(printf '%s' "$rec_out" | grep 'inserted=' | tail -n 1 || true)"
        echo "recall harvest: $recall_summary" >> "$LOG"
    fi
fi

# ---- 3. Lesson harvest (Recall Spine Phase 3) ---------------------------------------------------
# Harvests Close-Out L-lines into the lessons table (idempotent, cursor-based). BEST-EFFORT by
# design: lessons are a compounding nicety, not a correctness gate, so a failure here logs and moves
# on rather than reddening a night where the index and the ledger both landed fine.
if [ -z "${ALEX_DRY_RUN:-}" ]; then
    set +e
    les_out="$(node "$ALEX_ROOT/scripts/lesson-harvest.js" 2>&1)"
    les_code=$?
    set -e
    printf '%s' "$les_out" | grep 'processed=' | tail -n 1 | sed 's/^/lesson harvest: /' >> "$LOG" || true
    [ "$les_code" -eq 0 ] || echo "lesson harvest exit $les_code" >> "$LOG"
fi

# ---- 3b. S1 Compiled Surfaces (2026-08-16): nightly soul-core.md rebuild beside the index, so a
# harvest-day corpus change reaches the injection card the same night (run-44 condition 1: without
# this the freshness story erases the win on harvest days). Best-effort: a builder failure or a
# busy write-lock (exit 2 = deferred) never fails the index job; an unchanged soul.md is a verified
# no-op; C23 (Monday sweep) + the hq-heal-map row guard real staleness.
if [ -z "${ALEX_DRY_RUN:-}" ]; then
    set +e
    sc_out="$(node "$ALEX_ROOT/scripts/lib/build-soul-core.js" 2>&1)"
    sc_code=$?
    set -e
    printf '%s\n' "$sc_out" | grep -E 'soul-core|deferred|FAILED' | tail -n 1 | sed 's/^/soul-core: /' >> "$LOG" || true
    [ "$sc_code" -ne 1 ] || echo "soul-core rebuild FAILED (exit 1) - existing card untouched" >> "$LOG"
fi

# ---- 3c. S1 Compiled Surfaces P2 (2026-08-16): monthly n8n-backup pack (self-gates to one run per
# calendar month via system/n8n-backup-rotate-state.json, so the daily call is a no-op the rest
# of the time). Keeps newest 5 per workflow + everything <30d loose; older into verified tar.gz
# packs with MANIFEST + archive-ledger rows. Best-effort; a pack failure never fails the job.
if [ -z "${ALEX_DRY_RUN:-}" ]; then
    set +e
    nbr_out="$(node "$ALEX_ROOT/scripts/n8n-backup-rotate.js" 2>&1)"
    nbr_code=$?
    set -e
    printf '%s\n' "$nbr_out" | grep 'n8n-backup-rotate' | tail -n 1 >> "$LOG" || true
    [ "$nbr_code" -eq 0 ] || echo "n8n-backup-rotate exit $nbr_code (non-fatal)" >> "$LOG"
fi

# ---- 4. Alex HQ pushes (best-effort; the token never leaves Node) -------------------------------
if [ -z "$reason" ]; then
    hq_push 'infra' 'green' "vault index rebuilt ($chunks chunks)" 'vault_index' "$chunks"
else
    hq_push 'infra' 'red' "vault index FAILED: $reason" 'vault_index' 0
fi

if [ -z "${ALEX_DRY_RUN:-}" ]; then
    if [ -z "$recall_reason" ]; then
        if [ -n "$recall_summary" ]; then
            hq_push 'infra' 'green' "recall ledger ok: $recall_summary" 'recall_facts' 0
        else
            hq_push 'infra' 'green' 'recall ledger ok' 'recall_facts' 0
        fi
    else
        hq_push 'infra' 'red' "recall harvest FAILED: $recall_reason" 'recall_facts' 0
    fi
fi

if [ -z "$reason" ]; then
    echo "OK ($chunks chunks)" >> "$LOG"
    exit 0
fi
exit 1
