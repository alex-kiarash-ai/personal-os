# systemd units (GENERATED)

Generated from `scheduler/schedule.md` by `scripts/lib/gen-systemd.js`. Do not hand-edit a unit
file: edit `scheduler/schedule.md` and run `node scripts/generate-alex.js`.

**These files are inert on macOS.** The dev machine has no systemd (ruling C of the bash migration
plan: dev on macOS, run on Linux). Seeing them here on a Mac does not mean anything is broken.

**On absolute paths (2026-08-18 follow-up to the PowerShell teardown).** Every unit here carries
two kinds of path, and only one of them is a portability bug:

- `WorkingDirectory=` and `ExecStart=` are genuinely absolute, and systemd requires that - a
  relative path is invalid there. They are derived from wherever the repo actually lives on the
  machine that ran the generator (`__dirname`-relative, never a literal), which means a checked-in
  unit reflects the LAST machine to regenerate it. That is expected, not a bug: **run
  `node scripts/generate-alex.js` on the actual deploy host before linking these units**, so the
  path matches where the repo is really cloned there. Regenerating is one command; the file
  committed here is a reviewable snapshot, not the source of truth.
- `Documentation=` used to be a `file://` path built the same way, which meant every checked-in
  unit pointed at one developer's home directory and would 404 for anyone else. It now resolves the
  project's `git remote origin` and points at `scheduler/schedule.md` on GitHub instead (pinned to
  `main`, not whatever branch generated it, so the link outlives a feature branch). That is
  genuinely portable: it resolves identically regardless of who clones the repo or where. Falls
  back to the old local `file://` path only if there is no GitHub `origin` remote.

## Installing on the Linux host

```sh
# 1. Link the units from the repo (they stay in git; ~/.config/systemd/user just points here).
systemctl --user link "$PWD"/systemd/PersonalOS-*.service "$PWD"/systemd/PersonalOS-*.timer
systemctl --user daemon-reload

# 2. Enable + start every timer that is NOT disabled by design (see the table below).
for t in systemd/PersonalOS-*.timer; do
  name="$(basename "$t")"
  case "$name" in PersonalOS-sprint-tracker.timer|PersonalOS-whatsapp-harvest.timer) continue;; esac
  systemctl --user enable --now "$name"
done

# 3. MANDATORY and easy to forget: without lingering, user timers do not fire unless someone is
#    logged in. A headless box without this silently runs nothing at all.
loginctl enable-linger "$USER"

# 4. Verify.
systemctl --user list-timers --all
```

## Timezone

Every `OnCalendar=` is wall-clock in the machine's local timezone. Set it BEFORE enabling anything:

```sh
sudo timedatectl set-timezone Europe/Stockholm
```

DST is then handled by the OS, which is the whole reason the schema moved from Windows timezone IDs
to IANA ones (W18).

## Jobs

23 jobs generated.

### Disabled by design - do NOT enable

- `PersonalOS-sprint-tracker` - paused by Shaheen 2026-07-16 until he says otherwise
- `PersonalOS-whatsapp-harvest` - retired Phase-1 02:30 trigger must never be re-armed

## What is deliberately NOT here

`Restart=on-failure`. systemd would fire it on a non-zero exit, unlike Task Scheduler's
`RestartCount` (which was the whole reason the close-out retry ladder was written). That makes the
ladder arguably redundant on Linux - and it is still ported as-is, because changing failure-recovery
behavior during a platform move makes any incident un-diagnosable. Simplifying it is a separate
decision with its own verification.
