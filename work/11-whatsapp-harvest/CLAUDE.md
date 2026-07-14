# WhatsApp Harvest (voice corpus + people sync)

## Type
Automation (ON-DEMAND). **Superseded 2026-07-14 (/deep-audit D3):** the daily-02:30 scheduled screen-scrape described below is Phase 1 and is RETIRED (dead end); the live method is Phase 2 - an on-demand encrypted iPhone-backup harvest (proven 2026-07-10). The `PersonalOS-whatsapp-harvest` task is Disabled. The "02:30" / "Method (v1, screen capture)" sections below are kept as history; read status.md for the current state. Phase 1 of the WhatsApp integration agreed 2026-06-12.

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

## Phase 2 (COMMITTED 2026-07-10, this weekend) - the zero-risk feed
Encrypted iPhone backup + wtsexporter text-only extraction of the WhatsApp DB = full history, no UI fragility, ZERO ban risk. Runbook: `phase2-runbook.md`. Needs: backup encryption password (in Shaheen's PASSWORD MANAGER, NOT the vault - corrected 2026-07-10), ~100GB free disk, phone wired. **Feeds the CRM:** the ingest writes `channel: whatsapp` + real `last_contact` to each friend's people-page frontmatter, which #05 syncs to Notion `Last Contact` + `Channel`, replacing the frozen June dates. Shaheen's own lines -> soul.md corpus (then re-run `node scripts/generate-alex.js`).

## Phase 3 (live gateway, DEFERRED - off until post-offer)
Read-only **WAHA Core** gateway on the Hetzner box, webhook -> n8n -> CRM/corpus. Built-ready, switched OFF (~2-5%/yr ban risk unacceptable mid-hunt). Runbook: `waha-gateway-runbook.md`. Research + the full option comparison: [[research/whatsapp-access-2026]].

## Vault
- Tier 1: vault/projects/whatsapp-harvest/status.md
- People: vault/people/{name}.md per friend
- Soul: soul.md "My Words" section (registers per language)

## Connections
- Feeds into: soul.md (voice corpus - Shaheen's own lines), vault/people/ + the **Personal CRM** (`channel` + `last_contact` frontmatter -> #05 sync to Notion, since 2026-07-10), /morning-brief (unanswered-message flags).
- Fed by: an encrypted iPhone backup (Phase 2, zero-risk, the committed path); later a read-only WAHA gateway (Phase 3, deferred). Phase 1 WhatsApp Desktop screen-scrape is retired.
