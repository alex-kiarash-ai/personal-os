# Meeting Intel

## Type
Automation (on-demand, two modes)

## Purpose
Turns meetings into leverage on both ends. **Pre-meeting:** given a calendar event or "prep me for my 2pm", it pulls each attendee from the Personal CRM, searches Notion for relevant docs, does light web research on the attendees, and produces a one-page prep dossier. **Post-meeting:** the user drops any file into work/06-meeting-intel/inbox/ (text, markdown, PDF, VTT, audio, or image) or pastes text; it normalizes that into a transcript (transcribing audio with Whisper), extracts decisions / action items / follow-ups, writes structured meeting notes to Notion + vault, pushes action items onto the sprint board, updates the relevant CRM contacts, and stages a follow-up email draft in Shaheen's voice.

## Entry Points
- On-demand only. Not scheduled.
- `/meeting-intel prep "<event or 2pm>"` — pre-meeting dossier.
- `/meeting-intel process [file]` — post-meeting. With no arg, processes everything in inbox/.
- Natural language: "prep me for my 2pm", "process my meeting notes".

## Tools Used
- Google Calendar MCP: list_events / get_event (resolve the meeting + attendees).
- Notion MCP: notion-search (relevant docs + CRM lookup), notion-create-pages (Meeting Notes row + sprint tasks), notion-update-page (CRM rows, status).
- Gmail MCP: gmail_create_draft (follow-up draft). NEVER Chrome for Gmail.
- Chrome: web research on attendees ONLY (background, public info). Never for Gmail/Calendar/Notion.
- Whisper (openai-whisper, base model): transcribe audio. Auto-installed on first audio file (see Audio below).
- Python: parse VTT/transcripts, light text cleanup. Read tool: PDFs and images (Read renders both).
- Sub-agents (optional): attendee web research in parallel for multi-person meetings.

## Audio Transcription (Whisper)
On the FIRST audio file (.mp3 / .m4a / .wav):
1. Check if installed: `python -c "import whisper"`.
2. If missing: `pip install openai-whisper` and let it pull the `base` model on first transcribe. Whisper needs ffmpeg; if `ffmpeg` is absent, install it (winget `Gyan.FFmpeg` on Windows) — note this in the run output.
3. Tell the user verbatim: "Installed Whisper for voice transcription. Using the base model. If you need better accuracy for longer meetings, you can upgrade to small later."
4. Transcribe: `whisper <file> --model base --output_format txt --output_dir <tmp>`, then process the .txt.
On later runs, skip install; just transcribe. Timebox long files; if a transcription stalls, report it rather than hanging.

## Input Format Handling
| Format | How it's read |
|--------|---------------|
| .txt .md | Read directly |
| .vtt | Strip WebVTT timestamps/cues with Python, keep speaker text |
| .pdf | Read tool (pages param) |
| .jpg .png | Read tool (vision — whiteboard photos, screenshots) |
| .mp3 .m4a .wav | Whisper → .txt |
| pasted text | Process directly, no file |

## Notion Integration
**Meeting Notes** database under the Personal OS parent page (ID in vault/projects/notion-parent-id.md).
Columns:
- **Title** (title)
- **Date** (date)
- **Attendees** (text)
- **Action Items** (number — count of items extracted)
- **Status** (select: Prep, Complete, Follow-up Sent)

Views:
- **Recent** (table, sort by Date desc)
- **Pending Follow-ups** (table, filter Status != "Follow-up Sent")

Each row's page **content** holds the full structured notes: Summary, Decisions, Action Items (with owners), Follow-ups, raw transcript link. Properties are for scanning; the body is for reading.

**Cross-DB writes (IDs in the respective status.md):**
- Sprint board (Progress Tracker, data_source 0c239613-7e4e-410c-b064-266fa31a9da4): one task row per action item assigned to Shaheen (Status from its state, Project inferred, Notes = source meeting).
- Personal CRM (data_source 746bc5bf-8ab3-4e34-911d-00b9d180e350): bump Last Contact to the meeting date, set a Follow-Up Date, append context to Notes — for attendees already in the CRM.

## Vault Structure
- **Tier 1:** vault/projects/meeting-intel/status.md — DB IDs, last run, recent meetings, dossiers/notes index.
- **Tier 2:** vault/meetings/YYYY-MM-DD-<slug>.md — one structured note per meeting (THIS is the knowledge). Pre-meeting dossiers: vault/meetings/dossiers/YYYY-MM-DD-<slug>.md.

## Vault Reads
- soul.md (follow-up email voice).
- vault/people/ (attendee context — source of truth, fed by CRM + Morning Brief).
- vault/projects/personal-crm/status.md (CRM DB IDs + contact page map).
- vault/projects/sprint-tracker/status.md (sprint DB IDs to push action items).
- vault/business/ (company context for attendees).
- vault/projects/*/status.md (project context for action-item routing).

## Vault Writes
- vault/meetings/ structured note (+ dossier for prep mode).
- vault/people/ pages for every attendee (new or updated).
- vault/business/ for new companies.
- status.md refresh, vault/index.md (new pages), vault/log.md (every run).

## Connections
- **Fed by:** Calendar (events/attendees), Personal CRM (contact context), inbox files.
- **Feeds into:** Personal CRM (last-contact + follow-up updates), Sprint Tracker (action items become board tasks), vault/meetings/ (consumed by Morning Brief + future automations), CRM follow-up drafts.

## Post-Run (mandatory)
1. vault/people/ pages for new attendees.
2. vault/business/ pages for new companies.
3. [[wiki links]] across meeting note, people, projects, CRM.
4. Notion: Meeting Notes row created; action items on sprint board; CRM rows updated.
5. vault/index.md updated.
6. vault/log.md updated.
7. Sprint board: this automation marked Done on first build (2026-06-11).
8. Move processed inbox files to work/06-meeting-intel/processed/.

## Draft Gate (inherited from Personal CRM)
Follow-up drafts obey the CRM gate: real email on file, recipient not personal/family, not a do-not-contact/sensitive contact, draft only (never auto-send). A meeting with an off-limits attendee still gets notes + action items; it just doesn't get an auto-drafted email.

## Implementation Notes (as built, 2026-06-11)
- Scaffolded with inbox/ + processed/. Meeting Notes DB created under Personal OS parent; IDs in status.md.
- Whisper is NOT installed at build (no audio yet). First audio file triggers the install + base-model download + the user message above. ffmpeg dependency checked at that point.
- No live meeting processed at build (on-demand; first real file/dossier starts the history). vault/meetings/ created empty with a .gitkeep.
- Reuses the CRM draft gate rather than re-inventing one.
