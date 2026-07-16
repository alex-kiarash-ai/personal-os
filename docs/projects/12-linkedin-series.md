# 12 - LinkedIn Series ("Building Alex")

## What it actually does
Produces and stages a LinkedIn series where Shaheen publicly builds this very system, episode by episode, on an ongoing weekly cadence (one post per week to mid-August 2026, then two or three per week). The `/post-episode` command drafts an episode from real project history - real numbers, real screenshots, hard rules (no dashes, a "never-share" list protecting private details) - into the Notion Content Library. A human review flips it to Approved. On posting mornings, an n8n robot ([documented here](../n8n/linkedin-series-staging/)) stages the oldest approved episode as a text file into its own Drive folder, writes the folder link back onto the row, verifies both writes, and marks it Staged. Images are manual: Shaheen adds his own image to the folder and posts manually at 08:30. Custom diagram artwork follows a locked design system so the series looks like one product.

## Why it exists
The pivot's public proof. A CV says "AI automation engineer"; a twice-weekly series showing an actual agent being built - with costs, failures, and fixes - demonstrates it. It also forces honest documentation: an episode can't ship unless the build really happened. The absolute no-auto-posting gate exists because this is Shaheen's professional face during a job hunt; the automation's reach ends one step before publish, by design.

## Works together with
- **[Content Machine](09-content-machine.md)** - shares the Content Library database and voice rules.
- **Every project** - they're the raw material; the [Application Engine](03-application-engine.md) and [Alex HQ](16-alex-hq.md) star in key episodes.
- **[Morning Brief](02-morning-brief.md)** - flags posting slots.
- **soul.md** - episodes are voice-matched, and Shaheen's edits feed back into the corpus.
