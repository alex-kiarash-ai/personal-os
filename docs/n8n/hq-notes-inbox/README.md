# Alex HQ — Notes Inbox: the two-way lane

**Workflow ID:** `701jclfh3q4d8l1q` · **Runs:** always on — four doorbells under one roof (all token-gated) · **Nodes:** 18 · **Export in this folder:** workflow.json (2026-07-02 version, latest)

## What it does

This is how Shaheen talks **to** Alex when Alex isn't running. On the HQ dashboard there's a card: "Drop a note to Alex" — type a thought or hold to record a voice memo, from phone or PC, any time. This workflow receives it, stores it in an `alex_inbox` table on the server (voice audio saved to disk), and holds it until the next time Alex is awake — the 08:00 morning brief, the email triage rounds, any `/alex-hq` or `/status` run. Alex then collects the notes, transcribes voice with local Whisper, files each one into the vault where it belongs, and marks it done here. It's an **async inbox, not a chat** — nothing answers in real time, by design.

## Why it exists

Thoughts don't schedule themselves around Alex's sessions. Before this, an idea at 23:00 meant a note-to-self that might survive until morning. Now the capture layer is always on and the filing is guaranteed: every note ends up in the vault through the same protocols as everything else. Voice mattered because typing on a phone kills half the thoughts; local Whisper transcription means the audio never leaves Shaheen's machines.

## The steps, node by node (four doors, four mini-flows)

**Door 1 — typed note (`/webhook/alex-note`)**
- **Note Webhook** — receives the typed note.
- **Normalize Note** — tidies it: timestamp, source, trims empties.
- **Insert Note Row** — files it in the `alex_inbox` table as "new".
- **Respond Note OK** — receipt back to the app.

**Door 2 — voice note (`/webhook/alex-note-voice`)**
- **Voice Webhook** — receives the audio recording.
- **Prep Audio File** — names it and prepares it for storage.
- **Write Audio To Disk** — saves the audio file on the server (`/opt/alex-inbox-audio/`), waiting for pickup.
- **Prep Voice Row / Insert Voice Row** — files an inbox row pointing at that audio file.
- **Respond Voice OK** — receipt back to the app.

**Door 3 — Alex collects (`/webhook/alex-inbox`)**
- **Inbox Webhook** — Alex knocks: "anything new?"
- **Get Inbox Rows / Shape Inbox** — fetches the unfiled rows and formats them.
- **Respond Inbox** — hands Alex the list (voice rows include where to fetch the audio).

**Door 4 — Alex marks done (`/webhook/alex-inbox-mark`)**
- **Mark Webhook** — Alex reports back: "note 12 filed to vault/me/goals, note 13 to projects/...".
- **Split Marks / Update Row Filed** — updates each row from "new" to "filed" with the destination and final text.
- **Respond Mark OK** — receipt; after a voice note is marked, its audio is deleted on both sides.

## Connected to

- **The Alex HQ app** (https://hq.shaheenkiarash.com) — the note card is Door 1 and 2's front end.
- **Morning Brief / Email Triage / /alex-hq / /status** — the touchpoints where Alex knocks on Door 3 and files into the vault.
- **The vault** — final destination of every note; the inbox is a waiting room, never storage. Project doc: `docs/projects/16-alex-hq.md`.
