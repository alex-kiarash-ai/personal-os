# systemd units (GENERATED)

Generated from `scheduler/schedule.md` by `scripts/lib/gen-systemd.js`. Do not hand-edit a unit
file: edit `scheduler/schedule.md` and run `node scripts/generate-alex.js`.

**These files are inert on macOS.** The dev machine has no systemd (ruling C of the bash migration
plan: dev on macOS, run on Linux). Seeing them here on a Mac does not mean anything is broken.

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

21 jobs generated.

### Disabled by design - do NOT enable

- `PersonalOS-sprint-tracker` - paused by Shaheen 2026-07-16 until he says otherwise
- `PersonalOS-whatsapp-harvest` - retired Phase-1 02:30 trigger must never be re-armed
### Not generated

These are documented but produced no unit. Each is a real finding, not noise.

- PersonalOS-git-backup (wrapper scripts/git-backup.sh does not exist yet)
- PersonalOS-vault-backup (wrapper scripts/vault-backup.sh does not exist yet)

## What is deliberately NOT here

`Restart=on-failure`. systemd would fire it on a non-zero exit, unlike Task Scheduler's
`RestartCount` (which was the whole reason the close-out retry ladder was written). That makes the
ladder arguably redundant on Linux - and it is still ported as-is, because changing failure-recovery
behavior during a platform move makes any incident un-diagnosable. Simplifying it is a separate
decision with its own verification.
