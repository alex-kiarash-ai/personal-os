# /whatsapp-harvest - Read-Only WhatsApp Voice + People Harvest

Read `work/11-whatsapp-harvest/CLAUDE.md` first. It is the spec; its Hard Rules override everything here.

## Flow (daily 02:30 while Shaheen sleeps, also runnable on demand)

1. **Client up:** find a WhatsApp process with a window; if none, `Start-Process "whatsapp:"` and wait 15s.
2. **Capture chat list:** bring window forward maximized (SetForegroundWindow + ShowWindowAsync 3), screenshot primary screen, read the chat-list column: thread names, timestamps, unread state.
3. **Top threads:** for up to 5 most recent personal threads (skip groups unless active today): open via Ctrl+F, type name, Enter; screenshot; crop message pane; read. Esc to close search.
4. **Harvest, respecting the privacy contract:**
   - Shaheen's lines (right-aligned) → soul.md "My Words", per-language register (English/Arabic/Swedish), date-stamped. Phrasing only; skip health, relationship intimacy, third-party-sensitive content.
   - Friends → vault/people/{name}.md: relationship context, life events, last-contact date. NEVER transcripts of their words.
   - Personal messages unanswered >48h → note in vault/projects/whatsapp-harvest/status.md under "Flags for Morning Brief".
5. **Vault hygiene:** update people pages + index.md for new people, append vault/log.md (`## [date] whatsapp-harvest | summary`), update project status.md (last run, threads read, corpus lines added).
6. **Failures:** if the window/crops misbehave, log to vault/projects/error-log.md and stop. Do not retry blind, do not click around the UI.

## Hard rules (repeated because they matter)
- **Budget rule: CHECKPOINT PUSHES.** Write each thread's harvest to the vault immediately after reading it. On any usage-limit signal, stop capture and finish only the import of what's already read (Shaheen's 80% rule, 2026-06-12).
- **NO MEDIA, EVER.** Text only. Never save pictures or videos. Voice messages are ignored (phase 2 transcription = pending Shaheen decision).
- READ ONLY. Never type into a chat, never send, never mark read intentionally.
- Friends' content stays out of the vault except minimal context.
- Delete all screenshot temp files at the end of the run.
- **After every run:** harvest report into the project status page, every conversation read + person-check (known/thin/new), thin/new names into the Review queue for Shaheen's adjective/note. Tags come from his notes, never from guessing. Apply any answered queue notes from previous runs first.
