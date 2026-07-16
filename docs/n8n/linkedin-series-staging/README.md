# LinkedIn Series (Building Alex) - the staging robot that never posts

**Workflow ID:** `v1GbDYganOz9EGpM` · **Runs:** scheduled (Shaheen posts manually) · **Nodes:** 15 · **Export in this folder:** workflow.json (2026-07-16 version, latest)

## What it does

Shaheen writes a LinkedIn series called "Building Alex" - episodes about building this very system. Episodes are drafted and reviewed in a Notion Content Library where each has a status. On a scheduled run this workflow looks for the **oldest episode marked "Approved"** (Source "Building Alex series", Platform LinkedIn). If it finds one, it fetches the episode's text from Notion, builds a clean text file, creates a dedicated Drive folder for that episode, drops the file inside, flips the row to "Staged", writes the folder link back onto the row, and then verifies both writes actually landed. Shaheen opens the folder link, adds his own image, copies the text, and posts on LinkedIn himself. If nothing is Approved, the robot does nothing at all.

**Images are manual.** The workflow stages TEXT ONLY. Shaheen creates and adds every image to the episode folder himself. There is no image node anywhere in this workflow.

## Why it exists

Two reasons. Discipline: the series lives or dies on cadence, and the robot makes the prep step unmissable. Safety: LinkedIn is Shaheen's professional face during a job hunt, so there is a **hard gate** - no automation ever posts to LinkedIn. No LinkedIn API, no browser tricks; the robot's reach ends at a text file in Drive. The status flow (Approved to Staged, set by a human before, posted by a human after) makes it impossible for an unreviewed draft to slip out.

## The quality gates (added 2026-07-16)

This robot stays dumb on purpose: it moves approved bytes and proves they arrived. No AI nodes; writing quality is decided upstream in `/post-episode` plus human review. The gates only guarantee the staged bytes equal the approved bytes:

- **Dash scan (real):** the build step scans the final text for em-dashes and en-dashes and FAILS the run if it finds one. A human approved those exact words; if they are wrong, a human fixes them in Notion. The robot never rewrites approved text. (Plain hyphens are legal.)
- **Text fidelity:** bulleted and numbered list items keep their `- ` and `N. ` markers, so the staged file matches what Shaheen approved. If a post ever exceeds 100 Notion blocks (pagination not implemented), the run FAILS loud instead of staging a truncated post.
- **Read-back verification:** after staging, the workflow downloads the file back and compares it to the text it built, and re-reads the Notion row to confirm Status is "Staged" and the Drive Link is set. A mismatch throws. "It returned 200" is not verification.

## The steps, node by node

- **Manual Test Trigger** - a test start button.
- **Schedule** - the scheduled alarm.
- **Notion: Find Oldest Approved** - queries the Content Library for the oldest Approved "Building Alex series" LinkedIn row.
- **Pick Episode (or stop)** - takes the first hit, or ends the run quietly if nothing is approved.
- **Notion: Get Post Body** - fetches the episode's text blocks from the Notion page.
- **Build post.txt** - assembles the post as plain text, preserving bullet and number markers, then runs the dash scan and the block-count guard. This is the safety net; a dashed or truncated post dies here, before anything reaches Drive.
- **Create Folder** - creates the episode's own folder (`episode-slug`) inside the Building Alex Drive folder.
- **Prep for File** - carries the text, filename, and new folder id forward (the folder-create step replaces the item, so this restores what the later steps need).
- **Text to File** - turns the text into an actual file.
- **Upload to Drive (Building Alex)** - drops the file into the episode folder.
- **Notion: Mark Staged** - flips the row to Staged AND writes the Drive folder link in one call.
- **Verify Drive Get / Check Drive** - downloads the staged file and confirms it matches the built text.
- **Verify Notion Get / Check Notion** - re-reads the row and confirms Status = Staged and Drive Link set.

## Connected to

- **The Content Library (Notion)** - shared with the Content Machine project; episodes enter it via the local `/post-episode` command, humans approve, this robot stages. Property "Drive Link" (URL) added 2026-07-16 for the folder link.
- **Morning Brief** - flags posting mornings.
- **The `/post-publish` command** - the local twin for on-demand staging; same hard gate. Project doc: `docs/projects/12-linkedin-series.md`.
