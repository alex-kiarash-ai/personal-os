# WhatsApp Harvest (voice corpus + people sync)

## Type
Automation (local, scheduled daily 02:30, while Shaheen sleeps). Phase 1 of the WhatsApp integration agreed 2026-06-12.

## Why 02:30 (Shaheen's usage-based scheduling, 2026-06-12)
Schedule by usage, not by clock convenience: the run fires when Shaheen's interactive usage is guaranteed zero, so it never competes with his day and gets a fresh 5-hour window. Combined with checkpoint pushes (below), every token consumed buys data that is already in the db.

## Purpose
Read Shaheen's WhatsApp through the OFFICIAL desktop client (linked device, zero ban risk) and:
1. Harvest HIS messages only into soul.md "My Words" (per-language registers: English, Arabic, Swedish).
2. Create/update vault/people/ pages for friends: relationship context, life events worth remembering. NEVER transcripts of friends' private words.
3. Flag unanswered personal messages older than 48h into the Morning Brief.

## Hard rules
- **Budget rule (Shaheen, 2026-06-12): at ~80% of usage limit, stop everything except importing already-captured WhatsApp data.** Operationalized as: (1) CHECKPOINT PUSHES, write each thread's harvest to soul.md/vault immediately after reading it, never batch to the end; (2) on any usage-limit signal, abort remaining capture and finish only the import of what's already read. No token buys unpushed data.
- **NO MEDIA, EVER (Shaheen, 2026-06-12): text only.** Never save, copy, or export pictures or videos. Run screenshots are working files only and are deleted at the end of every run. This rule binds phase 2 too: the backup extractor must skip all media files.
- **Voice messages: currently IGNORED** (cannot be read from screen). Phase 2 may transcribe locally via Whisper with immediate audio deletion, but that is an explicit Shaheen decision still to be made, not a default.
- READ ONLY. Never type, click send, or touch a message box. Drafting WhatsApp replies is out of scope for phase 1.
- Friends' message content stays out of the vault except minimal context (one-line "what's going on in their life").
- Shaheen's own lines are the corpus. Harvest phrasing, not secrets: no health, relationship, or third-party-sensitive content into soul.md.

## Harvest report + review queue (Shaheen's loop, 2026-06-12)
After every run, write a report into vault/projects/whatsapp-harvest/status.md under "## Last run":
1. Every conversation read (saved contact or raw number), with the person-check result: **known** (page exists, rich), **thin** (page exists, data gaps), or **new** (no page).
2. All thin/new names go to "## Review queue" with what was observed (register, language, last contact).
3. Shaheen annotates each queued name with an adjective or note ("close friend", "cousin", "keep distant"); the next session applies those as tags and page context, then clears the queue entry.
Never invent relationship tags. The tag comes from Shaheen's note, observation fills the rest.

## Method (v1, screen capture)
1. Find WhatsApp process (ProcessName match 'WhatsApp'), bring window forward maximized (SetForegroundWindow + ShowWindowAsync 3).
2. Screenshot primary screen, crop chat-list column, read thread names + timestamps.
3. For each of the top 5 active threads: open via Ctrl+F search (SendKeys: name + Enter), screenshot, crop message pane, read.
4. Parse: separate Shaheen's lines (right-aligned) from contacts' lines (left-aligned).
5. Update soul.md corpus (date-stamped), people pages, vault/log.md.
6. Close search with Esc. Leave the app running (it must stay open for sync).

## Known fragilities
- Screen capture reads only visible messages; no deep scroll in v1 (phase 2 backup pipeline covers history).
- WhatsApp window must not be minimized to tray-only; the scheduled run starts it via `Start-Process "whatsapp:"` if needed.
- UI language/layout updates can break crops; on failure, log to vault/projects/error-log.md, do not retry blind.

## Phase 2 (planned, weekend)
Nightly iPhone backup to this PC (libimobiledevice idevicebackup2 over Wi-Fi/USB) + wtsexporter extraction of ChatStorage.sqlite = full history, no UI fragility. Needs: backup encryption password (store in vault/projects/whatsapp-harvest/), ~100GB free disk, phone on charger + same Wi-Fi.

## Vault
- Tier 1: vault/projects/whatsapp-harvest/status.md
- People: vault/people/{name}.md per friend
- Soul: soul.md "My Words" section (registers per language)

## Connections
- Feeds into: soul.md (voice), vault/people/ (CRM seeds for /personal-crm Monday runs), /morning-brief (unanswered-message flags).
- Fed by: WhatsApp Desktop (official linked device, synced from iPhone 17 Pro).
