# 11 - WhatsApp Harvest (paused)

## What it actually does
When active (currently **paused since 2026-06-18**): at 02:30 while Shaheen sleeps, it reads WhatsApp through the *official desktop client* - screen capture of the real app, read-only, no hacked APIs, zero ban risk. Text only, never media. It harvests two things: Shaheen's own messages (into soul.md's per-language voice registers - his Swedish, English, Arabic, Farsi registers all differ) and context about friends (into their vault people pages - life events, not transcripts). It also flags personal messages left unanswered for 48+ hours to the morning brief.

## Why it exists
The voice corpus is the foundation every draft-writing automation stands on, and nowhere is Shaheen's *real* voice more honest than WhatsApp. The people harvest keeps relationships accurate without manual note-taking. It's paused for a boring reason: the screen-capture approach eats AI tokens too fast, and the budget rule says captured-data quality never justifies burning the month's limit. **Decided 2026-07-10:** Phase 2 (reading from an encrypted iPhone backup instead - cheap, complete, zero ban risk) is committed for this weekend, and it now also fills the CRM's real last-contact dates + channel. A live WhatsApp feed (a read-only WAHA gateway on the server) is built but deliberately switched OFF until Shaheen lands a role, because an always-on unofficial client carries a small-but-real account-ban risk his family ties can't afford mid-hunt.

## Works together with
- **soul.md** - the primary customer: voice registers per language.
- **[Personal CRM](05-personal-crm.md)** and vault people pages - friend context + warmth signals; the harvest writes each contact's channel + real last-contact so the CRM stops guessing WhatsApp recency.
- **[Morning Brief](02-morning-brief.md)** - the 48-hour unanswered flags.
