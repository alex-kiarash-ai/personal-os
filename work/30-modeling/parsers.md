# Parser registry - one entry per sender domain

The radar parses EVERY mail under `label:modeling/castings` against this registry. Rules are deterministically described; the extraction call is a reasoning call (claude-sonnet-4-6, NO voice block) **constrained by the schema contract below** (Claude structured outputs, schema-grammar-constrained JSON, per growth-plan v2 finding 13: malformed output eliminated by construction, only real content drift remains).

## The schema contract (every parsed brief, every sender)
```json
{
  "title":      "string, required",
  "apply_url":  "string (url), required",
  "location":   "string|null",
  "gender_req": "string|null (male / female / any / unstated)",
  "comp":       "string|null (verbatim compensation text: amount, TFP, unpaid, unstated)",
  "deadline":   "string|null (ISO date if stated)",
  "sender":     "string, required (registry key below)"
}
```
Required fields = `title` + `apply_url` + `sender`. A mail whose parse cannot produce the required fields goes to the digest's **UNPARSED section** raw (sender, subject, first 200 chars, link), never dropped, and bumps that sender's unparsed counter in metrics.jsonl (>=3 in 7 days from one sender = parse-drift RED + a named fix task).

## Scam filter (deterministic, runs BEFORE scoring - v2 addition)
Flags, any hit -> the brief lands in the digest's **SCAM-SUSPECT band** (shown, marked, never auto-discarded, never drafted-to without Shaheen's explicit say):
- Upfront/registration/portfolio fee of any kind ("registration fee", "portfolio package", "photoshoot fee required", "admin cost")
- "Guaranteed work" / "guaranteed bookings" / guaranteed income claims
- Pay-to-be-seen mechanics (pay for "premium visibility" pitched inside a brief, not by the platform)
- Fake-scout patterns (2025 twist, Model Alliance canon): unsolicited "scout" DM/mail claiming an agency wants to sign, pushing to move to WhatsApp/Telegram fast, asking for personal documents or money. Response ritual: verify the agency independently (own domain, published roster, callback via the public number), never through the contact the mail provides.
- Wire-money / cheque-overpayment mechanics anywhere in the thread.

## Sender entries (6 at launch; few-shot examples pasted from REAL mails during calibration week)

### 1. modelmanagement.com (ModelManagement)
- Sender match: `from:*@modelmanagement.com` (arrives via the F2 fallback filter - legacy account, old address)
- Subject patterns: casting alert / saved-search digest subjects (capture real ones in week 1)
- Extraction: title from the casting headline; apply_url = the casting deep link (strip tracking params); location + gender + comp from the brief body table.
- Few-shot: `[CALIBRATION-SLOT - paste the first real alert here verbatim, then the extracted JSON]`

### 2. stagepool.se / stagepool.com (StagePool)
- Sender match: `from:*@stagepool.*`
- Notes: Swedish-language mails expected; comp often "arvode" lines; TFP marked as "obetalt/mot bilder".
- Few-shot: `[CALIBRATION-SLOT]`

### 3. acasting.se (ACASTING)
- Sender match: `from:*@acasting.se`
- Few-shot: `[CALIBRATION-SLOT]`

### 4. statist.se (Statist och Modell)
- Sender match: `from:*@statist.se`
- Notes: statist (extra) briefs flow in too; the rubric scores them down unless paid + low-effort.
- Few-shot: `[CALIBRATION-SLOT]`

### 5. jooble.org / jooble.se (Jooble alerts)
- Sender match: `from:*@jooble.*`
- Notes: job-board digest format, multiple items per mail: parse EACH item as its own brief ("modell Stockholm" + "harmodell Stockholm" alerts, the hair-lane B2 play).
- Few-shot: `[CALIBRATION-SLOT]`

### 6. starnow.com (StarNow)
- Sender match: `from:*@starnow.*`
- Notes: worldwide digest; remote/travel briefs lane; watch for the free-tier application wall.
- Few-shot: `[CALIBRATION-SLOT]`

## Maintenance
New sender under the label = new entry here (and possibly an F-row in `mailbox.md`) the same week it appears; Phase 3 marketplaces (Influee/Collabstr/Twirl) get entries when their notification mails arrive. This file is reviewed whenever the weekly run reports a parse-drift RED.
