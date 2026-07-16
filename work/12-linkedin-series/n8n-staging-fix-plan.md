# n8n "LinkedIn Series (Building Alex) - staging" - Fix Plan

> **OUTCOME (2026-07-16):** Fixes 1, 2, 4, 5, 6 SHIPPED to workflow v1GbDYganOz9EGpM (now 15 nodes, active). Fix 3 (image) DROPPED by decision, images are manual and the workflow stages text only. Proven by two dummy runs (a dashed post is blocked before Drive; a clean post stages with bullets preserved, a per-episode folder, the Drive link written back, and read-back verification). This document is the original plan, kept for reference.

Workflow ID: v1GbDYganOz9EGpM. Six fixes against the spec in work/12-linkedin-series/CLAUDE.md.
Order below = build order. Fix 1 is the safety net, do it first. Fix 6 belongs in the same Code node as Fix 1, build them together.

---

## Fix 1: The dash scan (HARD RULE 2)

**Where:** Inside the existing "Build post.txt" Code node, right after `post_text` is built.

**What it does:** Scans the final text for em-dash and en-dash. If found, the run FAILS. A dashed post must never reach Drive.

**Code to add:**

```javascript
// HARD RULE 2: no em/en dashes ever. Fail the run, do not stage.
const dashMatch = post_text.match(/[\u2014\u2013]/);
if (dashMatch) {
  const idx = post_text.indexOf(dashMatch[0]);
  const around = post_text.substring(Math.max(0, idx - 40), idx + 40);
  throw new Error('DASH FOUND in post body near: "...' + around + '...". Fix the text in Notion, then re-run.');
}
```

**Important:** scan for \u2014 (em) and \u2013 (en) only. NOT the plain hyphen "-". Hyphens are legal (hashtags, file names, normal words).

**Why fail instead of auto-fix:** the robot must never rewrite approved text. A human approved those exact words. If they are wrong, a human fixes them in Notion.

---

## Fix 2: Episode folder per post

**Where:** New Google Drive node ("Create Folder" operation) between "Build post.txt" and "Text to File".

**What it does:** Creates a folder `episode-NN-slug` inside the "Building Alex" folder (parent 17Ljz_3g5eqYdnTS-yB79q--t266tWW4O). Passes the new folder ID forward.

**Then:** Change "Upload to Drive (Building Alex)" to use `{{ that folder ID }}` as the target instead of the flat parent.

**Note:** the slug already exists in "Build post.txt" output. Reuse it: folder name = filename minus ".txt".

---

## Fix 3: The approved image

**Where:** After Fix 2's folder exists.

**Problem to solve first:** the workflow has no way to know WHICH image belongs to the episode. Decide one convention:

- **Option A (recommended):** add a "Drive Image ID" text property to the Content Library row. Shaheen pastes the file ID of the approved image when he approves. n8n reads it in "Notion: Find Oldest Approved" and a new Drive "Copy File" node copies it into the episode folder.
- **Option B:** image file in the row's page body as an embed. Harder to parse, breaks easily. Avoid.

**Guard:** if the property is empty, do NOT fail the run. Stage the text, and append a line to the run log / Notion row: "no image attached". Text without image is postable; a blocked run at 08:00 is worse.

---

## Fix 4: Drive link written back to Notion

**Where:** In the existing "Notion: Mark Staged" node.

**What it does:** The Drive upload node already returns the file metadata. Add the link to the PATCH body so the row gets Status=Staged AND the link in one call.

**Body becomes:**

```json
{
  "properties": {
    "Status": { "select": { "name": "Staged" } },
    "Drive Link": { "url": "https://drive.google.com/drive/folders/{{ episode folder ID }}" }
  }
}
```

**Prerequisite:** add a "Drive Link" URL property to the Content Library database (one-time, manual, in Notion).

Link the FOLDER, not the file. At 08:30 Shaheen opens one link and everything for that episode is there: text + image.

---

## Fix 5: Read-back verification (verify-after-write)

**Where:** Two new nodes at the end, after "Notion: Mark Staged".

**Node A - verify Drive:** Google Drive "Download" (or files.get) on the uploaded post.txt. Compare the downloaded text to `post_text` from "Build post.txt". Mismatch or missing file = throw.

**Node B - verify Notion:** GET the page, check Status is actually "Staged" and the Drive Link is set. Not "Staged" = throw.

**Why:** your own standing order. "It returned 200" is not verification. Today the workflow trusts every response. A silent Drive failure means Shaheen opens an empty folder at 08:30 on a posting morning.

---

## Fix 6: Text fidelity in "Build post.txt" (staged file must equal approved text)

**Where:** Same Code node as Fix 1.

**Problem 1 - bullets and numbering die.** The script reads only `rich_text` and ignores the block type. A `bulleted_list_item` loses its bullet, a `numbered_list_item` loses its number. The staged file does not match what Shaheen approved in Notion. Fix: prefix by block type.

```javascript
let num = 0;
for (const b of blocks) {
  const t = b.type;
  const node = b[t] || {};
  const rt = node.rich_text;
  const text = Array.isArray(rt) ? rt.map(x => x.plain_text).join('') : '';
  if (t === 'bulleted_list_item') { lines.push('- ' + text); num = 0; }
  else if (t === 'numbered_list_item') { num += 1; lines.push(num + '. ' + text); }
  else { lines.push(text); num = 0; }
}
```

**Problem 2 - silent truncation past 100 blocks.** "Notion: Get Post Body" fetches `page_size=100` and never follows `next_cursor`. A long post gets cut with no error. Posts are short today, so this is a guard, not a bug fix. Cheapest safe form: in the Code node, if `$input.first().json.has_more === true`, throw ("Post longer than 100 blocks, pagination not implemented, refusing to stage a partial post"). Failing loud beats staging half a post.

**Note:** this is fidelity, not writing quality. No script in this workflow can improve the writing, because every script runs after the human approved the text. These fixes only guarantee the staged bytes equal the approved bytes.

---

## One more thing (not a node, a habit)

The README in the n8n folder says "Build post.txt" applies "house style: no dashes, real numbers". It does not, and until Fix 1 ships, that sentence is false documentation. After Fix 1, it becomes true for dashes. Update the README when the fixes land, same Change Propagation rule as everywhere else.

## What NOT to add

No AI nodes in this workflow. Quality is decided upstream in /post-episode + human review. This robot stays dumb on purpose: it moves approved bytes and verifies they arrived. That separation is the safety story of the whole series.
