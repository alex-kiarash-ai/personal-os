# WhatsApp Harvest - Phase 2 Runbook (backup pipeline, no UI)

Replaces the fragile screen-scrape (phase 1) with a read of the actual WhatsApp database from an encrypted iPhone backup. Decided 2026-06-14 after phase-1 screen automation proved unreliable on the WinUI WhatsApp build (see [[projects/error-log]]).

## Method (REWRITTEN 2026-09-02, run 2)
Apple Devices app -> **encrypted local backup** -> `scripts/whatsapp-aggregate.py` decrypts and reads the WhatsApp databases directly. Avoids `libimobiledevice` pairing pain. WhatsApp data is ONLY in **encrypted** backups, so encryption must be ON.

**What changed and why.** Run 1 (2026-07-10) drove `wtsexporter -b <backup>`, and two things about that were wrong enough to rewrite this file:

1. **The command printed below until 2026-09-02 was never the one that worked.** It said `--txt --no-html`. `--txt` writes one file per chat, named after the chat, which dies on Windows the moment a group name contains an emoji or a `?`. The run that actually succeeded used single-file JSON. The wrong command sat here for eight weeks, so run 2 was about to rediscover the same bug from scratch.
2. **`wtsexporter` cannot be told to skip media.** Its own help reads `-c, --move-media  Move the media directory to output directory if the flag is set, otherwise copy it`. There is no skip. `ios_media_handler.py` calls `extract_files(domain_like='%net.whatsapp.%')` unfiltered whenever `-b` is passed. That is where run 1's 8.66 GB came from. It was not a misconfiguration; it is what `-b` does.

So the harvest no longer passes `-b`. It extracts exactly the sqlite files it needs, which honours the NO MEDIA hard rule **by construction rather than by cleanup**, and skips a 9 GB write.

Disk need is therefore much smaller than the "~100 GB" this file used to claim: the backup delta (a few GB on an incremental) plus a few hundred MB of databases.

## Prep DONE 2026-06-14 (no phone needed)
- Disk: **375 GB free** on C: (need ~100 GB for a full backup). OK.
- `whatsapp-chat-exporter` 0.13.0 installed (user scope). Binary: `wtsexporter` (installed user-scope by pip; on Linux/macOS that is usually `~/.local/bin/wtsexporter`. If it is not on PATH, call it by full path or add that dir to PATH).
- `ffmpeg` + `whisper` already present. **Shaheen opted IN to voice-note transcription on 2026-09-02**, reversing the old ignore default: transcribe locally, delete each audio file immediately after. Note torch here is CPU-only, so scope and cap it.

## Weekend steps (need Shaheen + iPhone)
1. **Install Apple Devices app** (Microsoft Store) or iTunes - provides the USB driver + backup UI. `winget install -e --id 9NP83LWLPZ9K` (Store id) or via Store app.
2. **Plug iPhone via USB, tap Trust**, enter phone passcode.
3. In Apple Devices: confirm **Encrypt local backup** is ON, then **Back Up Now**. On a machine that has backed this phone up before, this is an INCREMENTAL snapshot into the same UDID folder, so expect 15 to 60 minutes rather than a full transfer. It REPLACES the previous snapshot; there is no versioning.
   **Never untick encryption as a workaround for anything.** Unencrypted iOS backups contain no WhatsApp data at all, so that one click silently wastes the whole session.
4. **Find the backup folder** (Apple Devices app): `%USERPROFILE%\Apple\MobileSync\Backup\<UDID>` (older iTunes: `%APPDATA%\Apple Computer\MobileSync\Backup\<UDID>`).
   Then **verify the snapshot actually landed** before reading anything:
   ```
   python scripts/whatsapp-aggregate.py --verify-backup --backup "<backup folder>"
   ```
   It refuses to continue unless the snapshot is `finished`, encrypted, and fresh. Run 2 existed largely because the backup on disk was 54 days old and nothing in this runbook would have noticed: a stale snapshot parses perfectly and reports a clean harvest.
5. **Extract + aggregate, databases only:**
   ```
   python scripts/whatsapp-aggregate.py --backup "<backup folder>" --out system/whatsapp-chat-stats.json
   ```
   - prompts for the backup password (or reads `WA_BACKUP_PASSWORD`). Never write it to a file.
   - pulls `ChatStorage.sqlite`, `ContactsV2.sqlite`, `CallHistory.sqlite` **and the `-wal`/`-shm` sidecars**. The WAL matters: SQLite keeps uncheckpointed writes there, so without it the newest messages can be missing while the run still looks clean.
   - emits one aggregate row per chat, which is the tiering layer that makes reading every chat affordable.
   - **NO MEDIA (hard rule): satisfied by construction.** Media is never extracted, so there is nothing to delete afterwards.
   - `--verify-backup` runs the preflight alone; `--password-only` tests just the password.
   - fallback only, if the aggregates look wrong: `wtsexporter` still works, but point it at the already-extracted databases with `-d`/`-w` and **never pass `-b`**. Use `-j` single-file JSON, never `--per-chat` or `--txt` (the Windows filename bug), and never `--avoid-encoding-json` (the cp1252 write bug).
6. **Ingest** per the phase-1 rules: Shaheen's lines -> soul.md "My Words" per language register (EN/AR/SV), date-stamped (then run `node scripts/generate-alex.js` for the voice re-sync); friends -> vault/people/ minimal context + `channel: whatsapp` + `last_contact` frontmatter (which #05 syncs to the Notion `Last Contact` + `Channel`, replacing the frozen June dates); unanswered >48h -> Morning Brief flags; harvest report + review queue in status.md. NO message bodies stored.
7. **Cleanup / retention:** delete any extracted media immediately. Decide whether to keep or delete the raw iPhone backup (tens of GB, encrypted) - Shaheen's call.

## Open decisions for Shaheen (ask, allow skip)
1. **Backup password storage.** Spec originally said store it in vault/projects/whatsapp-harvest/. RECOMMEND AGAINST (same rule as the IG password: secrets never in the vault). Keep it in his password manager; he enters it at extract time. Confirm.
2. **Voice notes:** transcribe locally via Whisper (already installed, audio deleted right after) OR ignore (text only). Default = ignore.
3. **Scope:** full history (all chats) or just key people (--include)?
4. **Retention:** delete the raw iPhone backup after extraction, or keep it?

## Notes
- One-time pairing is via USB; later backups can be Wi-Fi once trusted.
- This is read-only on the phone (a backup), zero WhatsApp account risk, no UI fragility.
- `wtsexporter --help` exits non-zero in this build but works; that's cosmetic.
