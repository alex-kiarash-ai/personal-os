# 05 - Personal CRM

## What it actually does
Every Monday at 08:30 it syncs a Notion contacts database from the vault's people pages plus Gmail and Calendar activity, scores each relationship's warmth (when did we last actually talk?), and produces the Monday follow-up list: who's going cold, who's waiting on a reply, who deserves a check-in. For the follow-ups it drafts messages in Shaheen's voice - but behind a hard gate: drafts only, staged in Gmail, nothing ever sends itself.

**Upgraded 2026-07-10 (six tracks):** the warmth score is now computed from real numbers (days since last contact + message count) with an explainable one-line basis instead of a fresh guess each week; a cadence engine sets each contact's follow-up window by status (Active 14d, Warm 30d, live job-hunt 7d); Email Triage now keeps Last Contact and Email fresh on every sweep, so Monday is a scoring pass, not a from-scratch dig; the "needs your call" list is actionable from the phone (send / close / snooze / draft via the Alex HQ notes card); drafts refresh in place instead of piling up unsent; and a missed Monday now trips a staleness flag in the brief instead of going silent.

## Why it exists
A career pivot makes the network the single most valuable asset Shaheen owns, and networks die of silence, not conflict. The CRM turns "I should really write to..." from a guilty feeling into a Monday list with drafts already written. The hard no-send gate exists because relationships are the one place where an automation mistake is expensive.

## Works together with
- **The vault's people pages** - its source of truth; the People Intake Protocol feeds it every new name.
- **[Morning Brief](02-morning-brief.md)** - Monday's brief carries the follow-up list.
- **[Email Triage](07-email-triage.md)** - shares the voice-drafting machinery and sender context, and now keeps Last Contact + Email fresh on every sweep.
- **[Meeting Intel](06-meeting-intel.md)** - meetings update the same relationship records.
- **[Interview Copilot](21-interview-copilot.md)** - a live interview tells the CRM to tighten that recruiter's follow-up cadence to weekly.
- **Alex HQ** - the notes card is how the Monday follow-up list gets actioned from the phone.
