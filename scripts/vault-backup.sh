#!/usr/bin/env bash
# Encrypted local-only backup (Recovery Phase 1, built 2026-07-04).
#
# The git backup only covers the FUNCTIONAL system (code + how-it-works docs). The PRIVACY SCRUB
# (2026-07-04) keeps the vault, soul.md, CV/financial data, secrets and workflow exports LOCAL-ONLY,
# so they had no off-machine copy. This job fills that gap: tar everything git IGNORES (minus
# regenerable junk), gpg-symmetric-encrypt it (AES256), and ship the single .gpg blob to the Hetzner
# box plus a second independent destination. On any failure: log + RED run_status to Alex HQ.
#
# The include set is DERIVED FROM .gitignore, so it cannot drift from what is local-only. That logic
# lives in scripts/lib/backup-include.mjs (list-building and JSON are not shell work); this file does
# tar, gpg, ship and prune, which are.
#
# Passphrase file: its path is read from the gitignored credentials ledger
#   (system/credentials-ledger.json, id=vault-backup-gpg-passphrase, local_path), NOT hardcoded here,
#   so this tracked/PUBLIC script never names the local secret path (F-04, 2026-07-21).
#   >>> The SAME passphrase must also live in Shaheen's password manager, or an off-machine .gpg is
#       unrecoverable if this machine dies. That is what escrow-test.mjs proves every 90 days. <<<
#
# GONE WITH THE PLATFORM: the System32\tar.exe pin and its six-line comment about GNU tar reading
# "C:\..." as a remote host spec (W12), and the BOM/CRLF special-casing of the -T list file. GNU tar
# is simply the tar here.
#
# bash 3.2-compatible (ruling F). Runbook: vault/projects/recovery/vault-backup-plan.md
set -uo pipefail   # NOT -e: this script owns its own failure semantics and must ALWAYS reach its
                   # cleanup, its destination stamp and its HQ push. A backup that dies before it can
                   # report that it died is precisely what this layer exists to prevent.
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "vault-backup"

KEEP=14
stamp="$(date '+%Y%m%d-%H%M')"
remote_name="vault-${stamp}.tar.gpg"
reason=""
size_mb=0
b2ok="pending"    # pending = not attempted/not configured; ok / failed = a verified 2nd-copy result

work="$(mktemp -d "${TMPDIR:-/tmp}/alex-vault-${stamp}.XXXXXX")"
tar_file="$work/backup.tar"
gpg_file="$work/backup.tar.gpg"
vrf_file="$work/verify.tar"
list_file="$work/include.list"

# ALWAYS shred the plaintext tar, the decrypted verify copy, the local .gpg and the list - on SIGINT
# and SIGTERM too, not only a clean exit (the PowerShell `finally` covered only a normal unwind).
cleanup() { rm -rf "$work"; }
trap '_alex_rc=$?; cleanup; alex_signal_exit "$_alex_rc"' EXIT INT TERM HUP  # signal chains the C31 dead-man switch (stress-test S-D3)

# --- 0. Nightly deterministic aggregates ---------------------------------------------------------
# All four are BEST-EFFORT and must NEVER block the backup: each output is regenerable, the backup is
# not. They run here because this is the last job of the night.
#   0.  outputs-ledger reconcile   - skeleton rows for deliverables that missed their Close-Out A6
#   0a. outputs burst tripwire     - flag any >50MB/24h outputs/ growth to HQ amber +
#                                    system/outputs-burst-state.json (the morning brief prints one
#                                    line). Detect-only; exit 2 = burst (informational here).
#                                    (S1 Compiled Surfaces P2, 2026-08-16)
#   0b. application outcome loop   - re-tally the outcome table -> winners + the writer block
#   0c. content outcome loop       - the Building Alex twin of 0b
#   0d. cost budget tripwires      - level-triggered per-project monthly budget check
for step in \
    "ledger|scripts/outputs-ledger.js reconcile" \
    "outputs-burst|scripts/outputs-burst-check.js" \
    "outcome-loop|scripts/alex-outcome-loop.js" \
    "content-loop|scripts/alex-content-loop.js" \
    "cost-tripwires|scripts/alex-cost-attribution.js --budget-check"
do
    name="${step%%|*}"
    cmd="${step#*|}"
    # No set -e re-enable here: this script is deliberately NOT errexit (header; the 2026-08-26
    # incident - a re-enabled -e killed the run before it could report its own failure).
    # shellcheck disable=SC2086  # deliberate word-split: the args are ours, not user input
    out="$(node $cmd 2>&1 | tail -n 1)"
    echo "$name: $out" >> "$LOG"
done

# --- BUG-11 fix (2026-07-15): month-end producer wait --------------------------------------------
# On a month-end night the expense (20:00) and runway (21:15) jobs can still be writing their Excel
# workbooks when this 21:45 tar runs, so the backup could capture a half-written .xlsx. Wait, bounded,
# then proceed anyway after 12 minutes so the backup window is never blown.
if [ -z "${ALEX_DRY_RUN:-}" ] && command -v systemctl >/dev/null 2>&1; then
    waited=0
    while [ "$waited" -lt 720 ]; do
        busy=""
        for j in PersonalOS-expense-wrangler PersonalOS-runway; do
            if systemctl --user is-active --quiet "${j}.service" 2>/dev/null; then
                busy="$busy $j"
            fi
        done
        [ -n "$busy" ] || break
        echo "waiting for month-end producer(s) before taring:$busy (${waited}s)" >> "$LOG"
        sleep 60
        waited=$((waited + 60))
    done
    if [ "$waited" -ge 720 ]; then
        echo "proceeded after the 12-min wait cap (a month-end producer was still running); backup may catch a mid-write file this once" >> "$LOG"
    fi
fi

# --- Resolve the tools ---------------------------------------------------------------------------
GPG="$(command -v gpg || command -v gpg2 || true)"
TAR="$(command -v tar || true)"
RCLONE="$(command -v rclone || true)"   # optional: the B2 leg is skipped if absent

pass_file=""
if node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --check vault-backup-gpg-passphrase >/dev/null 2>&1; then
    pass_file="$(node "$ALEX_ROOT/scripts/lib/secret-env.mjs" --path vault-backup-gpg-passphrase)"
fi

# --- The backup ----------------------------------------------------------------------------------
plan=""
if [ -z "$TAR" ]; then
    reason="tar not found on PATH"
elif [ -z "$GPG" ]; then
    reason="gpg not found on PATH (install gnupg)"
elif [ -z "$pass_file" ]; then
    reason="passphrase path not configured in system/credentials-ledger.json (id=vault-backup-gpg-passphrase, field local_path)"
elif [ ! -f "$pass_file" ]; then
    reason="passphrase file missing at the ledger-configured path"
else
    # 1. Build the include set (derived from .gitignore, so it cannot drift from what is local-only).
    # stderr goes to the LOG, never into $plan: $plan must be pure JSON for the parses below, and a
    # library WARNING on stderr (the pre-migration secret-path note fires on Windows) poisoned it on
    # 2026-08-26. The old `set -e` re-enable here was the second half of that bug: this script is
    # deliberately NOT errexit (header), and re-enabling it made the poisoned parse kill the run
    # before it could log FAILED or push RED - the exact class this script exists to prevent.
    plan="$(node "$ALEX_ROOT/scripts/lib/backup-include.mjs" --list-file "$list_file" 2>>"$LOG")"
    plan_code=$?
    if [ "$plan_code" -ne 0 ]; then
        reason="include-set build failed (exit $plan_code) - see the log for its stderr"
        plan=""
    fi
fi

if [ -z "$reason" ]; then
    n="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).count)))')"
    identity_ok="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).identity.ok?"1":""))')"
    identity_root="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).identity.root))')"
    identity_leaf="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).identity.leaf))')"
    secrets_ok="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).secrets.ok?"1":""))')"
    secrets_root="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).secrets.root))')"
    secrets_leaf="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).secrets.leaf))')"
    # Git Bash on Windows: GNU tar reads "C:\..." as a remote host spec (the W12 hazard, back via
    # the two -C anchor legs on this platform; it broke the identity-docs append 2026-08-26 and the
    # P0.3 verify correctly refused the blob). cygpath exists exactly where the hazard does, so the
    # drive paths become /c/... here and the tar invocations stay identical on every platform.
    if command -v cygpath >/dev/null 2>&1; then
        [ -z "$identity_root" ] || identity_root="$(cygpath -u "$identity_root")"
        [ -z "$secrets_root" ] || secrets_root="$(cygpath -u "$secrets_root")"
    fi
    echo "include: $n paths" >> "$LOG"
    [ -n "$identity_ok" ] || echo "WARNING identity docs: '$identity_root/$identity_leaf' not found - the master reference + plain-English guide are NOT in this backup" >> "$LOG"
    [ -n "$secrets_ok" ] || echo "WARNING secrets: '$secrets_root/$secrets_leaf' not found - the relocated credentials are NOT in this backup (ruling A moved them out of the repo, so nothing else covers them)" >> "$LOG"
    # Declared-but-uncovered credentials are stated OUT LOUD every night. A credential with no backup
    # coverage is only discovered during a restore otherwise, which is the worst possible moment.
    sec_unres="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).secrets.unresolved.join(", ")))')"
    sec_else="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).secrets.elsewhere.join(", ")))')"
    [ -z "$sec_unres" ] || echo "NOTE secrets: declared credential(s) resolve NOWHERE on this machine, so they have no backup coverage: $sec_unres" >> "$LOG"
    [ -z "$sec_else" ] || echo "NOTE secrets: declared credential(s) still at a PRE-MIGRATION in-repo path (covered by leg 1, but move them per ruling A): $sec_else" >> "$LOG"
    # P0.3 (run-47 merged plan, 2026-08-23): a re-include named in the keep-list but absent on disk
    # is AMBER, never silent.
    keep_missing="$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write((JSON.parse(s).keepMissing||[]).join(", ")))')"
    [ -z "$keep_missing" ] || echo "AMBER keepOutputs: named but absent on disk: $keep_missing" >> "$LOG"
fi

if [ -n "${ALEX_DRY_RUN:-}" ] && [ -z "$reason" ]; then
    echo "DRYRUN: would tar $n paths + identity docs (present: ${identity_ok:-no}) + secrets (present: ${secrets_ok:-no}) -> gpg -> scp $remote_name to n8n:/opt/alex-backups (keep $KEEP)" >> "$LOG"
    echo "DRYRUN ok: $n paths staged" >> "$LOG"
elif [ -z "$reason" ]; then
    # 2. tar (relative to the repo root), then append the two out-of-repo legs, then encrypt.
    if ! "$TAR" -cf "$tar_file" \
            --exclude='*/.obsidian' --exclude='*/node_modules' --exclude='*/.browser-profile' --exclude='*/.git' \
            -T "$list_file" >> "$LOG" 2>&1; then
        echo "tar reported errors (continuing to the existence check)" >> "$LOG"
    fi
    if [ ! -f "$tar_file" ]; then
        reason="tar produced no archive"
    fi

    # 2b. The out-of-repo identity docs, with their own -C anchor. Only the REAL directory is taken,
    #     so each document is stored exactly once and no symlinked view is traversed.
    if [ -z "$reason" ] && [ -n "$identity_ok" ]; then
        "$TAR" -rf "$tar_file" -C "$identity_root" "$identity_leaf" >> "$LOG" 2>&1 || \
            echo "WARNING: appending the identity docs reported an error" >> "$LOG"
    fi

    # 2c. THE RELOCATED SECRETS (ruling A). They left the repo, so `git ls-files --others --ignored`
    #     can no longer see them and the derivation above cannot reach them. Own -C anchor, exactly
    #     like the identity docs. Verified BY NAME after decryption below - that assertion is what
    #     makes a silently-uncovered secret impossible rather than merely unlikely.
    if [ -z "$reason" ] && [ -n "$secrets_ok" ]; then
        "$TAR" -rf "$tar_file" -C "$secrets_root" "$secrets_leaf" >> "$LOG" 2>&1 || \
            echo "WARNING: appending the secrets dir reported an error" >> "$LOG"
    fi

    if [ -z "$reason" ]; then
        "$GPG" --batch --yes --quiet --symmetric --cipher-algo AES256 --compress-algo 2 \
               --passphrase-file "$pass_file" -o "$gpg_file" "$tar_file" >> "$LOG" 2>&1
        if [ ! -f "$gpg_file" ]; then
            reason="gpg produced no output"
        else
            bytes="$(wc -c < "$gpg_file" | tr -d ' ')"
            size_mb="$(node -e "process.stdout.write((($bytes)/1048576).toFixed(1))")"
            # REFUSAL GUARD: a tiny blob means the tar was thin or gpg half-wrote. Shipping it would
            # overwrite a good backup with a useless one.
            if [ "$bytes" -lt 102400 ]; then
                reason="encrypted blob suspiciously small ($size_mb MB)"
            fi
        fi
    fi

    # 3. Round-trip verify BEFORE shipping: decrypt + list entries. Never ship a blob we cannot open.
    if [ -z "$reason" ]; then
        "$GPG" --batch --yes --quiet --passphrase-file "$pass_file" -d -o "$vrf_file" "$gpg_file" >> "$LOG" 2>&1
        # The listing goes to a FILE and every check reads the file (2026-08-26). It was a shell
        # variable pushed through a fresh printf|grep pipe per assertion, and on Git Bash under
        # parallel-session load those pipes flake: grep saw a short stream and reported a file
        # missing from a blob that verifiably contained it - three runs, three different phantom
        # miss-sets, unreproducible in a quiet shell. A file read has no pipe to flake; it is also
        # what the one-off debug harness did, which is why the harness kept passing while the
        # script kept failing.
        names_file="$work/verify-names.txt"
        "$TAR" -tf "$vrf_file" > "$names_file" 2>>"$LOG"
        entries="$(grep -c . "$names_file" 2>/dev/null || true)"
        if [ "$entries" -lt 50 ]; then
            reason="verify failed: only $entries entries decrypted"
        else
            # POSITIVE assertion by name (2026-07-25 for the identity docs; extended to the secrets by
            # ruling A). "It was appended" is not proof it is IN the shipped blob. Hard-fails: a backup
            # that silently stopped covering these is exactly the state these assertions exist to end.
            missing=""
            for want in $(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).assertNames.join(" ")))'); do
                grep -q -- "$want" "$names_file" || missing="$missing $want"
            done
            if [ -n "$missing" ]; then
                reason="verify failed: required file(s) missing from the archive:$missing"
                # Diagnostic (2026-08-26): on a by-name miss, log what the archive END actually
                # holds - the appended legs live there, and a truncated or oddly-quoted tail is
                # invisible in the one-line reason. Costs nothing on the happy path.
                {
                    echo "verify diagnostic: last 8 archive entries were:"
                    tail -n 8 "$names_file" | sed 's/^/  | /'
                } >> "$LOG"
            else
                echo "verified: required files present in the blob" >> "$LOG"
            fi
        fi
        [ -n "$reason" ] || echo "verified: decrypts clean, $entries entries, $size_mb MB" >> "$LOG"
    fi

    # 4. Ship to Hetzner + confirm the remote size + prune to the last $KEEP.
    if [ -z "$reason" ]; then
        if ! scp -o BatchMode=yes "$gpg_file" "n8n:/opt/alex-backups/$remote_name" >> "$LOG" 2>&1; then
            reason="scp failed - network or SSH key?"
        else
            remote_size="$(ssh -o BatchMode=yes n8n "stat -c%s /opt/alex-backups/$remote_name" 2>/dev/null | tr -d ' \r')"  # portability-ok: stat -c runs on the REMOTE box, which is Linux
            if [ -z "$remote_size" ] || [ "$remote_size" -lt 100000 ] 2>/dev/null; then
                reason="remote file missing/truncated (${remote_size:-none} bytes)"
            else
                ssh -o BatchMode=yes n8n "cd /opt/alex-backups && ls -1t vault-*.tar.gpg 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f" >> "$LOG" 2>&1
                kept="$(ssh -o BatchMode=yes n8n "ls -1 /opt/alex-backups/vault-*.tar.gpg 2>/dev/null | wc -l" | tr -d ' \r')"
                echo "shipped: $remote_name ($remote_size bytes remote), $kept kept on box" >> "$LOG"
            fi
        fi
    fi

    # 4b. SECOND independent destination (Backblaze B2 - a different failure domain than the n8n box,
    #     which is ALSO production; the F1 SPOF fix). BEST-EFFORT relative to the primary: a B2 problem
    #     can NEVER set $reason or fail the real backup. Its OWN verify is HARD: read the remote byte
    #     size back and compare.
    if [ -z "$reason" ]; then
        if [ -n "$RCLONE" ]; then
            if "$RCLONE" copyto "$gpg_file" "alex-b2:alex-vault-backups/$remote_name" >> "$LOG" 2>&1; then
                b2bytes="$("$RCLONE" size "alex-b2:alex-vault-backups/$remote_name" --json 2>/dev/null \
                    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).bytes))}catch{process.stdout.write("-1")}})')"
                local_bytes="$(wc -c < "$gpg_file" | tr -d ' ')"
                if [ "$b2bytes" = "$local_bytes" ]; then
                    b2ok="ok"
                    "$RCLONE" lsf "alex-b2:alex-vault-backups/" --include "vault-*.tar.gpg" 2>/dev/null \
                        | sort -r | tail -n +$((KEEP + 1)) \
                        | while read -r old; do [ -n "$old" ] && "$RCLONE" deletefile "alex-b2:alex-vault-backups/$old" >/dev/null 2>&1; done
                    echo "B2: shipped + verified $remote_name ($b2bytes bytes), pruned to $KEEP" >> "$LOG"
                else
                    b2ok="failed"
                    echo "B2 VERIFY FAILED: local $local_bytes vs remote $b2bytes" >> "$LOG"
                fi
            else
                b2ok="failed"
                echo "B2 ship failed (non-fatal)" >> "$LOG"
            fi
        else
            echo "B2 skipped: rclone not found (provision alex-b2 to enable the 2nd destination; human-actions f1-b2-backup)" >> "$LOG"
        fi
    fi
fi

# --- F1: stamp the verified-destinations state file (read by recovery check C20) ------------------
# ONLY a destination that VERIFIED this run is stamped: Hetzner iff the run succeeded, B2 iff its own
# read-back passed. Local runtime state (gitignored), best-effort, never fails the backup.
if [ -z "${ALEX_DRY_RUN:-}" ]; then
    node -e '
const fs = require("fs"), path = require("path");
const f = path.join(process.argv[1], "work", "18-recovery-layer", "state", "backup-destinations.json");
let cur = {};
try { cur = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
const nowIso = new Date().toISOString();
if (process.argv[2] === "ok") cur["hetzner-n8n"] = nowIso;
if (process.argv[3] === "ok") cur["backblaze-b2"] = nowIso;
fs.mkdirSync(path.dirname(f), { recursive: true });
fs.writeFileSync(f, JSON.stringify(cur, null, 2) + "\n");
process.stdout.write(Object.keys(cur).sort().join(", "));
' "$ALEX_ROOT" "$([ -z "$reason" ] && echo ok || echo no)" "$b2ok" 2>/dev/null \
        | sed 's/^/backup-destinations state: /' >> "$LOG" || true
fi

# --- Alex HQ push. Distinct metric_key from git-backup's run_status. ------------------------------
if [ -z "$reason" ]; then
    # P0.3 (run-47 merged plan, 2026-08-23): the verdict ladder is now explicit and a
    # previously-verified component going ABSENT is never green. Identity docs missing => RED
    # (the run still ships the vault - refusing to back up everything because two documents moved
    # would be the worse failure - then reports RED). B2 skipped (not provisioned) or a keepOutputs
    # path named-but-absent => AMBER: both are real coverage gaps, and the old "green with a
    # pending note" is exactly how run-46 finding N1 stayed invisible for two nights.
    case "$b2ok" in
        ok)      b2note=' +B2 ok' ;;
        failed)  b2note=' +B2 FAILED' ;;
        *)       b2note=' +B2 pending' ;;
    esac
    if [ -z "${identity_ok:-}" ]; then
        hq_push 'recovery' 'red' "vault shipped (${size_mb} MB) but IDENTITY DOCS MISSING from the blob: ${identity_root:-?}/${identity_leaf:-?}" 'vault_backup' 0
    elif [ "$b2ok" != "ok" ] || [ -n "${keep_missing:-}" ]; then
        amber_head="vault encrypted -> Hetzner (${size_mb} MB)${b2note}"
        [ -z "${keep_missing:-}" ] || amber_head="$amber_head; keepOutputs absent: $keep_missing"
        hq_push 'recovery' 'amber' "$amber_head" 'vault_backup' 1
    else
        hq_push 'recovery' 'green' "vault encrypted -> Hetzner (${size_mb} MB)${b2note}" 'vault_backup' 1
    fi
else
    hq_push 'recovery' 'red' "vault backup FAILED: $reason" 'vault_backup' 0
fi

# P0.3 verdict ladder (2026-08-23): a run that shipped but LOST a previously-verified component
# exits nonzero. "It ran" was never the question; "is everything that used to be covered still
# covered" is.
if [ -z "$reason" ] && [ -z "${identity_ok:-}" ] && [ -z "${ALEX_DRY_RUN:-}" ]; then
    echo "RED ($size_mb MB shipped, but the identity docs are NOT in the blob: ${identity_root:-?}/${identity_leaf:-?})" >> "$LOG"
    exit 1
fi
if [ -z "$reason" ]; then
    amber=""
    [ "$b2ok" = "ok" ] || amber="B2 leg not verified"
    if [ -n "${keep_missing:-}" ]; then amber="${amber:+$amber; }keepOutputs absent: $keep_missing"; fi
    if [ -n "$amber" ]; then
        echo "OK-AMBER ($size_mb MB): $amber" >> "$LOG"
    else
        echo "OK ($size_mb MB)" >> "$LOG"
    fi
    exit 0
fi
echo "FAILED: $reason" >> "$LOG"
exit 1
