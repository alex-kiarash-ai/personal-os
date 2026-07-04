# LinkedIn Series (Building Alex) — the staging robot that never posts

**Workflow ID:** `v1GbDYganOz9EGpM` · **Runs:** Tuesday + Thursday 08:00 Stockholm · **Nodes:** 9 · **Export in this folder:** workflow.json (2026-06-17 version, latest)

## What it does

Shaheen writes a LinkedIn series called "Building Alex" — episodes about building this very system, posted Tuesdays and Thursdays. Episodes are drafted and reviewed in a Notion Content Library where each has a status. On posting mornings at 08:00, this workflow looks for the **oldest episode marked "Approved"**. If it finds one, it fetches the episode's text from Notion, builds a clean `post.txt` file, drops it into the "Building Alex" folder on Google Drive, and flips the episode's status to "Staged". At 08:30 Shaheen opens the file, copies the text, and posts it on LinkedIn himself. If nothing is Approved, the robot does nothing at all.

## Why it exists

Two reasons. Discipline: a Tue/Thu series lives or dies on cadence, and the robot makes the 08:00 prep step unmissable. Safety: LinkedIn is Shaheen's professional face during a job hunt, so there is a **hard gate** — no automation ever posts to LinkedIn. No LinkedIn API, no browser tricks; the robot's reach ends at a text file in Drive. The status flow (Approved → Staged, set by a human before, posted by a human after) makes it impossible for an unreviewed draft to slip out.

## The steps, node by node

- **Manual Test Trigger** — a test start button.
- **Schedule Tue+Thu 08:00** — the real alarm, posting mornings only.
- **Notion: Find Oldest Approved** — queries the Content Library database (`b7305101-...`) for episodes with status "Approved", oldest first.
- **Pick Episode (or stop)** — plain code: takes the first hit, or ends the run quietly if there's nothing approved (no noise, no empty files).
- **Notion: Get Post Body** — fetches the episode's actual text blocks from the Notion page.
- **Build post.txt** — assembles the post as plain text, exactly as it should appear on LinkedIn (house style: no dashes, real numbers).
- **Text to File** — turns that text into an actual .txt file.
- **Upload to Drive (Building Alex)** — drops the file in the series' Drive folder where Shaheen expects it at 08:30.
- **Notion: Mark Staged** — flips the episode's status so it can't be staged twice.

## Connected to

- **The Content Library (Notion)** — shared with the Content Machine project; episodes enter it via the local `/post-episode` command, humans approve, this robot stages.
- **Morning Brief** — flags posting-slot mornings.
- **The `/post-publish` command** — the local twin for on-demand staging; same hard gate. Project doc: `docs/projects/12-linkedin-series.md`.
