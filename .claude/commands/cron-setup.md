# /cron-setup - Manage System Schedules

Manage the local scheduled jobs. On this machine that means **systemd user timers**, one
`PersonalOS-{name}.timer` + `.service` pair per entry in `scheduler/schedule.md`, each running a
**hardened wrapper** `scripts/run-{name}.sh` (never a bare `claude -p`). Modes: on, off, update.

## Usage
- `/cron-setup` or `/cron-setup on` - Register/refresh every job in scheduler/schedule.md
- `/cron-setup off` - Disable ALL PersonalOS jobs
- `/cron-setup off morning-brief` - Disable one job
- `/cron-setup off morning-brief personal-crm` - Disable several
- `/cron-setup on morning-brief` - Re-enable a specific job

## Reality on this machine (read first)
- **No auth token.** Timers run as the logged-in user and reuse the existing Claude Code login. The old
  `CLAUDE_CODE_OAUTH_TOKEN` / `claude setup-token` flow is gone - do NOT ask for a token.
- **Source of truth:** `scheduler/schedule.md` (the `### ` entries carry the job name + frequency). The
  unified generator `node scripts/generate-alex.js` writes the unit files into `systemd/` and creates
  MISSING timers from it (create-missing-only, never touching a job that already exists). `/cron-setup`
  is for the manual on/off/enable/disable. Both read the same schedule.md.
- **Units live in the repo, at `systemd/`.** They are generated artifacts, so they belong beside the
  source that produces them and are reviewable in git. `systemctl --user link` points at them from
  there. NEVER hand-edit a unit file: edit schedule.md and regenerate, or the next generator run
  silently reverts you.
- **Validation couples them:** `scripts/validate-alex.js` check V2 compares schedule.md against the live
  `systemctl --user list-timers` set. A job documented in schedule.md with no live timer (or a live
  PersonalOS timer absent from schedule.md) fails V2 and blocks commits. So schedule.md and systemd must
  always agree.
- **Check state:** `systemctl --user list-timers --all`. Logs: `outputs/logs/{name}.log`, plus
  `journalctl --user -u PersonalOS-{name}.service` for anything the wrapper never got to write.

## LINGERING - the one that silently breaks everything
```sh
loginctl enable-linger "$USER"
```
Without it, user timers only run while a login session is active. On a headless box that means the
whole job train quietly does nothing, with no error anywhere. Check it before debugging anything else:
`loginctl show-user "$USER" --property=Linger` must say `Linger=yes`.

## Timezone
Every `OnCalendar=` is wall-clock local time. Set the machine timezone BEFORE enabling any timer:
```sh
sudo timedatectl set-timezone Europe/Stockholm
```
DST is then the OS's problem, which is the entire reason the schema uses IANA IDs.

## How "On" works
1. Read `scheduler/schedule.md` for every `### ` entry (name, command, frequency).
2. For each entry, confirm a hardened wrapper `scripts/run-{name}.sh` exists (sources
   `scripts/lib/common.sh`; a wrapper that runs a real automation ends with `close_out`). If the
   wrapper is missing, create it from the canonical pattern (`scripts/run-expense-wrangler.sh`)
   BEFORE registering the timer - never schedule a bare `claude -p`.
3. Run `node scripts/generate-alex.js` to write/refresh the units, then link + enable what is missing.
4. Report what was registered and what already existed.

### Registering one job by hand
```sh
systemctl --user link "$PWD/systemd/PersonalOS-{name}.service" "$PWD/systemd/PersonalOS-{name}.timer"
systemctl --user daemon-reload
systemctl --user enable --now PersonalOS-{name}.timer
systemctl --user list-timers PersonalOS-{name}.timer     # verify it is scheduled
```

### Hardening (canonical list: scheduler/schedule.md "Task Hardening")
The Windows vocabulary maps like this, and the mapping is applied by `scripts/lib/gen-systemd.js`:

| Windows | systemd | Note |
|---|---|---|
| `StartWhenAvailable` | `Persistent=true` | Strictly better: fires on the next boot if the machine was off |
| `WakeToRun` | `WakeSystem=true` | Only where schedule.md documents it |
| `ExecutionTimeLimit` | `RuntimeMaxSec=` | Read per job from schedule.md; 2h default |
| `MultipleInstances IgnoreNew` | nothing | `Type=oneshot` already refuses a concurrent start |
| `RestartCount` / `RestartInterval` | **deliberately unmapped** | See below |

- **The real retry is NOT a unit setting.** It is the close-out lib's self-scheduled one-shot
  (`PersonalOS-retry-{wrapper}-{n}`, +90 min, attempts 2-5, a transient `systemd-run --collect` unit
  that self-deletes). systemd's `Restart=on-failure` WOULD fire on a non-zero exit, unlike Task
  Scheduler's `RestartCount` - which is exactly why the ladder was written. That makes the ladder
  arguably redundant here, and it is still ported as-is: changing failure-recovery behavior during a
  platform move makes any incident un-diagnosable. Simplifying it is a separate decision.

## How "Off" works
- `/cron-setup off` (no name): list the live PersonalOS timers, confirm, then
  `systemctl --user disable --now PersonalOS-{name}.timer` for each. Disable, don't delete the unit -
  a disabled timer keeps its definition and stays documented in schedule.md, so V2 still sees it
  (mark it disabled in schedule.md, as whatsapp-harvest is).
- `/cron-setup off {name}`: `systemctl --user disable --now PersonalOS-{name}.timer`.
- Re-enable: `systemctl --user enable --now PersonalOS-{name}.timer`.

### Disabled by design - do not "fix" these
- `PersonalOS-sprint-tracker` - paused by Shaheen 2026-07-16 until he says otherwise.
- `PersonalOS-whatsapp-harvest` - its retired Phase-1 02:30 trigger must never be re-armed.

The generator writes their units but never enables them. Both are correct as they stand.

## Changing an existing job
Edit `scheduler/schedule.md`, run `node scripts/generate-alex.js`, then:
```sh
systemctl --user daemon-reload
systemctl --user restart PersonalOS-{name}.timer
```
No in-place mutation dance is needed any more: the unit file IS the settings, it is generated from
schedule.md, and it is in git. (The Windows note about `schtasks /change` hanging on a password prompt
is gone with the platform.)

## Testing a job without waiting for its slot
```sh
systemctl --user start PersonalOS-{name}.service    # runs it now, timer untouched
journalctl --user -u PersonalOS-{name}.service -n 50 --no-pager
```

## After setup
- Report: jobs registered/enabled/disabled, their schedules, `systemctl --user list-timers --all`.
- If schedule.md changed, run `node scripts/generate-alex.js` so the docs and units regenerate and V2
  re-checks schedule.md against the live set.
- Append the change to `vault/log.md`; update `scheduler/schedule.md` if a job was added/removed/retimed.

## Other platforms (portability note)
This command is systemd-first because that is where Alex runs (ruling C: dev on macOS, run on Linux).
**On the macOS dev box none of this works and that is expected** - `systemd/` is inert there, and the
generator degrades to a LOUD SKIP rather than pretending. Do not reintroduce an OAuth token; reuse the
logged-in session.
