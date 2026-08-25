#!/usr/bin/env bash
# Daily git backup to GitHub (Recovery Phase 0, built 2026-07-02).
# Commits the whole tree (respecting .gitignore) and pushes to the PUBLIC alex-kiarash-ai/personal-os
# repo (public since 2026-07-16; .gitignore is the SOLE privacy barrier). On any failure: log + RED
# run_status push to Alex HQ so a dead backup is never silent. Success pushes GREEN.
# Plan + runbook: vault/projects/recovery/github-backup-plan.md
#
# bash 3.2-compatible (ruling F). The `cmd /c "git push ..."` wrapper is GONE with the platform: it
# existed only because PowerShell 5.1 turns a native command's stderr into terminating
# NativeCommandError records (W17).
set -uo pipefail   # NOT -e: this script decides its own failure semantics and must always reach its
                   # HQ push. A backup that dies before it can report that it died is the exact
                   # failure class this whole layer exists to prevent.
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "git-backup"

reason=""
changed=0

git add -A >> "$LOG" 2>&1 || reason="git add failed (exit $?)"

# --- P2.6 GUARDED STAGING (run-47 merged plan, 2026-08-23; closes run-46 finding N10) ----------
# The default-deny .gitignore covers system/, work/*/state/, .bak, soul-*, vault/ and outputs/,
# but a personal file dropped at a work/NN ROOT or into scripts/ falls in the residual positive
# space, and an unattended `git add -A` at 21:30 sweeps it onto a PUBLIC repo. That is exactly the
# class that burned on 2026-07-20 (four personal files public), and the barrier is one .gitignore
# miss thick. So: before committing, every staged path in those two shapes is scanned; a hit
# means that path is unstaged and the run logs AMBER naming it. A false positive costs one file
# one day of backup, loudly. The alternative costs a permanently cacheable leak.
# Reuses the SAME scanner and the SAME --staged mode the pre-commit hook runs, deliberately: a
# second scanning path would be a second thing to keep correct. Stage, scan, then unstage only
# the residual-risk shapes that were flagged.
blocked=""
if [ -z "$reason" ]; then
    scan_raw="$(node scripts/personal-data-scan.js --staged --json 2>&1)" || true
    blocked="$(printf '%s' "$scan_raw" | node -e '
        let s = "";
        process.stdin.on("data", d => s += d).on("end", () => {
          try {
            const j = JSON.parse(s);
            if (j.clean) return;
            const seen = {};
            for (const h of (j.hits || [])) {
              const f = h && h.file;
              if (f && !seen[f] && /^(work\/[^\/]+\/[^\/]+$|scripts\/)/.test(f)) { seen[f] = 1; console.log(f); }
            }
          } catch (e) { process.exit(3); }
        });' 2>/dev/null)" || {
        echo "personal-data guard: scan output unparseable, staging left as-is: $scan_raw" >> "$LOG"
        blocked=""
    }
fi
if [ -n "$blocked" ]; then
    # A blocked file must not hold the whole backup hostage: the rest of the day's work still
    # needs its off-machine copy tonight, so unstage only the flagged paths and say so loudly.
    held=0; held_list=""
    while IFS= read -r b; do
        [ -n "$b" ] || continue
        git reset -q -- "$b" >> "$LOG" 2>&1
        held=$((held + 1))
        held_list="${held_list:+$held_list, }$b"
    done <<EOF
$blocked
EOF
    echo "AMBER personal-data guard: held back $held path(s): $held_list - review, then either gitignore them or move them out of the repo" >> "$LOG"
fi

if [ -z "$reason" ]; then
    changed="$(git diff --cached --name-only | wc -l | tr -d ' ')"
    if [ "$changed" -gt 0 ]; then
        msg="Daily backup $(date '+%Y-%m-%d %H:%M') ($changed files)"
        if [ -n "${ALEX_DRY_RUN:-}" ]; then
            echo "DRYRUN: would commit '$msg'" >> "$LOG"
        else
            if ! git commit -m "$msg" >> "$LOG" 2>&1; then
                reason="git commit failed"
            fi
        fi
    else
        echo "no changes to commit" >> "$LOG"
    fi
fi

# Push even on no-change days: this recovers from a previously failed push.
# BUG-17 fix (2026-07-15): push the CURRENT branch, not a hardcoded 'main'. A commit on a feature
# branch never reached GitHub - `git push origin main` no-op'd (exit 0) and reported GREEN while the
# day's work sat unpushed. The backup now covers whatever branch is live.
br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
[ -n "$br" ] || br="main"

if [ -z "$reason" ] && [ -z "${ALEX_DRY_RUN:-}" ]; then
    if ! git push origin "$br" >> "$LOG" 2>&1; then
        reason="git push failed (branch $br) - network or expired PAT?"
    fi
fi

# --- Alex HQ push (build #16 contract). The token never leaves Node; a push failure never changes
# this script's exit code.
if [ -z "$reason" ]; then
    hq_push 'recovery' 'green' "backup pushed ($changed files changed, branch $br)" 'run_status' 1
else
    hq_push 'recovery' 'red' "backup FAILED: $reason" 'run_status' 0
fi

if [ -z "$reason" ]; then
    echo "OK ($changed files)" >> "$LOG"
    exit 0
fi
echo "FAILED: $reason" >> "$LOG"
exit 1
