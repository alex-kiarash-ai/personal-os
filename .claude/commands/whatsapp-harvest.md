# /whatsapp-harvest - Read-Only WhatsApp Voice + People Harvest

Read `work/11-whatsapp-harvest/CLAUDE.md` first. It is the spec; its Hard Rules override everything here.

> **METHOD CHANGED 2026-07-14, this command was not updated until 2026-07-28 (review F-4).** The Phase 1
> WhatsApp Desktop screen-scrape (daily 02:30, SetForegroundWindow + screenshots + Ctrl+F) is **RETIRED,
> a proven dead end** on the WinUI build. Its steps used to live here, which meant invoking this command
> sent an agent down a path the registry explicitly labels dead, with nothing to fall back to. The live
> method is **Phase 2: an on-demand encrypted iPhone-backup harvest, proven 2026-07-10.** The
> `PersonalOS-whatsapp-harvest` task is Disabled in Task Scheduler by design. There is no schedule; this
> is ON-DEMAND and needs Shaheen plus his phone.

## Flow (Phase 2, ON-DEMAND, needs Shaheen + iPhone on USB)

Full runbook with exact commands: `work/11-whatsapp-harvest/phase2-runbook.md`. Read it before running.

1. **Confirm prerequisites.** `wtsexporter` is installed at
   `C:\Users\Thinkpad\AppData\Roaming\Python\Python312\Scripts\wtsexporter.exe` (NOT on PATH, call by
   full path). Needs ~100GB free. If the Apple Devices app is absent, stop and ask Shaheen to install it.
2. **Backup (Shaheen-side, ask, never assume).** iPhone on USB, Trust + passcode, **Encrypt local backup
   ON** in Apple Devices, Back Up Now. The WhatsApp DB only exists in ENCRYPTED backups. The password
   lives in his password manager, never the vault, and he enters it at extract time.
3. **Locate the backup:** `%USERPROFILE%\Apple\MobileSync\Backup\<UDID>` (older iTunes:
   `%APPDATA%\Apple Computer\MobileSync\Backup\<UDID>`).
4. **Extract, TEXT ONLY:**
   `wtsexporter -i -b "<backup folder>" --txt --no-html -o "outputs\whatsapp-harvest\phase2\<date>"`
   Prompts for the backup password. `--include <numbers>` to scope to key people. **NO MEDIA, EVER
   (hard rule):** if the tool writes a media folder, delete it immediately; keep only the text export.
5. **Harvest, respecting the privacy contract:**
   - Shaheen's lines (right-aligned) → soul.md "My Words", per-language register (English/Arabic/Swedish), date-stamped. Phrasing only; skip health, relationship intimacy, third-party-sensitive content.
   - Friends → vault/people/{name}.md: relationship context, life events, last-contact date. NEVER transcripts of their words.
   - Personal messages unanswered >48h → note in vault/projects/whatsapp-harvest/status.md under "Flags for Morning Brief".
6. **Vault hygiene:** update people pages + index.md for new people, append vault/log.md (`## [date] whatsapp-harvest | summary`), update project status.md (last run, threads read, corpus lines added). Because Shaheen's own lines land in soul.md, **run `node scripts/generate-alex.js` afterwards** so the n8n writer nodes re-sync to the grown corpus.
7. **Cleanup + retention:** delete any extracted media immediately. Ask Shaheen whether to keep or delete the raw iPhone backup (tens of GB, encrypted). Never decide that silently.
8. **Failures:** if extraction fails (wrong password, no WhatsApp DB in the backup, unencrypted backup), log to vault/projects/error-log.md and stop. Do not retry blind and do not fall back to the retired screen-scrape.

## Hard rules (repeated because they matter)
- **Budget rule: CHECKPOINT PUSHES.** Write each thread's harvest to the vault immediately after reading it. On any usage-limit signal, stop capture and finish only the import of what's already read (Shaheen's 80% rule, 2026-06-12).
- **NO MEDIA, EVER.** Text only. Never save pictures or videos. Voice messages are ignored (phase 2 transcription = pending Shaheen decision).
- READ ONLY. This reads a backup, never the live account: no typing, no sending, no marking read, zero ban risk.
- Friends' content stays out of the vault except minimal context.
- Delete every extracted media file at the end of the run. The text export is the only artifact that survives.
- The backup password is Shaheen's to enter. Never write it to the vault, the repo, a log, or a scratch file.
- **After every run:** harvest report into the project status page, every conversation read + person-check (known/thin/new), thin/new names into the Review queue for Shaheen's adjective/note. Tags come from his notes, never from guessing. Apply any answered queue notes from previous runs first.
