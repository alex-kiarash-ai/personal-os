# LinkedIn Series "Building Alex" (build #12)

## Type
Automation (on-demand episode drafting + slot-scheduled staging via n8n). Never fully automated: n8n stages, Shaheen posts.

## Purpose
Turn Shaheen's real Personal Ops System history into a 10-episode LinkedIn series in his voice, with Shaheen as hero and Alex as a named but low-visibility character. Goal: visible AI building-in-public for recruiters (Power BI / AI automation roles) and entry into the AI community. Calendar: Tue + Thu 08:30 Europe/Stockholm, 16 Jun → 16 Jul 2026, then ongoing log.

## Entry Points
- /post-episode (on-demand): draft the named or next episode, stop for review.
- /post-publish (n8n, Tue + Thu 08:00): stage the next Approved episode to Google Drive.

## HARD RULES (every run, no exceptions)
1. Read `vault/projects/linkedin-series/concept.md` EVERY run. It holds the locked decisions and the **never-share living list** (money details, other people's identities, employer internals, real-time feelings, and other private items). Shaheen adds items over time; each addition binds immediately.
2. **No em-dashes or en-dashes anywhere.** After drafting, run a deterministic scan for - and –. Any hit = failed output, rewrite the sentence.
3. **Never the "Geoffrey/RL" framing.** The honest line is: "every correction becomes a rule he never breaks again, my mistakes are his training data."
4. Sensitive personal topics appear at most once, plainly, and are never relitigated.
5. The commercial offer (Alex as a product) is invisible in the series.
6. The job-pipeline episode includes verbatim: "removes hours of tailoring, not the 60 seconds of clicking submit."
7. Every real number is real (cost, count, hours) and traceable to the vault. Never invented.
8. Images: real screenshots only (n8n canvas, Obsidian graph, Task Scheduler, Power BI dashboard), stored in screenshots/, picked by Shaheen. NEVER AI-generated.
9. Voice: soul.md "My Words" generator-request register. English only. Hook in the first two lines.
10. Episode skeleton, always: recognizable problem → what I built → one real number → one hard lesson.
11. HARD GATE on staging: only Notion status = Approved can ever be staged. n8n NEVER posts to LinkedIn; no LinkedIn API anywhere.
12. Comment replies: drafted on request only, Shaheen sends, never autonomous.
13. Hashtags: 3-4 niche max (#PowerBI #n8n #ClaudeAI #AIAutomation).
14. Harvest Shaheen's edits on any draft back into soul.md.

## Tools Used
Notion MCP (Content Library + sprint board), Google Drive MCP / n8n Drive node (staging), n8n API (key in work/03-application-engine/config/, reuse push pattern from config/push-nodash.js), soul.md, vault. Content Machine pipeline pattern (Researcher→Writer→Editor; Editor = the dash scan + voice check). NO LinkedIn API. NO Chrome for posting.

## Notion Integration
No new database. Episodes are rows in the existing **Content Library** (db_id b7305101-b911-4b9e-9196-8e7ac259a7a7, data_source_id 0f511509-1c63-4b22-a328-976d6d56d6aa, see vault/projects/content-machine/status.md). Conventions: Title prefix "Building Alex ENN:", Platform=LinkedIn, Type=post, Source="Building Alex series", Status flow **Draft → Approved → Staged → Published** (Approved + Staged added to the select 2026-06-13), Publish Date = slot date, FULL post text in page body. Sprint board row: "LinkedIn Series (Personal Ops System)".

## n8n workflow "LinkedIn Series" (staging only)
Schedule Tue + Thu 08:00 Europe/Stockholm → query Content Library for oldest "Building Alex" row with Status=Approved → create Drive folder "Building Alex"/episode-NN-slug/ → upload post.txt (page body) + the approved image → update row to Staged + Drive link. Build/deploy AFTER episode 1 is approved (review stop comes first). Morning Brief flags slot days.

## Vault Structure
- Tier 1: vault/projects/linkedin-series/status.md (per-run updates, open items)
- Tier 2: vault/projects/linkedin-series/ (concept.md = locked decisions + never-share list; build-prompt.md = canonical spec)

## Vault Reads
soul.md, concept.md (every run), vault/log.md, vault/projects/, vault/research/.

## Vault Writes
status.md per run; soul.md edit-harvest; log.md; index.md for new pages.

## Connections
- Fed by: every other automation (they generate the episode material), Content Machine (pipeline pattern), soul corpus.
- Feeds into: Morning Brief (slot-day flags), Personal CRM (engagement may surface people), Weekly Exec Report (series metrics).

## Post-Run (mandatory)
1. vault/people/ + vault/business/ for anyone/anything new the run touched
2. [[wiki links]] between pages
3. Notion rows updated
4. vault/index.md + vault/log.md
5. Sprint board: mark "LinkedIn Series" Done only after episode 1 is staged end-to-end
- Alex HQ metrics push (added 2026-07-02): POST the run's key metric(s) to the build #16 ingest webhook per the contract in work/16-alex-hq/CLAUDE.md; exact curl in .claude/commands/post-publish.md. Failure-tolerant, token never printed.

## Open items
- Face photo or video in episode 1: Shaheen decides by Mon 2026-06-15 EOD (with the profile deadline, Notion task 37db5342-d7f1-81bf-a60d-ca7416380263).
- n8n staging workflow: deploy after episode 1 approval.
