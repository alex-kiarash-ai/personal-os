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
        # A07-T13 (2026-09-10): this failed OPEN. An unparseable scan set `blocked=""`, the unstage
        # block below never ran, and the full `git add -A` set was committed and PUSHED to the PUBLIC
        # repo. The one moment the guard cannot see is exactly the moment to hold back, and on this
        # repo .gitignore is the sole barrier, so the cost of a wrong open is unrecoverable while the
        # cost of a wrong hold is one missed nightly commit. Fail CLOSED on the two residual shapes
        # the guard exists to catch: a new file at a work/NN root, and anything under scripts/.
        echo "AMBER personal-data guard: scan output unparseable - failing CLOSED on the residual shapes: $scan_raw" >> "$LOG"
        blocked="$(git diff --cached --name-only | grep -E '^(work/[^/]+/[^/]+$|scripts/)' || true)"
    }
fi
# --- A16-T-02 (2026-09-11): the sweep must never be the thing that PUBLISHES a new file. -------
# The P2.6 scan above catches personal data it can PATTERN-MATCH: names, numbers, key shapes. A
# personal document whose sensitivity lives in its PROSE passes it, passes gitleaks, passes V10 and
# V11, and an unattended `git add -A` puts it on a public repo permanently. No scanner fixes that,
# because the property being detected is meaning.
#
# So the rule is structural rather than semantic: this job commits MODIFICATIONS to files a human
# already chose to track, and holds every NEW path in the residual-risk space until a session runs
# `git add` on it deliberately. A file the sweep held is still on disk and still in tonight's
# encrypted vault blob; only its publication waits for a human. That is the correct side to err on
# when .gitignore is the sole barrier and a push is permanently cacheable.
if [ -z "$reason" ]; then
    new_paths="$(git diff --cached --name-only --diff-filter=A | grep -E '^(work/[^/]+/[^/]+$|scripts/|docs/|brand/)' || true)"
    if [ -n "$new_paths" ]; then
        blocked="${blocked:+$blocked
}$new_paths"
        echo "AMBER new-path hold: the nightly sweep does not publish new files; a session must git add them deliberately" >> "$LOG"
    fi
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
    # A07-T11 (2026-09-10): every push failure reported the same sentence, "network or expired PAT?",
    # and that string is what reaches the HQ RED headline. A refused protected branch, a detached
    # HEAD and a dead remote are three different problems with three different fixes, and the one
    # line a human reads named none of them. Capture the output and say which it was.
    push_err="$(git push origin "$br" 2>&1)"; push_rc=$?
    printf '%s\n' "$push_err" >> "$LOG"
    if [ "$push_rc" -ne 0 ]; then
        case "$br" in
            HEAD)  reason="git push failed - detached HEAD, so there is no branch to push (check out a branch)" ;;
            main)  reason="git push failed - main is branch-protected by design; work belongs on a branch and reaches main by PR" ;;
            *)
                case "$push_err" in
                    *protected*|*"pre-receive hook declined"*) reason="git push failed (branch $br) - refused by branch protection" ;;
                    *"Authentication failed"*|*"could not read Username"*|*"Invalid username or password"*) reason="git push failed (branch $br) - authentication refused, the PAT is expired or revoked" ;;
                    *"unqualified destination"*|*"not a full refname"*) reason="git push failed (branch $br) - unqualified destination refspec" ;;
                    *"Could not resolve host"*|*"Failed to connect"*|*"Connection timed out"*) reason="git push failed (branch $br) - network unreachable" ;;
                    *) reason="git push failed (branch $br) - see outputs/logs/git-backup.log for git's own message" ;;
                esac ;;
        esac
    fi
    # A16-T-02, second half: Verify-after-write. A push that exits 0 is not proof the remote moved
    # (the 07-15 BUG-17 no-op exited 0 and reported GREEN for days). Read the remote ref back and
    # compare it to what we just pushed.
    if [ -z "$reason" ]; then
        local_head="$(git rev-parse HEAD 2>/dev/null || true)"
        remote_head="$(git ls-remote origin "refs/heads/$br" 2>/dev/null | awk '{print $1}')"
        if [ -z "$remote_head" ]; then
            reason="git push reported success but origin/$br does not exist on the remote (read-back found no ref)"
        elif [ "$remote_head" != "$local_head" ]; then
            reason="git push reported success but origin/$br is $remote_head, not the pushed $local_head"
        else
            echo "push read-back OK: origin/$br = $local_head" >> "$LOG"
        fi
    fi
fi

# --- Alex HQ push (build #16 contract). The token never leaves Node; a push failure never changes
# this script's exit code.
if [ -z "$reason" ]; then
    hq_push 'recovery' 'green' "backup pushed ($changed files changed, branch $br)" 'run_status' 1
else
    hq_push 'recovery' 'red' "backup FAILED: $reason" 'run_status' 0
    # --- A05-T-08 (2026-09-11): a LOCAL fallback for the RED. ---------------------------------
    # The two ways this job reports a failure are the git push and the HQ push, and both go over
    # the same network. A DNS outage, a dead router or a captive portal takes GitHub and HQ
    # together, so the single most important failure this system can have - the off-machine backup
    # did not happen - is reported to nobody and looks exactly like a quiet successful night.
    # hq_push returns 0 by design (an undeliverable heartbeat must never red a healthy job), so it
    # cannot be branched on; the row is written unconditionally on the failure path and the next
    # interactive session flushes it. Cheap, local, and it survives the network being the problem.
    printf '%s
' "$(node -e '
      const fs=require("fs"),p="system/pending-writes.jsonl";
      const row={ts:new Date().toISOString(),kind:"hq-red",project:"recovery",metric:"run_status",
        headline:"backup FAILED: "+(process.argv[1]||"unknown"),
        note:"written locally by git-backup.sh because the HQ push may have failed for the same network reason the git push did"};
      try{fs.appendFileSync(p,JSON.stringify(row)+"
","utf8");process.stdout.write("queued a local RED to "+p);}
      catch(e){process.stdout.write("could not queue the local RED: "+e.message);}
    ' "$reason")" >> "$LOG" 2>&1 || true
fi

if [ -z "$reason" ]; then
    echo "OK ($changed files)" >> "$LOG"
    exit 0
fi
echo "FAILED: $reason" >> "$LOG"
exit 1
