# Quota Reset Auto-Run (one-shot)

Fire a prompt in full auto the moment your Claude plan quota comes back, without babysitting it.
Built 2026-07-13 via /prompting (outputs/prompting/2026-07-13/quota-reset-auto-run.md), then run.

## What it does
You supply a reset time (the "resets at X" line Claude Code shows you). The job fires **once** at
reset + 5 min, runs your pasted prompt via `claude -p --dangerously-skip-permissions` (full auto,
no approvals), emails you the result, then disables itself. One shot, no recurrence.

## Architecture (Shaheen's calls, 2026-07-13)
**Hetzner triggers, the laptop runs. Pull design, no tunnel.**

```
  Hetzner n8n workflow "Quota Reset Auto-Run (one-shot gate)"  (holds fire_at + go/consumed in static data)
     ^  GET /webhook/qra-gate  (every 60s, token-gated)
     |
  ThinkPad scheduled task PersonalOS-qra-poller --> go? --yes--> claude -p (full auto) --> save + email draft
     |                                                              |
     +--- POST /webhook/qra-result (marks consumed) <---------------+   then the task self-removes (one shot)
```

- The box is the trigger authority (owns the schedule + the go/consumed flags). The laptop is a dumb
  executor that asks "go yet?". No inbound port or tunnel on the laptop.
- The laptop **must be awake** at fire time (the price of a real agentic run; a bare API call on the
  box could not run tools/edits). If it's asleep at reset+5, the gate stays `go` and the run fires on
  the next wake within 24h.

## Security
All three webhooks are token-gated (header `X-QRA-Token`, n8n credential `QRA Header Auth`
`t6G41mSyUrqqreHR`). Without the token the gate returns 403 (verified). The token is at
`config/qra-token.txt` (gitignored, never committed). This matters: `qra-arm` sets a prompt that runs
on the laptop with `--dangerously-skip-permissions`, so it can never be an open endpoint.

## Use it
1. Paste your real prompt into `payload-prompt.txt` (replace the placeholder).
2. Arm it:
   ```powershell
   cd work\quota-reset-autorun\scripts
   .\arm.ps1 -ResetTime "15:00"     # fires at 15:05; add -OffsetMinutes N to change the +5
   ```
   arm.ps1 arms the box, verifies the gate read-back, and registers the every-minute poller.
3. Keep the ThinkPad awake through the fire time. The result lands as a Gmail draft to
   shaheen.kiarash@gmail.com and a copy in `outputs/prompting-scheduled/YYYY-MM-DD/`.
4. Cancel anytime: `.\disarm.ps1`.

## Delivery
The poller appends a delivery line so the single run emails/drafts the result to you. n8n has no
verified send credential on the box, so delivery is a **Gmail draft** (via the run's Gmail tool), not
a hard-sent mail. Want true auto-send? Add an SMTP cred to n8n and switch the result webhook to send.

## Files
- `quota-reset-autorun.workflow.json` - the deployed n8n workflow (id `ardWIfcbe5TwkMm8`), secret-free.
- `scripts/arm.ps1` / `disarm.ps1` / `poll-and-run.ps1` - the laptop side.
- `payload-prompt.txt` - paste your prompt here.
- `config/` (gitignored) - token + n8n ids.

## Verified at build (2026-07-13)
- Full box cycle: arm (past fire_at) -> gate `go:true`+prompt -> result -> gate `go:false, consumed:true`.
- Auth: gate without token -> 403; with token -> 200.
- Poller no-ops cleanly on `go:false` (no claude run, no task, no files).
- NOT yet live-fired: the GO branch invoking `claude -p` + draft + result-post (spends quota + drops a
  draft; uses the identical pattern as the 8 scheduler run-*.ps1 wrappers). First real arming proves it.

## Note
One-off by design, NOT a registered numbered automation. A recurring version would route through /new
(registry-first). The poller task is transient: it self-removes after firing once.
