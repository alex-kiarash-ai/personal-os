# Installing Alex on Linux (and developing on macOS)

Added 2026-08-05 as Phase 1 of the bash migration. The full plan, including every ruling this
document implements, is `bash-migration-plan.md` at the repo root.

---

## The topology, stated once

**Development happens on macOS. The scheduled job train runs on Linux.** (Ruling C of the
migration plan.) That split is deliberate and it has three consequences you will hit immediately:

1. **`systemd/` is inert on macOS.** macOS has no systemd. The unit files are generated artifacts
   for the Linux host; on the Mac they are just text. `gen-scheduler.js` degrades to a loud skip
   rather than crashing, so a generator run on the Mac is still clean.
2. **Shell scripts target bash 3.2**, because macOS ships bash 3.2.57 (frozen in 2007) and Linux
   ships 5.x. One file has to run on both. `scripts/tests/portability-check.mjs` enforces this.
3. **The case-sensitivity check only means something on Linux.** macOS is case-insensitive by
   default, exactly like the Windows box this system is migrating off. A path with wrong casing
   works on both and breaks on Linux.

---

## Prerequisites

### Both machines

| Tool | Floor | Why |
|---|---|---|
| **Node** | **22+** | `system/recall/` uses `node:sqlite`, which lands in Node 22. This is a hard floor, not a preference. Node is the logic layer: generators, validators, the recall spine, the Close-Out Gate, the recovery checker. |
| **Python** | **3.9+** | Verified by compiling every tracked `.py` under 3.9.6. 3.11+ recommended on the host for speed. |
| **git** | 2.30+ | |
| **bash** | 3.2+ | macOS already satisfies this. Do not `brew install bash` on the Mac expecting to use bash 5 features; the code deliberately does not use them. |

### Linux host only

```bash
sudo apt install -y \
  git gnupg tar openssh-client curl jq \
  python3 python3-venv nodejs \
  rclone
```

Plus, not in most default repos:
- **gitleaks** (the pre-commit secret scan and the monthly S1 history sweep). Install from the
  upstream release page or your distro's backports.

Optional, only if the voice layer is ever un-parked: `libportaudio2`.

### Verify

```bash
for c in git gpg tar ssh curl jq node python3 rclone gitleaks; do
  printf '%-10s %s\n' "$c" "$(command -v $c || echo 'MISSING')"
done
node --version    # must be >= 22
python3 --version # must be >= 3.9
bash --version | head -1
```

---

## Install

```bash
git clone https://github.com/alex-kiarash-ai/personal-os.git
cd personal-os

# Python side (optional; only the workbook and guide tooling needs it)
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

# Node side: there is nothing to install.
```

**There are no npm dependencies.** Every Node file in this repo imports only builtins (`assert`,
`child_process`, `crypto`, `fs`, `https`, `os`, `path`). `git clone` is a complete install of the
Node layer. That is deliberate on a machine that holds credentials: zero supply-chain surface.
Keep it that way; adding a dependency is a decision, not a convenience.

---

## What a clone does NOT give you

The repo is **public** and was privacy-scrubbed on 2026-07-04. A clone is a **vault-less skeleton**:

- No `vault/` (the entire knowledge wiki)
- No `soul.md` (so the first session is plain Claude, not Alex, and the generator refuses to run)
- No `work/*/config/` credentials
- No `system/credentials-ledger.json`

Those live only in the **encrypted vault backup**. Restoring them is Phase 0 of the migration and
is also, deliberately, the first restore drill on the new platform:

```bash
gpg -d vault-YYYYMMDD-HHMM.tar.gpg | tar -x -C /path/to/personal-os
```

Verify the restore by hashing `soul.md` against its pre-migration value, and confirm both identity
documents are present.

---

## Directory layout on the host

Two things live **outside** the repo on purpose, because the repo is public and `.gitignore` is
the only barrier between personal data and the internet:

| What | Where | Mode |
|---|---|---|
| **Secrets** (HQ token, n8n API key, gpg passphrase, qra token) | `~/.config/alex/secrets/` | dir `700`, files `600` |
| **Identity docs** (`ALEX-OS-master.md`, `Alex-Plain-English-Guide.docx`) | `~/Documents/alex-project/story-and-guides/` | normal |

```bash
mkdir -p ~/.config/alex/secrets && chmod 700 ~/.config/alex/secrets
mkdir -p ~/Documents/alex-project/story-and-guides
```

Secrets are reached **only** through `scripts/lib/paths.mjs` → `secret(id)`, which resolves via
`system/credentials-ledger.json`. No code names a credential path. A missing credential fails
loud; it never degrades to an empty string, because an empty token becomes a silently
unauthenticated HTTP call that "succeeds" with a 401 body.

Note the path rename: the old Windows location contained a space and an ampersand
(`Alex Project` / `Story & Guides`). Both are legal on Linux but demand perfect quoting in every
script forever, so they were dropped.

---

## Scheduling (Linux host only)

The job train runs on **systemd user timers**, replacing Windows Task Scheduler. Unit files are
generated into `systemd/` from `scheduler/schedule.md`; they are reviewable in git and linked into
place, never hand-written in `~/.config/systemd/user/`.

```bash
loginctl enable-linger "$USER"   # MANDATORY: without it, user timers never fire on a headless box
systemctl --user link "$PWD"/systemd/PersonalOS-*.{service,timer}
systemctl --user enable --now PersonalOS-morning-brief.timer
systemctl --user list-timers
```

`loginctl enable-linger` is the step everyone forgets. Without it the timers exist, look correct
in `list-timers`, and silently never run.

Set the machine timezone before enabling anything, since every `OnCalendar=` is wall-clock:

```bash
sudo timedatectl set-timezone Europe/Stockholm
timedatectl show -p Timezone --value
```

---

## Health checks

```bash
npm run portability   # P1 exact-case paths, P2 BSD/GNU-isms, P3 bash 4 constructs
npm run validate      # V1..V13, the generated-surface contract
npm run generate      # regenerate every generated surface (needs soul.md, so host-only)
```

On a fresh clone with no vault, expect `V2` (no scheduler yet) and `V6` (no n8n credentials in the
environment) to fail, and the generator to refuse on a missing `soul.md`. That is the correct
skeleton baseline, not a broken install.

---

## macOS dev-machine notes

- `/bin/bash` is 3.2.57. That is the target, so use it rather than a Homebrew bash 5.
- `/bin/sh` on macOS is bash in POSIX mode, whereas on Linux it is usually `dash`. Always use an
  explicit `#!/usr/bin/env bash` shebang; never rely on `sh` behaving the same on both.
- BSD userland differs from GNU: `sed -i` needs an argument, `readlink` has no `-f`, `date` has no
  `-d`, `stat` uses `-f` not `-c`. `portability-check.mjs` flags all of these in `.sh` files. When
  you need that behavior, do it in Node instead of branching on platform.
- The filesystem is case-insensitive by default, so run the portability check on the **host**
  before believing a clean result.
