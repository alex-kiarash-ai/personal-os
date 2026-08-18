# BASH / LINUX MIGRATION PLAN

**Date:** 2026-08-05
**Scope:** move the Personal Ops System off Windows (PowerShell 5.1 + Windows Task Scheduler) onto Linux (bash + systemd), with no loss of behavior in the Close-Out Gate, the recovery checker, the backup layer, or the scheduled job train.
**Current root (Windows):** `C:\Users\Thinkpad\Desktop\personal-os`
**Status:** Phases 0-8 committed (see git log, `migrate/linux-bash`). **Phase 9 (teardown) executed 2026-08-18**, with one deviation from the entry gate below and one item never in scope: the plan's own Phase 9 gate ("a full week of green run_status on the real Linux host") was not literally met - as of 2026-08-17 systemd was never confirmed installed on the Hetzner box (SSH host-key unverified), so every green run to date is macOS smoke-testing, not a proven Linux job train. Proceeded anyway on Shaheen's explicit call 2026-08-18, since no working Windows fallback exists either. systemd deployment verification (Phase 4's own "deploy-only" step) remains open work. Full record: `ALEX-OS-master.md` §11, 2026-08-18 entry.

**The six rulings, in one place (detail and trade-offs in §5):**

| # | Decision | Ruling |
|---|---|---|
| C | Deployment topology | **Dev on macOS, run on Linux.** systemd is the scheduler; Phase 4 is deploy-only and untestable locally. |
| F | Shell target | **bash 3.2-compatible**, so one wrapper file runs on both platforms with no dev prerequisite. |
| A | Secrets | **Move outside the repo** to `~/.config/alex/secrets/` mode 600, during the Phase 3/5 ports, resolved via `credentials-ledger.json`. |
| B | Identity docs | **On the Linux host** at `~/Documents/alex-project/story-and-guides/`. Renamed to drop the space and ampersand. |
| D | Voice layer | **Parked DORMANT**, revisit 2026-11-05. Not ported, not retired. Phase 7 shrinks to ~1 hour. |
| E | `check.ps1` destination | **Stays at `work/18-recovery-layer/check.mjs`.** |

---

## 0. THE HEADLINE DECISION (read this before anything else)

**Do not translate the 34 PowerShell files into 34 bash files.** That is the obvious plan and it is the wrong one.

PowerShell 5.1 is an object-and-JSON-native language. Roughly 2,000 of the 3,293 PowerShell lines in this repo are doing things bash is bad at: parsing and re-serializing JSON (`ConvertFrom-Json` / `ConvertTo-Json`, 37 occurrences), SHA-256 hashing files into a baseline ledger, structured HTTP POSTs with headers (`Invoke-RestMethod`, 20 occurrences), regex extraction with named capture groups, and typed date arithmetic. Rewriting that in bash means a hard new dependency on `jq`, a swamp of subshells and quoting, and a checker whose 22 drift checks become unreadable.

Meanwhile this repo **already runs Node as a first-class citizen**: `scripts/generate-alex.js`, `scripts/validate-alex.js` (V1 to V13), the whole `system/recall/` spine, every harvester, `scripts/outputs-ledger.js`, `scripts/human-actions.js`. And it already runs Python for `hq_self_heal.py`, `narrative-drift-check.py`, `vault_search.py`, all of which are cross-platform today.

So the target split is:

| Layer | Language | Why |
|---|---|---|
| **Process wrappers** (set up a log, spawn `claude -p`, hand the output to the gate, exit) | **bash** | This is genuinely shell work: ~25 lines each, 18 of them, near-identical. |
| **Logic** (Close-Out Gate, quota gate, soul canary, the 22 recovery checks, n8n active check, the backup include-set) | **Node ESM** | Already the repo's logic language. Kills the `jq` dependency. Collapses real duplication that exists today. |
| **Analysis / indexing** (vault FTS5 index, self-heal, narrative drift) | **Python** (unchanged) | Already portable. Only the paths change. |
| **Scheduling** | **systemd user units** | Per-job units, journald, `Persistent=true`, transient one-shot retries. |

Two pieces of evidence that this split is right, not just tidier:

1. `scripts/stale-status-check.js:40` already reimplements `check.ps1`'s C8 hashing in Node, with a comment saying it hashes "the same way check.ps1's `Get-Sha` does". That duplication exists **because** the checker is trapped in PowerShell. Porting C8 to Node deletes one of the two copies instead of creating a third.
2. `scripts/lib/gen-scheduler.js:2` describes itself as "the ONLY PowerShell/Windows touchpoint in the generator". The generator was deliberately built cross-platform in 2026-07-08 (decision D11: "Node ... it is cross-platform. PowerShell is invoked ONLY as a subprocess for Windows Task Scheduler registration"). This migration is the completion of a decision the repo already made, not a new direction.

**Net result:** roughly 18 small bash files (~450 lines total) plus ~1,800 lines of Node, replacing 3,293 lines of PowerShell. Fewer languages in the hot path, not more.

---

## 1. INVENTORY: WHAT ACTUALLY HAS TO MOVE

34 `.ps1` files, 3,293 lines. 3 `.cmd` files. Grouped by what they are:

### Group A: thin scheduled wrappers (18 files, ~600 lines) → bash
`scripts/run-*.ps1` (17) plus `scripts/auth-check.ps1`. All the same shape: set TLS, `Set-Location` to the hardcoded root, dot-source `close-out.ps1`, `mkdir outputs/logs`, run the quota gate, spawn `claude -p --model <pin> "Run /<command>. $AlexVerdictInstruction"`, capture output, call `Invoke-CloseOutCheck`.

Declared in `system/manifest.json` → `meta.model_routing.local_wrappers`: 16 in `pins`, 2 in `deterministic_no_pin`. Enforced by validator **V13**, which is COMPLETE by construction (`scripts/validate-alex.js:1073` matches `/^run-.*\.ps1$/`).

Sizes: 21 lines (`run-alex-radar`) up to 80 (`run-sprint-tracker`). The long ones only differ by having a deterministic core to run before or instead of the Claude call.

### Group B: shared library (2 files, 457 lines) → Node
- `scripts/lib/close-out.ps1` (340 lines). The single most load-bearing file in the migration. Contains: `$AlexVerdictInstruction` (the completion sentinel string), `Set-AlexQuotaCapped`, `Clear-AlexQuotaCapped`, `Test-AlexQuotaGate`, `Invoke-CloseOutCheck` (A1 failure detection, A4 RED push to Alex HQ, the self-scheduled retry ladder). Every one of the 18 wrappers depends on it.
- `scripts/lib/soul-canary.ps1` (117 lines). Nonce-based proof that `soul.md` reached a headless run's context.

### Group C: zero-token checkers (5 files, 1,228 lines) → Node
- `work/18-recovery-layer/check.ps1` (627 lines). C1 to C22 (C16 retired), the weekly Monday drift sweep. The biggest single port.
- `work/18-recovery-layer/security-sweep.ps1` (262). Monthly: gitleaks over history, credential-age ledger, deployed-version probe.
- `work/18-recovery-layer/escrow-test.ps1` (138). The passphrase escrow drill, and the ONLY writer of the C14 attestation file.
- `scripts/n8n-active-check.ps1` (97). Daily n8n active-flag watcher.
- `scripts/run-vault-index.ps1` (104). Nightly: vault FTS5 rebuild + recall harvest + lesson harvest + two HQ pushes. Really a wrapper with checker-shaped logic inside it.

### Group D: backup jobs (2 files, 365 lines) → bash + Node hybrid
- `scripts/vault-backup.ps1` (283). The riskiest file in the repo. tar of the gitignored surface + out-of-repo identity docs, gpg AES256, round-trip verify, scp to Hetzner, rclone to B2, prune to 14, stamp `backup-destinations.json`, HQ push. Also runs four nightly Node aggregates first (ledger reconcile, outcome loop, content loop, cost tripwires).
- `scripts/git-backup.ps1` (82). `git add -A`, commit, push current branch, GREEN/RED HQ push.

### Group E: tests (3 files, 203 lines) → bash + Node
`scripts/tests/test-soul-canary.ps1`, `test-soul-canary-live.ps1`, `test-completion-sentinel.ps1`.

### Group F: side lanes (6 files) → bash, or retire
- `work/quota-reset-autorun/scripts/{arm,disarm,poll-and-run}.ps1` (171 lines). Self-contained, curl-based already.
- `work/voice/talk.ps1` + `work/voice/v3/{dictate,voice-on,voice-off}.cmd`. **RULED PARKED (§5.D):** not ported, left in the tree, hooks neutralized.
- `work/31-portal-scanner/reset-reminder.ps1` (9 lines). Trivial.

---

## 2. THE WINDOWS DEPENDENCY LEDGER

Every Windows-specific thing in the repo, where it lives, and what replaces it. This is the checklist; nothing ships until every row is closed.

### 2.1 Hard-coded paths

| # | What | Where | Linux replacement |
|---|---|---|---|
| W1 | `Set-Location "C:\Users\Thinkpad\Desktop\personal-os"` | 20 files (`run-morning-brief.ps1:3`, `git-backup.ps1:10`, `vault-backup.ps1:18`, `run-vault-index.ps1:13`, `auth-check.ps1:21`, and 15 more) | `ALEX_ROOT` resolved from the script's own location with the bash 3.2-safe idiom `ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"` (NOT `readlink -f`, which BSD lacks, ruling F). Never a literal. `n8n-active-check.ps1:22` and `escrow-test.ps1` already do this correctly with `$PSScriptRoot`, so the pattern exists in-repo. |
| W2 | `$env:APPDATA\npm\claude.ps1` (the Claude CLI shim) | 16 wrappers | A `resolve_claude()` helper: `command -v claude`, then `~/.local/bin/claude`, then the npm global prefix (`npm prefix -g`/bin/claude). Fail loud with a named error if unresolved. |
| W3 | Backslash path literals inside PowerShell, Node and Python strings (`"scripts\lib\close-out.ps1"`, `"work\16-alex-hq\config\alex-hq-token.txt"`, `'system\quota-state.json'`) | throughout | Forward slashes everywhere. In Node use `path.join`; in Python `pathlib`. Audit `scripts/lib/alex_paths.py` and `scripts/lib/alex-hq-path.js` which are the existing path-resolution helpers. |
| W4 | `%USERPROFILE%\Desktop\Alex Project\...` for the out-of-repo identity docs | `system/manifest.json` → `meta.paths.master_reference_md`, `vault-backup.ps1:156` | **RULED (§5.B):** `~/Documents/alex-project/story-and-guides/` **on the Linux host**. The manifest already expands `%USERPROFILE%` at read time, so this is a schema swap not a redesign. The rename drops the space and ampersand, removing a permanent quoting hazard. |
| W5 | `C:\Users\Thinkpad\Desktop\...` in project code | `work/17-health-tracker/scripts/backfill_health.py:21`, `work/03-application-engine/powerbi/export-tmdl.js:5`, `powerbi/build-dashboard.js:3`, `scripts/reexport-live-workflows.js:7` | Env vars with sane defaults. Note these are one-shot/dormant tools, so they are Phase 8 cleanup, not blockers. |
| W6 | `$env:LOCALAPPDATA\Programs\Python\Python312\python.exe` fallback | `run-vault-index.ps1:23` | `python3` on PATH, plus an optional in-repo `.venv/bin/python3`. |

### 2.2 Windows Task Scheduler

| # | What | Where | Linux replacement |
|---|---|---|---|
| W7 | `Get-ScheduledTask` to enumerate live jobs | `check.ps1:202` (C7), `vault-backup.ps1` (month-end producer wait) | `systemctl --user list-timers --all --output=json` |
| W8 | `Register-ScheduledTask` / `New-ScheduledTaskAction` / `New-ScheduledTaskTrigger` / `New-ScheduledTaskSettingsSet` for the self-scheduled retry ladder | `close-out.ps1` (retry block) | `systemd-run --user --on-active=90min --unit=alex-retry-<job>-<n>` with `ALEX_RETRY_ATTEMPT=<n>` in the environment. Transient units self-delete, which is cleaner than the Windows `DeleteExpiredTaskAfter` hack. |
| W9 | `schtasks /query /fo CSV` and `schtasks /create /f` | `scripts/lib/gen-scheduler.js:25,93`, `scripts/hq_infra_harvest.py:82`, `scripts/validate-alex.js` (V2 live half) | `systemctl --user list-timers` for query; write `.timer` + `.service` unit files + `systemctl --user enable --now` for apply. |
| W10 | Task settings vocabulary: `RestartCount`, `RestartInterval`, `ExecutionTimeLimit`, `StartWhenAvailable`, `WakeToRun`, `AllowStartIfOnBatteries`, `MultipleInstances IgnoreNew` | `scheduler/schedule.md:33` and every job's hardening note | systemd equivalents: `Restart=on-failure` + `RestartSec=`, `RuntimeMaxSec=`, `Persistent=true` (this is the `StartWhenAvailable` equivalent and it is better: it fires on next boot if the machine was off), `WakeSystem=true`, and `Type=oneshot` (which already gives IgnoreNew semantics). |
| W11 | 23 documented `PersonalOS-*` job names | `scheduler/schedule.md` | Keep the names verbatim as unit names: `PersonalOS-morning-brief.timer`. Do NOT rename during the migration. C7 compares documented names to live names, so preserving them keeps that check meaningful throughout. |

**Important behavioral note:** `close-out.ps1`'s retry ladder exists because "Task Scheduler's RestartCount does NOT fire on a non-zero exit code (proven 2026-07-06: four exit-1 limit failures, RestartCount=4 on every task, zero restarts)". systemd's `Restart=on-failure` **does** fire on non-zero exit. So on Linux the retry ladder could collapse into unit config. **Recommendation: do not collapse it in this migration.** Port the ladder as-is to `systemd-run`, keep the same 5-attempt/90-minute semantics and the same `ALEX_RETRY_ATTEMPT` env var, and open a separate follow-up to simplify it once the port is proven. Changing failure-recovery behavior during a platform move makes any incident un-diagnosable.

### 2.3 External binaries resolved at Windows paths

| # | Binary | Windows resolution | Linux |
|---|---|---|---|
| W12 | `tar` | Pinned to `$env:SystemRoot\System32\tar.exe` (bsdtar) at `vault-backup.ps1`, with a long comment about GNU tar misreading `C:\...` as a remote host spec | Plain `tar` (GNU). **The entire pin and its bug class disappear.** Delete the comment. Keep `--exclude` semantics; GNU tar accepts them. |
| W13 | `gpg` | `C:\Program Files\Git\usr\bin\gpg.exe`, `C:\Program Files (x86)\GnuPG\bin\gpg.exe` | `gpg` on PATH (`gnupg` package). Same flags: `--batch --yes --quiet --symmetric --cipher-algo AES256 --compress-algo 2 --passphrase-file`. |
| W14 | `rclone` | `C:\Program Files\rclone\rclone.exe`, `$env:LOCALAPPDATA\Microsoft\WinGet\Links\rclone.exe` | `rclone` on PATH. Same subcommands. |
| W15 | `gitleaks` | `$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gitleaks.Gitleaks_*\gitleaks.exe` | `gitleaks` on PATH. Also used by the pre-commit hook (`gitleaks git --staged`), which must keep its fail-open-on-absent behavior. |
| W16 | `curl.exe` | `arm.ps1` deliberately uses curl.exe over `Invoke-RestMethod` because .NET TLS failed on that box | `curl` natively. The workaround comment can be deleted, but keep curl as the transport (it is already the more portable choice). |
| W17 | `cmd /c "git push ..."` wrapper | `git-backup.ps1` (works around PS 5.1 turning native stderr into NativeCommandError records) | Direct `git push`. Workaround deleted. |

### 2.4 Platform semantics

| # | What | Where | Linux impact |
|---|---|---|---|
| W18 | Windows timezone IDs (`W. Europe Standard Time`) | `check.ps1` C18, `system/travel-state.json` schema (`home_win_tz`, `current_win_tz`), trip-ops writes them | IANA IDs (`Europe/Stockholm`). Read the live tz from `timedatectl show -p Timezone --value`. **This is a schema change**: rename the fields to `home_tz` / `current_tz`, migrate any existing state file, and update `work/29-trip-ops` which is the writer. |
| W19 | NTFS junctions for `.claude/skills/<name>` → `.agents/skills/<name>` | `check.ps1` C17, `.gitignore` comment, CLAUDE.md skills section, `skills-lock.json` workflow | Real POSIX symlinks (`ln -s ../../.agents/skills/<name> .claude/skills/<name>`). This gets strictly simpler. C17's remediation string changes. Note the CLAUDE.md warning that "Git Bash `ln -s` silently COPIES on Windows" becomes irrelevant. |
| W20 | Case-insensitive filesystem | everywhere | **Linux is case-sensitive.** Any path referenced with wrong casing has been silently working on Windows and will break. Needs a dedicated audit pass (§7, V-CASE). |
| W21 | CRLF line endings + PS 5.1 UTF-8 BOM | `close-out.ps1` has an explicit BOM workaround ("BOM-free write, node consumers choke on PS 5.1's utf8 BOM") | Both problems vanish. Delete the workaround. Add `.gitattributes` with `* text=auto eol=lf` and `*.sh text eol=lf` so a CRLF file can never wedge a shebang. |
| W22 | `Get-FileHash -Algorithm SHA256` returns **UPPERCASE** hex | `check.ps1:63` (`Get-Sha`), the C8 baseline JSON in `work/18-recovery-layer/state/`, mirrored by `scripts/stale-status-check.js:40` | `sha256sum` / Node `crypto` return lowercase. Either normalize case on read (safest) or re-run `check.ps1 -Init` after migration to rewrite the baseline. **Recommendation: normalize on comparison, then re-Init once at the end of Phase 5.** |
| W23 | `[Net.ServicePointManager]::SecurityProtocol = Tls12` | 12 files | Delete. No equivalent needed. |
| W24 | `$env:TEMP`, `[guid]::NewGuid()` | `vault-backup.ps1` | `mktemp -d` / `${TMPDIR:-/tmp}`. Use `trap ... EXIT` for the shred-on-exit guarantee that the PowerShell `finally` block currently provides. |
| W25 | `git clone -c core.longpaths=true` requirement | `docs/GETTING-STARTED.md:17`, CLAUDE.md Backup section | Delete. Linux PATH_MAX is 4096. |
| W26 | Executable bit not tracked | all scripts are `0644` today | Every new `.sh` needs `chmod +x` **and** `git update-index --chmod=+x` so the bit survives a clone. Add to the Phase 3 checklist. |
| W27 | File permissions on secrets | `icacls`-locked passphrase file (per the credentials ledger) | `chmod 600` + `chown`. Add a recovery check that asserts mode `600` on every file named in `system/credentials-ledger.json` (this is a genuine security upgrade the Windows side never had). |
| W28 | Windows SAPI TTS + `.venv\Scripts\python.exe` / `pythonw.exe` | `.claude/settings.json` Stop + Notification hooks, `work/voice/**` | **RULED (§5.D): PARKED DORMANT, not ported.** Both hooks are neutralized in Phase 7 so they cannot spam a Windows-venv-missing message every turn on Linux. `work/voice/**` stays in the tree untouched. SAPI has no Linux equivalent, which is exactly why a port was deferred rather than rushed. |

---

## 3. TARGET LAYOUT

### 3.1 What changes, and what deliberately does not

The user asked whether Linux good practice dictates a restructure. Partly yes. Here is the honest split.

**KEEP as-is** (moving these buys churn, not correctness):
- `work/{NN}-{name}/` project folders. This is the repo's core organizing idea, it is enforced by the manifest, C1, C3 and the routing table, and it has nothing to do with the OS.
- `vault/`, `outputs/`, `brand/`, `templates/`, `docs/`, `system/`.
- `scripts/` as the flat home of the scheduled wrappers. Flatness is a load-bearing contract: V13 scans one directory, `gen-scheduler.js` derives `scripts/run-{name}` from a job name, and `/cron-setup` assumes it. (This is exactly the question asked earlier in this session, and the answer holds on Linux.)

**CHANGE:**

```
scripts/
  run-*.sh              # 17 wrappers, bash 3.2, chmod +x, shebang #!/usr/bin/env bash
  auth-check.sh
  lib/
    close-out.mjs       # was close-out.ps1  (Node)
    soul-canary.mjs     # was soul-canary.ps1 (Node)
    common.sh           # NEW: alex_root_cd, resolve_claude, log_init, die, bash-version guard
    paths.mjs           # NEW: the single Node path/secret resolver
    alex_paths.py       # unchanged, paths fixed
    *.js                # unchanged generator libs
  n8n-active-check.mjs  # was .ps1
work/18-recovery-layer/
  check.mjs             # was check.ps1        (ruling E: stays here)
  security-sweep.mjs
  escrow-test.mjs
systemd/                # NEW: generated unit files (deploy-only, Linux host)
  PersonalOS-*.service
  PersonalOS-*.timer
  README.md
```

Two notes on that:

- **The checkers stay in `work/18-recovery-layer/` (ruling §5.E).** A `scripts/recovery/` home was considered and dropped. Four files parse `check.ps1` by path today (`narrative-drift-check.py:30` reads its `# --- C<n>` headers to count checks, `system/recall/harvesters/h-recovery.js:11` harvests facts from it, plus `facts-check.js` and `stale-status-check.js`), so the move would have cost four updates to buy nothing. The "project code lives in `work/`, scheduler plumbing lives in `scripts/`" rule holds unchanged on Linux.

- **`systemd/` in-repo, not `~/.config/systemd/user/`.** Units are generated from `scheduler/schedule.md` by `gen-scheduler.js`, so they belong in the repo as generated artifacts, then `systemctl --user link`ed into place. That keeps the "sources are hand-edited, views are generated" ground rule intact and makes the units reviewable in git. They are also the one part of the tree that is **meaningless on the Mac**, which is worth a comment in `systemd/README.md` so a dev machine does not look broken.

### 3.2 XDG Base Directory: adopt partially, not fully

Linux convention says config → `~/.config/`, state → `~/.local/state/`, cache → `~/.cache/`, data → `~/.local/share/`. Today everything is in-repo: secrets in `work/*/config/*.txt`, runtime state in `work/*/state/`, `system/*.json`, logs in `outputs/logs/`.

**Full XDG adoption is wrong here** because it breaks two things the system depends on: the vault-backup include set is *derived from `.gitignore`* (`vault-backup.ps1` step 1) so that it can never drift from what is local-only, and the session-root rule says Alex is the folder containing `CLAUDE.md` + `soul.md`.

**Partial adoption is right, and it is a genuine privacy upgrade.** The repo is PUBLIC and `.gitignore` is the sole barrier between personal data and the internet. Moving secrets physically outside the repo removes the possibility of a `git add -f` accident entirely:

| Move | From | To |
|---|---|---|
| **Secrets** (API keys, HQ token, qra token) | `work/*/config/*.txt` | `${XDG_CONFIG_HOME:-$HOME/.config}/alex/secrets/`, mode `600` |
| **Logs** | `outputs/logs/` | keep in-repo (the checkers read them), add logrotate |
| **Runtime state** | `work/*/state/`, `system/quota-state.json` | keep in-repo (backed up, and the checkers path to it) |
| **Caches** (`vault-search.db`, `facts.db`) | `system/recall/`, in-repo gitignored | keep in-repo (they ride the encrypted backup by design) |

Only the secrets move. Everything else stays. Then:
- `system/credentials-ledger.json` becomes the single resolver for every secret path (it already is for the gpg passphrase).
- The `.gitignore` secrets block is kept as a safety net rather than deleted, so a file recreated in the old location by an un-migrated script is still caught.
- **New recovery check (C23):** every path in the ledger exists, is mode `600`, and is **outside the repo**. This is protection the Windows side never actually had.
- **The cost, which Phase 6 must pay:** relocated secrets fall out of the `.gitignore`-derived backup include set, so `vault-backup.sh` gains a third `-C`-anchored tar leg plus a positive by-name assertion for all 4 files inside the decrypted archive.

**RULED §5.A: adopt, during the Phase 3/5 ports.** The doing-it-inline choice is what keeps this near-free; a separate pass would have cost about a day for the same end state.

### 3.3 Dependency manifests (currently absent, and that is a gap)

There is **no `package.json` and no `requirements.txt` anywhere in this repo.** Node and Python dependencies are entirely implicit. That works on one hand-tuned Windows box and fails the moment you provision a Linux machine.

Phase 1 adds:
- `package.json` with `"type": "module"`, the engines field pinning Node ≥ 22 (`node:sqlite` is used by the recall spine and needs 22+), and scripts aliases (`npm run generate`, `npm run validate`, `npm run check`).
- `requirements.txt` for the Python side.
- `docs/INSTALL-LINUX.md` listing system packages: `git gnupg tar openssh-client curl jq rclone gitleaks python3 python3-venv nodejs systemd`.

---

## 4. PHASE PLAN

Each phase has an **entry gate** (do not start until true), **steps**, **verification** (how you know it worked), and **rollback**.

**Where each phase runs**, given the dev-Mac / run-Linux split (ruling §5.C):

| Phase | Dev on Mac | Verify on Linux host |
|---|---|---|
| 1, 2, 3, 5 | Yes, fully | Smoke run at the phase boundary |
| 6 (backup) | Partially (tar/gpg/include-set logic) | **Mandatory**: scp, rclone and the restore drill are host-only |
| 4 (scheduler) | **No. systemd does not exist on macOS.** | **Only** place it can be built or tested |
| 7, 8, 9 | Yes | Final green-week soak |

### PHASE 0: Provisioning and first restore
**Entry gate:** none. (The six decisions are already ruled, §5.)

1. Provision the Linux host. Record distro + kernel + `systemd --version` + Node + Python versions in `vault/projects/recovery/status.md`.
2. Install system packages (§3.3 list) on the Linux host, and the dev subset on the Mac (Node, Python, gpg, git). Verify each with `command -v`.
3. **Set up the two-machine working loop before writing any code.** Decide how the Mac reaches the host (ssh + remote checkout, or a mounted path) and confirm a round trip: edit on Mac, run on host, read the log back. Every later phase depends on this being frictionless.
4. Restore the private half on the **Linux host**: a repo clone gives a vault-less skeleton, so `vault/`, `soul.md` and `work/*/config` must come from the latest encrypted backup. **Do this first**, because it doubles as the first real restore drill on the new platform, and a failure here is the most valuable thing to learn early.
5. Create `~/Documents/alex-project/story-and-guides/` on the host and place both identity docs there (ruling §5.B). Create `~/.config/alex/secrets/` mode `700` (ruling §5.A).
6. Create branch `migrate/linux-bash`. Every phase commits with its phase ID in the message.

**Verification:** `gpg -d` the newest `vault-*.tar.gpg` and confirm `soul.md`'s sha256 matches the pre-migration value. Confirm both identity docs are present in the archive. Confirm the Mac-to-host edit/run/read loop works end to end.
**Rollback:** none needed, nothing changed.

---

### PHASE 1: Portable foundations
**Entry gate:** Phase 0 complete. Safe to do on the Mac (or even the Windows box) before anything is cut over.

1. Add `.gitattributes`: `* text=auto eol=lf`, `*.sh text eol=lf`, `*.ps1 text eol=crlf` (until they are deleted).
2. Add `package.json` + `requirements.txt` + `docs/INSTALL-LINUX.md`. Document the **dev-Mac / run-Linux** split explicitly in the install doc, including that `systemd/` is inert on macOS.
3. Write `scripts/lib/common.sh`, **bash 3.2-compatible** (ruling §5.F): `alex_root_cd()` using the portable `ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"` idiom and **not** `readlink -f`, plus `resolve_claude()`, `log_init()`, `die()`, and a version guard that fails loud on bash < 3.2. No associative arrays, no `${var^^}`, no `mapfile`, no globstar anywhere in this file or the wrappers.
4. Write `scripts/lib/paths.mjs`: the Node twin. One exported `ROOT`, plus resolvers for the HQ token, quota state, manifest, and **`secret(id)` reading through `system/credentials-ledger.json`** (this is the resolver ruling §5.A depends on, so it must exist before Phase 3). **Every subsequent Node port imports from here and never builds a path by string concatenation.**
5. Fix `scripts/lib/alex_paths.py` and `scripts/lib/alex-hq-path.js` to be separator-agnostic.
6. **Case-sensitivity audit.** Walk every path literal in `*.js`, `*.mjs`, `*.py`, `*.json`, `*.md` and assert it resolves on a case-sensitive filesystem. Fix every hit. Cheap now, a nightmare to debug later. **Note macOS is case-INSENSITIVE by default too**, so this audit must be run on the Linux host, not the Mac, or it proves nothing.
7. **Add a BSD-vs-GNU lint** to the same pass: flag any `sed -i`, `date -d`, `readlink -f`, `stat -c` or GNU-only `mktemp` usage in a `.sh` file. These are the divergences that make a script pass on the Mac and fail on Linux.

**Verification:** `node scripts/validate-alex.js` and `node scripts/generate-alex.js --dry-run` pass on both machines. The case audit, **run on the Linux host**, reports zero unresolved literals. The BSD/GNU lint is clean.
**Rollback:** revert the branch. Nothing in the running system changed.

---

### PHASE 2: The shared library → Node
**Entry gate:** Phase 1 verified.

This is the keystone. 18 wrappers depend on it, so it goes first and it gets the most test coverage.

1. Port `close-out.ps1` → `scripts/lib/close-out.mjs`, preserving **exactly**:
   - `ALEX_VERDICT_INSTRUCTION` (the string is a behavioral contract; every wrapper appends it and the sentinel check greps for `Verdict: (COMPLETE|INCOMPLETE)` in the last 400 chars).
   - A1 detection order and its subtleties: the `<500 non-whitespace chars` short-gate (which exists to stop a successful run that *mentions* a limit in prose from false-flagging itself, a real 2026-07-06 incident), the 400-char tail scan for mid-stream stops (BUG-05), the ENFORCING sentinel check, and `-DegradedReason` losing to A1's own detections.
   - `Set-AlexQuotaCapped` / `Clear-AlexQuotaCapped` including the ok→capped transition guard (BUG-02) and the verify-after-write read-back.
   - `Test-AlexQuotaGate`: fail-open on every error path, the 6h plan TTL, the `reset_date` api expiry, `budget_priority <= 1` always runs, the amber HQ push.
   - The retry ladder: 5 attempts, +90 min, `ALEX_RETRY_ATTEMPT`, the persistent-API-cap skip (BUG-03), the exhausted-chain message. Backed by `systemd-run` (W8).
   - **The PowerShell case-insensitivity comment about `$Reason` vs `$DegradedReason` becomes irrelevant in Node.** Delete it; do not port a warning about a hazard that no longer exists.
2. Port `soul-canary.ps1` → `scripts/lib/soul-canary.mjs`. Keep the inert-unless-armed property: no token in `soul.md` or no nonce passed means the gate does nothing.
3. Port the three tests in `scripts/tests/` to Node, and **add** cases the PowerShell versions did not have: blank output, wrapper crash, >500-char run with no verdict line, >500-char run whose prose mentions "usage limit" (must NOT flag), mid-stream cap in the tail (must flag), quota gate fail-open on corrupt JSON.

**Verification:** the new test suite passes, including the negative cases. Then run one real wrapper end to end against `close-out.mjs` in `--dry-run` and diff the log output against a Windows-captured golden log.
**Rollback:** the `.ps1` library still exists and no wrapper points at the new one yet.

---

### PHASE 3: The 18 wrappers → bash
**Entry gate:** Phase 2 verified.

1. Write ONE canonical wrapper (`run-expense-wrangler.sh`, the simplest at 21 lines) and get it reviewed before writing the other 17. Shape:

```bash
#!/usr/bin/env bash
# bash 3.2-compatible (ruling F): no readlink -f, no associative arrays, no globstar.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
log_init "expense-wrangler"

node "$ALEX_ROOT/scripts/lib/close-out.mjs" quota-gate --project expenses --log "$LOG" || exit 0

set +e
out="$("$CLAUDE" --model claude-sonnet-4-6 -p "Run /expense-wrangler. $ALEX_VERDICT_INSTRUCTION" --dangerously-skip-permissions 2>&1)"
code=$?
set -e
printf '%s\n' "$out" >> "$LOG"

printf '%s' "$out" > "$TMPOUT"   # a real temp file, not <(...): process substitution is bash-only
node "$ALEX_ROOT/scripts/lib/close-out.mjs" check --project expenses --code "$code" --log "$LOG" --out-file "$TMPOUT"
```

2. Port the other 17. The six with deterministic cores (`run-sprint-tracker`, `run-personal-crm`, `run-alex-hq`, `run-morning-brief`, `run-lint`, `run-landscape-eval`) need their core step preserved, including the "run the deterministic half even when the quota gate says skip" behavior.
3. `chmod +x` every one, and `git update-index --chmod=+x` (W26).
4. **Secrets relocation (ruling §5.A), in the same edit pass.** Every wrapper that reads `work/16-alex-hq/config/alex-hq-token.txt` or `work/03-application-engine/config/n8n-api-key.txt` stops reading a repo path and calls the `secret(id)` resolver from `paths.mjs` instead. Move the 4 files to `~/.config/alex/secrets/`, `chmod 600`, and register each in `system/credentials-ledger.json`. Doing this now, while the file is already open for the path fix, is what makes the ruling near-free.
5. **Update the contract in the same commit:** `system/manifest.json` → `meta.model_routing.local_wrappers.pins` and `deterministic_no_pin` keys go from `run-x.ps1` to `run-x.sh`. Then `scripts/validate-alex.js:1073` regex goes from `/^run-.*\.ps1$/` to `/^run-.*\.sh$/`, and the `auth-check.ps1` literal to `auth-check.sh`. **V13 will fail loudly if these drift, which is the point.**
6. Run `node scripts/generate-alex.js` so every generated surface picks up the new names.

**Verification:** `node scripts/validate-alex.js` passes V13 with 16 pins + 2 no-pin all resolving to real executable files. Run each wrapper once with the quota gate forced closed (fast, no tokens) and confirm the log shape, **on both the Mac and the Linux host**, since this is the first phase where BSD-vs-GNU divergence could bite. Then run three real ones (`morning-brief`, `alex-hq`, `expense-wrangler`) with tokens and confirm GREEN reaches Alex HQ. Confirm every relocated secret resolves and every one is mode `600` and outside the repo.
**Rollback:** `.ps1` files untouched; revert the manifest + validator commit. Secrets are a file move, so `mv` them back.

---

### PHASE 4: Scheduler: Task Scheduler → systemd user timers
**Entry gate:** Phase 3 verified, all wrappers runnable by hand.

> **DEPLOY-ONLY PHASE (ruling §5.C).** macOS has no systemd, so none of this can be written-and-tested in the normal Mac loop. Every step below happens against the Linux host. This is the largest untestable-locally surface in the migration, so budget for round trips and do not batch changes: verify each unit as it is created. `gen-scheduler.js` must **detect a non-systemd platform and degrade to a LOUD SKIP**, never a silent no-op and never a crash, so the generator still runs clean on the Mac.

1. Extend `scripts/lib/gen-scheduler.js`: replace the `schtasks` query with `systemctl --user list-timers --all -o json`, and the `schtasks /create` apply with unit-file generation into `systemd/`. Add the platform guard described above.
2. Unit template mapping (W10). One `.service` (Type=oneshot, `WorkingDirectory=`, `Environment=`) + one `.timer` (`OnCalendar=`, `Persistent=true`, `WakeSystem=` where the Windows job had `WakeToRun`, `RandomizedDelaySec=0` because these jobs are time-anchored).
3. `loginctl enable-linger $USER` so user timers fire without an active login session. **This is mandatory and easy to forget**; a headless box without linger silently runs nothing.
4. Port `check.ps1` C7 + C7b into the Phase 5 checker port, reading systemd instead of Task Scheduler. Keep the C7b trigger-time comparison (documented hour must equal live hour) since it caught a real class of drift.
5. Update `scripts/hq_infra_harvest.py:82` (`scheduled_jobs_active`) to count enabled timers.
6. Update `scripts/validate-alex.js` V2 live half, keeping its `pre-commit` context degradation (LOUD WARNING SKIP when the scheduler is unreachable) so an offline machine can still commit.
7. Rewrite `.claude/commands/cron-setup.md` for systemd.
8. **Timezone:** set the machine tz to `Europe/Stockholm` and migrate the `travel-state.json` schema (W18) before enabling any timer, because every `OnCalendar=` is wall-clock.

**Verification:** `systemctl --user list-timers` shows all 23 documented jobs. C7 reports zero drift both directions. Force one job with `systemctl --user start PersonalOS-alex-hq.service` and confirm it completes and pushes to HQ. Reboot the box and confirm `Persistent=true` fires a missed job.
**Rollback:** `systemctl --user disable --now 'PersonalOS-*.timer'`. Nothing else is touched.

---

### PHASE 5: The checkers → Node
**Entry gate:** Phase 4 verified.

Port in this order (least to most coupled):
1. `n8n-active-check.ps1` → `.mjs`. Small, self-contained, pure HTTP + manifest read. Good warm-up.
2. `run-vault-index.ps1` → `.sh` wrapper (it mostly shells out to `vault_search.py`, `system/recall/harvest.js`, `scripts/lesson-harvest.js` already).
3. `escrow-test.ps1` → `.mjs`. Interactive passphrase prompt: read from a TTY without echo, write to a `mktemp` file with mode `600`, `trap` to shred. **Preserve that it is the ONLY writer of the C14 attestation** and that it closes the human-actions item in the same run.
4. `security-sweep.ps1` → `.mjs`. gitleaks resolution becomes trivial (W15).
5. `check.ps1` → `.mjs`. The 627-line main event. Port **one check at a time**, each as its own exported function, each with its own commit. Special handling:
   - **C7/C7b:** systemd (done in Phase 4).
   - **C8:** hash case normalization (W22). This is where you also delete the duplicated hashing in `stale-status-check.js` and have it import the shared function.
   - **C17:** symlink semantics, not junctions (W19). Update the remediation string.
   - **C18:** IANA timezone via `timedatectl` (W18).
   - **C21 / facts-check.js:** the doc-drift check tests standing doc claims against `facts.db`. **Several of those claims are about PowerShell.** Every claim that says "`.ps1`" needs its regex updated in the same commit, or C21 goes red on day one.
6. Re-run `check.ps1 -Init` equivalent (`check.mjs --init`) ONCE at the end to rebaseline C8 hashes.
7. Update the four parsers that read `check.ps1` by path: `narrative-drift-check.py:30` (it counts `# --- C<n>` headers, so the new file must keep that exact header format), `system/recall/harvesters/h-recovery.js:11`, `scripts/facts-check.js`, `scripts/stale-status-check.js`.
8. Update `scripts/human-actions.js:99` which prints `powershell -File work/18-recovery-layer/escrow-test.ps1` as remediation text.

**Verification:** run the new checker against the pre-migration Windows baseline and confirm it reports the **same drift set**. This is the single best parity test available: same repo content, same 21 checks, same findings. Any difference is either a migration bug or a check that was silently Windows-dependent.
**Rollback:** per-check, since each is its own commit.

---

### PHASE 6: The backup layer
**Entry gate:** Phase 5 verified. **This phase carries the most risk; nothing here ships without a proven restore.**

1. `git-backup.ps1` → `git-backup.sh`. Straightforward. Keep: push the **current branch** not a hardcoded `main` (BUG-17), push even on no-change days, GREEN/RED HQ push. Drop the `cmd /c` wrapper (W17).
2. `vault-backup.ps1` → `vault-backup.sh` (orchestration) + `scripts/lib/backup-include.mjs` (the include-set logic).
   - Include set still derives from `git ls-files --others --ignored --exclude-standard --directory` so it cannot drift from what is local-only. Keep the `$junk` exclusion regex and the `keepOutputs` allowlist verbatim.
   - Keep the `n < 5 paths` refusal, the `<100KB` blob refusal, and the `<50 entries` decrypt-verify refusal. These are the guards that stop a thin backup shipping.
   - Keep the positive assertion that both identity docs are inside the decrypted archive by name. Their `-C` anchor changes to `~/Documents/alex-project/` with leaf `story-and-guides` (ruling §5.B). The rename removes the space and ampersand, so the quoting around this call gets simpler, not harder.
   - **NEW third tar leg for the relocated secrets (ruling §5.A).** Secrets moved to `~/.config/alex/secrets/` are no longer picked up by the `git ls-files --others --ignored` derivation, so they must be tarred explicitly with their own `-C` anchor, exactly like the identity docs. **Add a positive by-name assertion inside the decrypted archive for each of the 4 secret files.** This is the single most important line in the phase: a relocated secret that silently stops being backed up is the one way ruling A can hurt you, and an assertion is the only thing that makes it loud.
   - GNU tar replaces the bsdtar pin (W12) and the `-T` list file no longer needs BOM-free/LF special-casing.
   - `trap 'shred_temps' EXIT INT TERM` replaces the `finally` block. Verify it fires on SIGINT and SIGTERM, not just clean exit.
   - The month-end producer wait reads systemd (`systemctl --user is-active PersonalOS-expense-wrangler.service`) instead of `Get-ScheduledTask`.
   - scp/ssh to the Hetzner box are unchanged. **The n8n box is already Linux**, so the remote half of this script needs zero work.
3. Keep the four nightly Node aggregates that run before the tar (ledger reconcile, outcome loop, content loop, cost tripwires), each still best-effort and never able to fail the backup.
4. Update `.gitignore`: the 4 secret paths become historical, since those files no longer live in the repo. **Leave the entries in place as a safety net** rather than deleting them; a stale ignore rule costs nothing and protects against a file being recreated in the old location by an un-migrated script.

**Verification, and this is a hard gate:**
- Run `vault-backup.sh --dry-run` and diff the include-set path count against the last Windows run.
- Run it for real. Confirm the blob lands on Hetzner at the expected byte size.
- **Do a full restore drill onto a scratch directory**: `gpg -d`, `tar -x`, confirm `soul.md` sha256, count vault files, confirm both identity docs, **and confirm all 4 relocated secrets are present**. Do not mark this phase done on a successful backup alone; a backup you have not restored is a hypothesis.
- Confirm `backup-destinations.json` gets stamped and C20 sees ≥2 destinations (or reports the known B2-pending amber).

**Rollback:** keep the Windows box able to run one more backup until the Linux restore drill passes. Do not decommission until then.

---

### PHASE 7: Voice layer, PARK (not port)
**Entry gate:** Phase 6 verified. Per ruling §5.D this is a park, not a migration. Roughly an hour, not a day.

1. **Neutralize the two hooks.** `.claude/settings.json` Stop + Notification currently test for `work/voice/.venv/Scripts/python.exe` and, when absent, emit a `VOICE HOOK DOWN` system message plus an error-log line **on every single turn**. On Linux that path never exists, so left alone it would fire constantly. Replace both hook commands with a no-op (or remove the entries). This is the only mandatory step in the phase.
2. **Set the registry state.** `system/manifest.json` → the voice row goes to `DORMANT`, revisit `2026-11-05`, reason: "Windows-era TTS layer; needs a Linux never-mute floor before it can run on the new host." The DORMANT state's two-unchanged-revisits rule then forces an activate-or-retire call rather than letting it rot.
3. **Leave `work/voice/**` in the tree untouched**, with a dated banner at the top of `work/voice/README.md` recording: it is Windows-era code, it is parked not broken, and a future port needs (a) a Linux never-mute floor since **Windows SAPI has no equivalent** (`piper` for quality with a model download, `espeak-ng` as the truly-unkillable floor), (b) `libportaudio2` for `sounddevice`, and (c) acceptance that the Ctrl+Alt+D global hotkey is desktop-environment specific (GNOME custom shortcut, `sxhkd` on a WM) and can only be documented, never automated.
4. `outputs/voice/voice-on.flag` handling stays as-is. With the hooks neutralized the flag is simply inert, so nothing needs deleting.

**Verification:** start a session on the Linux host and confirm **no** `VOICE HOOK DOWN` message appears and `outputs/logs/voice-hook-errors.log` gains no lines. Confirm the registry shows DORMANT with the revisit date, and that `check.mjs` C13 (first-fire aging) does not flag it, since DORMANT rows are exempt from the LIVE/EVENT aging rule.
**Rollback:** restore the two hook entries. Nothing was deleted.

---

### PHASE 8: Contract and documentation propagation
**Entry gate:** Phases 1 to 6 verified.

This phase exists because of the Change Propagation standing order, and it is large. Every surface that names a `.ps1` file, Task Scheduler, or a Windows path:

**Machine-checked contracts (these fail loudly if missed, do them first):**
- `system/manifest.json`: `meta.model_routing.local_wrappers` (done Phase 3), `meta.paths.*` (W4), `meta.n8n_cron_doc`, any `states_doc`/`cadence_doc` prose naming PowerShell.
- `scripts/validate-alex.js`: V2 (schtasks → systemd), V13 (regex), plus any prose assertions.
- `scripts/facts-check.js` + C21 doc-claim regexes.
- `scripts/narrative-drift-check.py`: `CHECK_PS1` constant and the header-format assumption.
- `system/recall/harvesters/h-recovery.js` and `h-n8n.js`.
- `scripts/hq_infra_harvest.py`, `scripts/human-actions.js`, `scripts/outputs-ledger.js`, `scripts/stale-status-check.js`, `scripts/sprint-tracker-core.js`, `scripts/vault_search.py`.
- `scripts/lib/gen-scheduler.js`, `gen-routing-table.js`, `gen-command-headers.js`.

**Generated surfaces** (regenerate, do not hand-edit): `docs/GETTING-STARTED.md`, `docs/ARCHITECTURE.md`, `docs/README.md`, `docs/projects/README.md`, the CLAUDE.md routing region. Their **templates** in `templates/` are what actually need editing, in particular `templates/getting-started.template.md` (section 6 "Scheduling (Windows Task Scheduler)", the `irm https://claude.ai/install.ps1` line, the `core.longpaths` line, the whole job table).

**Hand-written surfaces:**
- `CLAUDE.md`: the Backup & Recovery section, the Model Routing "Local side" paragraph (every `scripts/run-*.ps1` reference and the V13 description), the Scheduling section, the Session Root section, the skills-pack junction/mklink notes.
- `scheduler/schedule.md`: all 23 job entries, the Task Settings hardening paragraph, the Timezone Policy.
- `.claude/commands/cron-setup.md`, `.claude/commands/new.md`.
- 15 `work/{NN}/CLAUDE.md` files that name a `.ps1` (01, 05, 13, 15, 16, 18, 23, 25, 26, 28, 30, 32, plus quota-reset-autorun and voice READMEs).
- `work/18-recovery-layer/SECURITY-PLAYBOOK.md`.
- `work/23-self-review/close-out-grader/` prompt + README.
- `.gitignore`: the `.claude/skills/` comment (junction → symlink), and the secrets block if §5.A moves secrets out.

**Out-of-repo identity docs** (standing order items 7 and 8, and they are not optional):
- `Alex-Plain-English-Guide.docx`: section 2 system-map table (the platform row is a whole-layer change, so this one genuinely warrants a redraw), section 5 "The clock" timetable, and a dated row in section 12 running-changes. Written in the guide's own plain-English register, edited via python-docx.
- `ALEX-OS-master.md`: §4 scheduler, §5 backup/recovery, §10 health, plus a dated line in §11.

**Vault:** `vault/projects/recovery/status.md`, `vault/identity.md` (§3), `vault/index.md`, `vault/log.md`, and an `error-log.md` entry for anything that broke during the migration.

**Verification:** `node scripts/generate-alex.js` runs clean; `node scripts/validate-alex.js` passes V1 to V13; `check.mjs` reports zero new drift; `narrative-drift-check.py` (C19) passes against the updated master doc; C21 passes against `facts.db`.

---

### PHASE 9: Teardown and proof
**Entry gate:** Phase 8 verified and the system has run one full week on Linux with green run_status across the job train.

1. Delete all 34 `.ps1` files and the 3 `.cmd` files in one commit. Not before: keeping them until a full week has passed means a regression is one `git revert` from a working state.
2. Remove `*.ps1 text eol=crlf` from `.gitattributes`.
3. Add a validator rule: **no `.ps1` file may exist in the repo**, and no tracked file may contain `C:\`. This makes the migration irreversible by accident.
4. Decommission the Windows box only after: one full backup+restore cycle proven on Linux, one full Monday recovery sweep green, and the passphrase escrow drill passed on the new machine.

---

## 5. DECISIONS (RULED 2026-08-05, do not re-litigate)

All six are settled. Each records what was chosen, and what it costs, so a future reader can see the trade that was accepted rather than only the outcome.

### C. Deployment topology: DEV ON MAC, RUN ON LINUX
The scheduled job train runs on a **Linux host**; day-to-day development happens on **macOS**.

Consequences that ripple through the whole plan:
- **systemd user timers** are the scheduler (§2.2, Phase 4). Confirmed, since the runtime host is Linux.
- **Phase 4 is DEPLOY-ONLY and cannot be exercised locally.** macOS has no systemd. This is now the single largest untestable surface in the migration and it gets its own risk row (§6) and its own verification step on the real host before Phase 9.
- Everything else (bash wrappers, all Node logic, all Python) runs identically on both, so Phases 1, 2, 3, 5 and 6 are fully testable on the Mac.
- **A dual-platform drift class now exists**: code that works on macOS and fails on Linux, or vice versa. Mitigated by the bash ruling below and by a CI-style smoke run on the Linux host at each phase boundary.

### F. Shell target: BASH 3.2-COMPATIBLE
macOS ships bash 3.2 (frozen 2007, GPLv2); Linux ships 5.x. The wrappers target **3.2**, so one file runs unmodified on both with no dev prerequisite.

This costs nothing real because the language split (§0) already moved every non-trivial operation into Node. The wrappers are ~25 lines of process plumbing each. Concrete constraints for whoever writes them:
- **No `readlink -f`** (BSD readlink lacks `-f`). Use the portable idiom: `ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"`.
- **No associative arrays** (`declare -A`), no `${var^^}` / `${var,,}` case conversion, no `mapfile`/`readarray`, no `**` globstar.
- `[[ ]]`, `local`, indexed arrays and `$(...)` are all fine in 3.2.
- Add a version guard in `scripts/lib/common.sh` that fails loud on bash < 3.2 rather than degrading silently.
- Other BSD-vs-GNU divergences to avoid in wrappers: `sed -i` (different syntax), `date -d` (GNU only), `stat` flags, `mktemp` templates. Where one is genuinely needed, do it in Node instead.

### A. Secrets: MOVE OUTSIDE THE REPO, DURING THE PORTS
The 4 real secret files move to `${XDG_CONFIG_HOME:-$HOME/.config}/alex/secrets/`, mode `600`, resolved through `system/credentials-ledger.json` (which is already the resolver for the gpg passphrase, so the pattern is proven).

Done **inside Phases 3 and 5**, not as a separate phase: those files are already being edited for the backslash-path fix (W3), so routing them through the ledger at the same time is near-free, where a later dedicated pass costs about a day.

What this buys, and it is the point on a PUBLIC repo where `.gitignore` is the sole barrier: the `git add -f` accident class and the "new secret file whose gitignore line was forgotten" class both become **structurally impossible**, not merely forbidden.

What it costs, and this must not be skipped: the vault-backup include set is derived from `git ls-files --others --ignored`, so relocated secrets **no longer ride the backup automatically**. Phase 6 must add an explicit second `-C`-anchored tar leg for the secrets dir, plus a positive by-name assertion inside the decrypted archive, mirroring exactly what the identity docs already do. A relocated secret that silently stops being backed up is the one way this decision can hurt you.

Scope note: only the 4 declared secret files move. The other ~48 call sites found in the audit are mostly one-off or dormant tools (`simplify-*.js`, the PowerBI scripts, `build-radar-collector.js`); they get the path fix but no behavior change.

### B. Identity docs: ON THE LINUX HOST, AT `~/Documents/alex-project/story-and-guides/`
Both documents live on the **runtime host**, not the Mac.

Reasoning: the nightly vault-backup **hard-asserts both documents by name inside the decrypted archive** and fails the run if either is missing. That backup runs on Linux. Putting the docs on the Mac would make that assertion depend on a sync mechanism (Syncthing, rclone, Dropbox), which is precisely the kind of invisible coupling that already caused byte-divergence twice in 2026-07 and forced the current one-file-object design.

- The `%USERPROFILE%\Desktop\Alex Project\Alex Presentation\files\` layout is retired.
- **Path renamed to kill a bug class:** the old path contained a space and an ampersand (`Alex Project`, `Story & Guides`). Both are legal on Linux but demand perfect quoting in every script forever. `alex-project/story-and-guides` removes the hazard permanently, at the cost of a one-time update to every reference.
- The "exactly one file object per document, many views" property is **preserved** using POSIX symlinks where NTFS junctions were used. Any legacy view path that is still wanted becomes a symlink into the canonical dir.
- Editing from the Mac happens over a mounted/remote path or edit-then-push. **Do not introduce a background file-sync daemon into the backup's dependency chain.**
- `system/manifest.json` → `meta.paths.master_reference_md` and `identity_doc_real_dir` / `identity_doc_views[]` all change in Phase 8.

### D. Voice layer: PARKED DORMANT
Not ported, not retired. Registry state goes to **DORMANT with a revisit date**, which is an existing lifecycle state carrying a two-unchanged-revisits activate-or-retire rule, so this cannot quietly become permanent by neglect.

Reasoning: 1,625 lines of Python with only 2 inbound references (the Stop and Notification hooks in `.claude/settings.json`), so parking is genuinely cheap and fully reversible, where retiring is not. Porting would cost a day and force maintaining **two** never-mute floors (macOS `say`, Linux `piper`/`espeak-ng`) across the split target, spent during the phases where attention belongs on the backup layer.

Phase 7 is therefore **not a port**. It becomes:
1. Replace the Stop and Notification hook commands in `.claude/settings.json` with no-ops, so a missing venv can never emit the "VOICE HOOK DOWN" system message on every turn.
2. Set the registry state to DORMANT with a revisit date of **2026-11-05** and a one-line reason.
3. Leave `work/voice/**` in the tree, untouched, with a dated banner in `work/voice/README.md` recording that it is Windows-era code and what a future port would need (a Linux TTS floor, plus the fact that Ctrl+Alt+D has no portable equivalent and can only be documented).

### E. `check.ps1` destination: STAYS AT `work/18-recovery-layer/check.mjs`
Four files parse it by path (`narrative-drift-check.py:30`, `h-recovery.js:11`, `facts-check.js`, `stale-status-check.js`), and the "project code lives in `work/`, scheduler plumbing lives in `scripts/`" rule holds on Linux exactly as it did on Windows. The `scripts/recovery/` idea in §3.1 is dropped.

---

## 6. RISK REGISTER

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Silent behavior change in `close-out.mjs`**, a run dies and reports green | Medium | Critical. This is the exact failure class the file was built over three incidents to prevent. | Port A1's detection logic literally, including every comment explaining why a gate is length-gated. Write the negative tests (a run whose prose *mentions* a limit must NOT flag). Phase 2 gets the heaviest test coverage of any phase. |
| **Case-sensitivity breakage** | High | Medium, and it presents as a mystery | Dedicated Phase 1 audit pass, plus a permanent validator check. |
| **Backup silently ships a thin or unopenable blob** | Low | Critical | The three existing refusal guards are preserved verbatim, and Phase 6 is gated on a **restore**, not a backup. |
| **C8 baseline hash-case mismatch floods drift on the first Monday** | High if unhandled | Low, but noisy enough to erode trust in the checker | Normalize case on comparison AND re-init once at the end of Phase 5. |
| **systemd user timers do not fire on a headless box** | Medium | High, silent | `loginctl enable-linger`. Verify with a real reboot in Phase 4, not just `list-timers`. |
| **C21 / facts-check goes red on day one** because standing doc claims name PowerShell | High | Low | Update the doc-claim regexes in the same commit as the checker port (Phase 5 step 5). |
| **Timezone drift shifts every scheduled job by an hour** | Medium (DST) | High | Set tz before enabling timers; keep C18 as a live check; use IANA IDs so DST is handled by the OS. |
| **Migration half-lands and the system runs on two platforms** | Medium | High | Branch discipline, phase gates, and the Phase 9 rule that `.ps1` files are deleted only after a full green week. |
| **The out-of-repo identity docs get forgotten** | High (they are outside the repo, so no tool sees them) | Medium | They are explicit line items in Phase 8, and the nightly backup's positive name assertion will catch their absence. |
| **A relocated secret silently stops being backed up** (new, from ruling §5.A) | Medium | **Critical.** Losing the gpg passphrase or the HQ token with no off-machine copy is unrecoverable, and nothing would notice until a restore. | The Phase 6 third tar leg plus a **positive by-name assertion for all 4 secret files inside the decrypted archive**, mirroring the identity-doc assertion. Restore drill explicitly checks for them. |
| **Phase 4 is written blind** (new, from ruling §5.C) | High | Medium. Wrong unit files waste round trips, but they fail loudly rather than silently. | Accept it as a constraint, not a bug. Build units one at a time against the host, never in a batch. `gen-scheduler.js` degrades to a LOUD SKIP on non-systemd so the Mac loop stays clean. |
| **Mac-passes / Linux-fails divergence** (new, from ruling §5.C) | Medium | Medium, and it presents late | bash 3.2 target (ruling F) removes most of it by construction. The Phase 1 BSD-vs-GNU lint catches `sed -i`, `date -d`, `readlink -f`, `stat -c`. Every phase boundary includes a smoke run on the host, not just the Mac. |
| **The case-sensitivity audit is run on the Mac and proves nothing** (new) | High if unnoticed | Medium | macOS is case-insensitive by default too, so the audit is explicitly specified to run **on the Linux host**. Called out in Phase 1 step 6. |
| **Voice hooks spam every turn on the new host** (new, from ruling §5.D) | Certain if unhandled | Low, but corrosive | The hooks test for a Windows venv path that will never exist on Linux and emit a system message plus a log line per turn. Phase 7 step 1 neutralizes them, and it is the phase's only mandatory step. |

---

## 7. VERIFICATION HARNESS

The migration needs its own proof, not just "it seems to run".

1. **Golden logs.** Before touching anything, capture one successful and one failed run log from Windows for `morning-brief`, `alex-hq`, `git-backup`, `vault-backup`. These are the diff targets for Phases 3 and 6.
2. **Close-Out unit suite** (Phase 2). Node tests over the A1 matrix. This is the highest-value test artifact the migration produces and it should outlive the migration.
3. **Checker parity run** (Phase 5). Same repo content, Windows checker findings vs Linux checker findings. They must match.
4. **Existing validators.** `validate-alex.js` V1 to V13 and `check.mjs` C1 to C22 both stay green at every phase boundary. They were built to catch exactly this kind of drift, so use them as the gate rather than writing new ones.
5. **V-CASE** (new, permanent): no path literal in the repo fails to resolve case-sensitively.
6. **V-NOPS** (new, permanent, Phase 9): no `.ps1` in the tree, no `C:\` in a tracked file.
7. **The restore drill** (Phase 6). Non-negotiable.

---

## 8. WHAT GETS SIMPLER (the wins, so the effort is worth naming)

The migration is not purely cost. Several things in this repo are complicated **only because of Windows**:

- The `tar.exe` pin and its 6-line comment about GNU tar reading `C:\...` as a remote host spec: **deleted**.
- The `cmd /c "git push"` wrapper around PowerShell's NativeCommandError handling: **deleted**.
- The `curl.exe` over `Invoke-RestMethod` workaround for a .NET TLS failure: **the workaround note goes**, curl stays as the honest choice.
- The UTF-8 BOM-avoidance dance in `close-out.ps1` ("node consumers choke on PS 5.1's utf8 BOM"): **deleted**.
- `[Net.ServicePointManager]::SecurityProtocol = Tls12` in 12 files: **deleted**.
- `core.longpaths=true` in every clone instruction: **deleted**.
- The junction-vs-symlink-vs-Git-Bash-copies mess for `.claude/skills/`: **becomes one `ln -s`**, and the whole "Git Bash `ln -s` silently COPIES on Windows, PowerShell symlinks need elevation" paragraph in CLAUDE.md goes away.
- The retry ladder's existence rationale ("Task Scheduler's RestartCount does NOT fire on a non-zero exit code") **stops being true**, opening a real simplification for a later pass.
- File permissions on secrets become enforceable (`chmod 600` + a check), which the Windows side never actually had.
- `stale-status-check.js`'s duplicated hashing collapses into a shared function.

Roughly 250 lines of pure Windows-workaround code disappear, and three long explanatory comments about Windows bugs stop needing to be maintained.

---

## 9. EFFORT ESTIMATE

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Decisions, provisioning, restore | 0.5 day |
| 1 | Portable foundations, case audit | 1 day |
| 2 | close-out.mjs + soul-canary.mjs + tests | 2 days |
| 3 | 18 wrappers + contract update | 1 day |
| 4 | systemd + gen-scheduler + C7 | 1.5 days |
| 5 | 5 checkers, check.ps1 being most of it | 3 days |
| 6 | Backup layer + restore drill | 1.5 days |
| 7 | Voice: **park, not port** (ruling §5.D) | **1 hour** |
| 8 | Propagation across ~50 surfaces + 2 identity docs | 1.5 days |
| 9 | Teardown, after a green week | 0.5 day |
| | **Total** | **~12 days**, plus a one-week soak before Phase 9 |

Adjustments the six rulings made to the original estimate:
- **Phase 7 collapsed** from 1 day to ~1 hour (park instead of port), taking the total from 13 to 12.
- **Phase 0 grew slightly**: it now has to stand up the two-machine dev loop and create the secrets and identity-doc directories before any code is written.
- **Phase 4 did not grow in raw hours but grew in elapsed time**, because every change needs a round trip to the Linux host. Plan it as a full day of wall clock even though it is a few hours of typing.
- **Phases 3 and 5 absorbed the secrets relocation** at roughly zero marginal cost, which is the entire reason ruling A chose "during the ports" over "its own phase" (that would have added a day).
- **Phase 6 grew by about an hour**: one more tar leg and one more set of assertions.

The two phases worth over-investing in are **2** (because 18 wrappers and the entire failure-detection contract sit on it) and **6** (because a broken backup is the only failure here that is not recoverable).

---

## APPENDIX A: File-by-file migration map

| Current | Becomes | Language | Phase |
|---|---|---|---|
| `scripts/run-airbnb-host.ps1` | `scripts/run-airbnb-host.sh` | bash | 3 |
| `scripts/run-alex-hq.ps1` | `scripts/run-alex-hq.sh` | bash | 3 |
| `scripts/run-alex-radar.ps1` | `scripts/run-alex-radar.sh` | bash | 3 |
| `scripts/run-application-engine.ps1` | `scripts/run-application-engine.sh` | bash | 3 |
| `scripts/run-email-triage.ps1` | `scripts/run-email-triage.sh` | bash | 3 |
| `scripts/run-expense-wrangler.ps1` | `scripts/run-expense-wrangler.sh` | bash | 3 |
| `scripts/run-landscape-eval.ps1` | `scripts/run-landscape-eval.sh` | bash | 3 |
| `scripts/run-landscape-monitor.ps1` | `scripts/run-landscape-monitor.sh` | bash | 3 |
| `scripts/run-lint.ps1` | `scripts/run-lint.sh` | bash | 3 |
| `scripts/run-morning-brief.ps1` | `scripts/run-morning-brief.sh` | bash | 3 |
| `scripts/run-personal-crm.ps1` | `scripts/run-personal-crm.sh` | bash | 3 |
| `scripts/run-runway.ps1` | `scripts/run-runway.sh` | bash | 3 |
| `scripts/run-self-review.ps1` | `scripts/run-self-review.sh` | bash | 3 |
| `scripts/run-sprint-tracker.ps1` | `scripts/run-sprint-tracker.sh` | bash | 3 |
| `scripts/run-vault-index.ps1` | `scripts/run-vault-index.sh` | bash | 5 |
| `scripts/run-weekly-exec-report.ps1` | `scripts/run-weekly-exec-report.sh` | bash | 3 |
| `scripts/run-whatsapp-harvest.ps1` | `scripts/run-whatsapp-harvest.sh` | bash | 3 |
| `scripts/auth-check.ps1` | `scripts/auth-check.sh` | bash | 3 |
| `scripts/lib/close-out.ps1` | `scripts/lib/close-out.mjs` | **Node** | 2 |
| `scripts/lib/soul-canary.ps1` | `scripts/lib/soul-canary.mjs` | **Node** | 2 |
| `scripts/git-backup.ps1` | `scripts/git-backup.sh` | bash | 6 |
| `scripts/vault-backup.ps1` | `scripts/vault-backup.sh` + `scripts/lib/backup-include.mjs` | bash + Node | 6 |
| `scripts/n8n-active-check.ps1` | `scripts/n8n-active-check.mjs` | **Node** | 5 |
| `work/18-recovery-layer/check.ps1` | `work/18-recovery-layer/check.mjs` | **Node** | 5 |
| `work/18-recovery-layer/security-sweep.ps1` | `…/security-sweep.mjs` | **Node** | 5 |
| `work/18-recovery-layer/escrow-test.ps1` | `…/escrow-test.mjs` | **Node** | 5 |
| `scripts/tests/test-soul-canary.ps1` | `scripts/tests/soul-canary.test.mjs` | **Node** | 2 |
| `scripts/tests/test-soul-canary-live.ps1` | `scripts/tests/soul-canary-live.test.mjs` | **Node** | 2 |
| `scripts/tests/test-completion-sentinel.ps1` | `scripts/tests/completion-sentinel.test.mjs` | **Node** | 2 |
| `work/quota-reset-autorun/scripts/arm.ps1` | `…/arm.sh` | bash | 7 |
| `work/quota-reset-autorun/scripts/disarm.ps1` | `…/disarm.sh` | bash | 7 |
| `work/quota-reset-autorun/scripts/poll-and-run.ps1` | `…/poll-and-run.sh` | bash | 7 |
| `work/31-portal-scanner/reset-reminder.ps1` | `…/reset-reminder.sh` | bash | 7 |
| `work/voice/talk.ps1` | *(unchanged, PARKED)* | - | 7 |
| `work/voice/v3/voice-on.cmd` | *(unchanged, PARKED)* | - | 7 |
| `work/voice/v3/voice-off.cmd` | *(unchanged, PARKED)* | - | 7 |
| `work/voice/v3/dictate.cmd` | *(unchanged, PARKED)* | - | 7 |
| *(new)* | `scripts/lib/common.sh` | bash | 1 |
| *(new)* | `scripts/lib/paths.mjs` | Node | 1 |
| *(new)* | `package.json`, `requirements.txt`, `.gitattributes` | - | 1 |
| *(new)* | `systemd/PersonalOS-*.{service,timer}` | - | 4 |
| *(new)* | `docs/INSTALL-LINUX.md` | - | 1 |

---

## APPENDIX B: Surfaces that reference PowerShell and must be updated (Phase 8)

Non-`.ps1` files containing a `.ps1` reference, from a full-tree grep:

`.claude/commands/cron-setup.md`, `.claude/commands/new.md`, `ALEX-REFACTOR-SPEC-FOR-CLAUDE-CODE.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/GETTING-STARTED.md`, `docs/architecture-analysis-2026-07-08.md`, `docs/projects/routing-table-detail-2026-07-06.md`, `refactor/reference-map.md`, `scheduler/schedule.md`, `scripts/facts-check.js`, `scripts/hq_infra_harvest.py`, `scripts/human-actions.js`, `scripts/lib/alex_paths.py`, `scripts/lib/gen-command-headers.js`, `scripts/lib/gen-routing-table.js`, `scripts/lib/gen-scheduler.js`, `scripts/narrative-drift-check.py`, `scripts/outputs-ledger.js`, `scripts/sprint-tracker-core.js`, `scripts/stale-status-check.js`, `scripts/validate-alex.js`, `scripts/vault_search.py`, `system/manifest.json`, `system/recall/README.md`, `system/recall/harvesters/h-n8n.js`, `system/recall/harvesters/h-recovery.js`, `templates/getting-started.template.md`, `work/01-sprint-tracker/CLAUDE.md`, `work/04-research-team/patterns/*.md` (2), `work/05-personal-crm/CLAUDE.md`, `work/13-airbnb-host/CLAUDE.md`, `work/15-alex-ai-radar/CLAUDE.md`, `work/16-alex-hq/CLAUDE.md`, `work/18-recovery-layer/CLAUDE.md`, `work/18-recovery-layer/SECURITY-PLAYBOOK.md`, `work/23-self-review/CLAUDE.md`, `work/23-self-review/close-out-grader/README.md`, `work/23-self-review/close-out-grader/grader-prompt.md`, `work/25-evolution/CLAUDE.md`, `work/26-prompting/CLAUDE.md`, `work/28-chat-gateway/CLAUDE.md`, `work/30-portfolio-site/CLAUDE.md`, `work/32-portal-application-engine/CLAUDE.md`, `work/quota-reset-autorun/CHEATSHEET.md`, `work/quota-reset-autorun/README.md`, `work/voice/CHEATSHEET.md`, `work/voice/README.md`, `work/voice/alex_voice.py`.

Plus the two out-of-repo identity docs, which no grep can reach and which the standing orders require.

Historical documents (`ALEX-REFACTOR-SPEC-FOR-CLAUDE-CODE.md`, `docs/architecture-analysis-2026-07-08.md`, `docs/projects/routing-table-detail-2026-07-06.md`, `refactor/reference-map.md`) are dated records of past decisions. **Do not rewrite them.** Add a dated banner noting the platform moved, and leave the body intact.
