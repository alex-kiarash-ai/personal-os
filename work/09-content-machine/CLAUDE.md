# Content Machine

> **RETIRED 2026-07-06, folded into #12 LinkedIn Series (Shaheen's call, audit step 4).** Zero real runs since build while #12 carried all content work. Do not run /content-machine or /content-plan; route content creation through work/12-linkedin-series (same Content Library DB). Spec kept as history (supersede-never-delete).

## Type
Automation (on-demand, two commands: /content-machine create + /content-plan calendar)

## Purpose
Turns research, products, and ideas into deeply-researched, platform-native content in Shaheen's voice, fully tagged for planning and tracking. **/content-machine** runs a 3-agent pipeline (Researcher → Writer → Editor) on a source and produces one piece per platform (X, LinkedIn, Instagram, TikTok, Newsletter, Blog), each in that platform's real format, saved to the Content Library DB + vault + output files. **/content-plan** reads the vault and the existing library, finds gaps, and proposes a tagged content calendar the user approves item by item. The vault carries audience/brand/voice context, so the machine rarely needs to ask anything.

## Entry Points
- On-demand only. No schedule.
- `/content-machine <source>` - create a content kit from a URL / text / topic / transcript / vault/research report.
- `/content-plan` - plan a calendar over N weeks.

## Context-first rule (both commands)
ALWAYS pull vault context BEFORE asking the user anything:
- vault/me/goals.md (content must serve the 5 goals - esp. job-hunt visibility, the Alex product, teaching n8n).
- vault/business/brand.md + vault/business/ (positioning, tone, what we never say).
- vault/research/ (source material + supporting insight).
- vault/people/ (audience + competitors).
- vault/projects/content-machine/status.md + Notion Content Library (avoid repeating angles).
- brand/config/brand-config.md (brand voice). soul.md + vault/me/writing-style-notes.md (the voice + learned edits).
Then ask AT MOST 1-2 things the vault can't answer: the opinion/hot-take angle, and which platforms (if unspecified). If the vault already has rich context on the topic, skip straight to creation.

## /content-machine - 3-Agent Pipeline
1. **RESEARCHER** (sub-agent): read the source deeply. Extract key claims, data points, quotable lines, frameworks, counterintuitive insights. WebSearch for supporting stats + fresh angles. Output a research brief built around *the one insight that makes this worth sharing* - not a summary. Timebox; empty lane = say so.
2. **WRITER** (sub-agent or main): research brief + soul.md voice → platform-native pieces. Each follows the real structure of its platform (below), not just a word count. Different hooks, formats, rhythms.
3. **EDITOR** (main session): load soul.md + writing-style-notes. HARD checks - no em-dashes, no filler ("it's worth noting"), no parallel triplets, no uniform sentence length, no hollow enthusiasm. Score tone against soul.md examples. Rewrite anything that reads AI. Must pass as human-written.

### Platform formats
- **X thread:** 5-8 tweets. Hook tweet is everything. Punchy, opinionated, one insight per tweet. No hashtag walls.
- **LinkedIn post:** 150-300 words. Personal angle, hook above the fold, story structure, hashtags at end.
- **Instagram caption:** hook line, story body, CTA, hashtag block after dot spacers.
- **TikTok/Reels script:** hook in 2s, 30-60s total, text-overlay notes for muted viewers, camera/edit notes.
- **Newsletter draft:** 300-500 words. Personal opening, one deep take, P.S. kicker.
- **Blog/SEO:** only if the source isn't already a blog. H1/H2 structure, 1500+ words, internal links to the site/other content.

### Metadata per piece
Platform · Type (thread/post/caption/script/newsletter-section/long-form) · Pillar (Brand/Product/Thought Leadership/Education/Community) · Idea (the one-line hook that makes it unique) · Source (link/reference) · Target Audience.

### Save (3 places)
- **Notion Content Library** (one row per piece): all metadata tags + Status (Idea/Draft/Review/Scheduled/Published) + Publish Date. FULL content in the page body, `## {Platform}` headers. db_id/data_source in status.md.
- **Vault:** vault/projects/content-machine/kits/YYYY-MM-DD-{topic}.md - all pieces + metadata. Cross-link [[research/...]] if source was a research report, [[business/...]] if about a product.
- **Output files:** outputs/content-machine/YYYY-MM-DD-{topic}/ - one .md per platform.

## /content-plan - Calendar
1. Pull vault context (goals, business, research, existing library, competitors/ if present - skip gracefully if not built).
2. Ask only: "How many weeks?" + (if goals.md shows an upcoming launch/milestone) suggest planning around it + (if cadence unset) "How often per platform?"
3. Find gaps: empty days, underserved platforms, pillars with no recent posts.
4. Propose topics as a TABLE: title · platform · type · pillar · idea/angle · source · suggested publish date.
5. User approves / edits / rejects each. Approved → Content Library row, Status Idea, with the publish date.
6. For each approved topic tell the user: "Run /content-machine with '{topic}' to create the content."

## Notion Integration
**Content Library** under the Personal Ops System parent page.
- db_id: b7305101-b911-4b9e-9196-8e7ac259a7a7 · data_source: 0f511509-1c63-4b22-a328-976d6d56d6aa
Columns: Title (title), Platform (select), Type (select), Pillar (select), Idea (text), Source (text), Target Audience (text), Status (select), Publish Date (date).
Views: **Calendar** (by Publish Date) · **Pipeline** (board by Status) · **By Platform** (board) · **This Week** (Publish Date set, asc).

## Vault Structure
- **Tier 1:** vault/projects/content-machine/status.md - DB IDs, last run, kits index, pillars/platforms covered.
- **Tier 2:** vault/projects/content-machine/kits/YYYY-MM-DD-{topic}.md - full content kits.

## Vault Reads
goals.md, business/ + brand.md, research/, people/, competitors/ (if present), soul.md, writing-style-notes.md, brand-config.md, the Content Library.

## Vault Writes
- Content kit per run.
- New insight/data from research → vault/research/. New competitor/person mentioned → vault/business/ or vault/people/.
- If the user edits/rejects a piece → append what they disliked to vault/me/writing-style-notes.md (the machine improves over time).
- status.md, vault/index.md (new pages), vault/log.md.

## Connections
- **Fed by:** Research Team (vault/research/), business/brand, Market Pulse competitors/ (not built - skip gracefully).
- **Feeds into:** vault/me/writing-style-notes.md (shared voice learning), the modeling + Alex-product go-to-market, job-hunt visibility. Reports Done to the sprint board.

## Post-Run (mandatory)
1. New people → vault/people/, new companies → vault/business/.
2. [[wiki links]] across kit, research, business.
3. Notion Content Library rows created (full body content).
4. writing-style-notes.md on edits/rejections.
5. vault/index.md + vault/log.md.
6. Sprint board: Done on first build (2026-06-12).
7. Clean temp; keep only the per-platform .md files in the output folder.

## Close-Out Extras (Close-Out Gate)
Beyond the universal gate ([[research/alex-close-out-gate]]), this run is not COMPLETE until:
- The Notion Content Library DB has a row per piece produced (full body content).
- `vault/me/writing-style-notes.md` is updated if Shaheen edited or rejected a piece.

## Implementation Notes (as built, 2026-06-12)
- Content Library DB + 4 views created (Calendar/Pipeline/By Platform/This Week). IDs above + in status.md.
- Two separate commands wired. 3-agent pipeline specced (Researcher sub-agent → Writer → Editor with hard soul.md checks).
- Shares writing-style-notes.md with CRM/Meeting Intel/Email Triage - one voice-learning file across every drafting automation.
- Market Pulse competitors/ dependency handled gracefully (not built yet).
- No content generated at build (on-demand; first /content-machine run starts the kits + library).
