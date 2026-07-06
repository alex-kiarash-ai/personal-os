# WhatsApp Harvest - Phase 2 Runbook (backup pipeline, no UI)

Replaces the fragile screen-scrape (phase 1) with a read of the actual WhatsApp database from an encrypted iPhone backup. Decided 2026-06-14 after phase-1 screen automation proved unreliable on the WinUI WhatsApp build (see [[projects/error-log]]).

## Method (chosen, Windows-friendly)
Apple Devices app -> **encrypted local backup** -> `wtsexporter` (whatsapp-chat-exporter) parses the WhatsApp DB to text. Avoids `libimobiledevice` pairing pain on Windows. WhatsApp data is ONLY in **encrypted** backups, so encryption must be ON.

## Prep DONE 2026-06-14 (no phone needed)
- Disk: **375 GB free** on C: (need ~100 GB for a full backup). OK.
- `whatsapp-chat-exporter` 0.13.0 installed (user scope). Binary: `C:\Users\Thinkpad\AppData\Roaming\Python\Python312\Scripts\wtsexporter.exe` (NOT on PATH; call by full path or add to PATH).
- `ffmpeg` + `whisper` already present -> local voice-note transcription is POSSIBLE if Shaheen opts in (default is still text-only / ignore voice).

## Weekend steps (need Shaheen + iPhone)
1. **Install Apple Devices app** (Microsoft Store) or iTunes - provides the USB driver + backup UI. `winget install -e --id 9NP83LWLPZ9K` (Store id) or via Store app.
2. **Plug iPhone via USB, tap Trust**, enter phone passcode.
3. In Apple Devices: turn ON **Encrypt local backup**, set a password (see password note below), **Back Up Now**. Wait for it to finish (tens of GB).
4. **Find the backup folder** (Apple Devices app): `%USERPROFILE%\Apple\MobileSync\Backup\<UDID>` (older iTunes: `%APPDATA%\Apple Computer\MobileSync\Backup\<UDID>`).
5. **Extract, TEXT ONLY:**
   `wtsexporter -i -b "<backup folder>" --txt --no-html -o "outputs\whatsapp-harvest\phase2\<date>"`
   - prompts for the backup password to decrypt.
   - `--include <numbers>` to limit to key people, or full run for all history.
   - **NO MEDIA (hard rule):** do not extract/keep pictures/videos. If the tool copies a media folder, delete it after; keep only the text export.
6. **Ingest** per the phase-1 rules: Shaheen's lines -> soul.md "My Words" per language register (EN/AR/SV), date-stamped; friends -> vault/people/ minimal context + last-contact; unanswered >48h -> Morning Brief flags; harvest report + review queue in status.md.
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
