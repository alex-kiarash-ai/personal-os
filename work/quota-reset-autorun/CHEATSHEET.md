# Schedule a Prompt - Cheat Sheet

Run one prompt, once, at a time you pick. Full auto (no clicking). Result lands as a Gmail draft.

## The 3 steps

**1. Write your prompt.**
Open this file and replace everything in it with your prompt:
```
work\quota-reset-autorun\payload-prompt.txt
```
Write it like you'd say it to Alex. Don't add "email me the result" - that's automatic.

**2. Open PowerShell in the scripts folder.**
```powershell
cd C:\Users\Thinkpad\Desktop\personal-os\work\quota-reset-autorun\scripts
```

**3. Arm it with a time.**
```powershell
.\arm.ps1 -ResetTime "15:00"
```
- 24-hour time. If that time already passed today, it assumes tomorrow.
- It fires **5 minutes after** the time you give (`"15:00"` runs at 15:05). That buffer is for the "5 min after my quota resets" case.
- Want it at the **exact** time? Add `-OffsetMinutes 0`:
  ```powershell
  .\arm.ps1 -ResetTime "15:00" -OffsetMinutes 0
  ```

**You're armed when you see these 3 lines:**
- `Armed. reset=... fire_at=...`
- `Gate reads back: go=False ...`  (False is correct until fire time)
- `Poller registered: fires ONCE at ...`

## Get the result
- A **Gmail draft** to yourself with the answer.
- A saved copy in `outputs\prompting-scheduled\YYYY-MM-DD\`.

## Cancel it
```powershell
.\disarm.ps1
```

## Remember
- **Keep the laptop awake** through fire time. If it's asleep, it runs the moment it wakes (up to 12h).
- **One at a time.** Arming a new prompt replaces the old one.
- **It spends your normal Claude usage** when it runs. Only truly works if your quota is available at fire time.
- **Fires once, then stops.** For something that repeats (every day / week), ask Alex - that's a different setup.

## How it works (30-second version)
Your Hetzner server holds the go-time (it's the alarm clock). Your laptop runs the prompt (it's the worker), because Claude with your files only lives on the laptop. At fire time the laptop wakes once, runs the prompt, emails you, and shuts the task off. That's why the laptop has to be awake.

Full details + troubleshooting: `README.md` in this folder. Root-cause history: `vault/projects/error-log.md`.
