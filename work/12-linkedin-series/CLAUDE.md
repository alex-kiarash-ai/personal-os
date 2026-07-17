# LinkedIn Series "Building Alex" (build #12)

## Type
Automation (on-demand episode drafting + slot-scheduled staging via n8n). Never fully automated: n8n stages, Shaheen posts.

## Purpose
Turn Shaheen's real Personal Ops System history into an ongoing LinkedIn series in his voice, with Shaheen as hero and Alex as a named but low-visibility character. Goal: visible AI building-in-public for recruiters (Power BI / AI automation roles) and entry into the AI community. Cadence: one post per week until mid-August 2026, then two or three per week when recruiters are back. Posted 08:30 Europe/Stockholm; Shaheen posts manually, n8n only stages. Material source of truth for what each post says: vault/projects/linkedin-series/posts-5-12-plan.md. Images are created by Shaheen manually; Alex only states the suggested screenshot per draft. No image automation anywhere.

## Entry Points
- /post-episode (on-demand): draft the named or next episode from the material plan, with the published episodes 01-04 as the quality bar and the locked template + polished public register from soul.md; stop for review.
- /post-publish (n8n staging, scheduled): stage the next Approved episode as text into its own Drive folder and write the folder link back to Notion; Shaheen posts. Never posts to LinkedIn.

## HARD RULES (every run, no exceptions)
1. Read `vault/projects/linkedin-series/concept.md` EVERY run. It holds the locked decisions and the **never-share living list** (money details, other people's identities, employer internals, real-time feelings, and other private items). Shaheen adds items over time; each addition binds immediately.
2. **No em-dashes or en-dashes anywhere.** After drafting, run a deterministic scan for - and –. Any hit = failed output, rewrite the sentence.
3. **Never the "Geoffrey/RL" framing.** The honest line is: "every correction becomes a rule he never breaks again, my mistakes are his training data."
4. Sensitive personal topics appear at most once, plainly, and are never relitigated.
5. The commercial offer (Alex as a product) is invisible in the series.
6. The job-pipeline episode includes verbatim: "removes hours of tailoring, not the 60 seconds of clicking submit."
7. Every real number is real (cost, count, hours) and traceable to the vault. Never invented.
8. Images: no AI-generated photos, no fake screenshots. Real screenshots and designed brand diagrams of real architecture are both allowed (episodes 2 and 3 are the reference). All images created and picked by Shaheen manually; the staging workflow never touches images.
9. Voice: soul.md "My Words" polished public register (the LinkedIn register, NOT the generator-request register used for chat and email). English only. Hook in the first two lines.
10. Episode structure: follow the locked LinkedIn EPISODE TEMPLATE in soul.md, driven by the post's hook, turn, real material, and one hard lesson from the material plan. Not every post carries a single number; use one only when it is real and traceable to the vault.
11. HARD GATE on staging: only Notion status = Approved can ever be staged. n8n NEVER posts to LinkedIn; no LinkedIn API anywhere.
12. Comment replies: drafted on request only, Shaheen sends, never autonomous.
13. Hashtags: 3-4 niche max (#PowerBI #n8n #ClaudeAI #AIAutomation).
14. Harvest Shaheen's edits on any draft back into soul.md.

## Tools Used
Notion MCP (Content Library + sprint board), Google Drive MCP / n8n Drive node (staging), n8n API (key in work/03-application-engine/config/, reuse push pattern from config/push-nodash.js), soul.md, vault. Content Machine pipeline pattern (Researcher→Writer→Editor; Editor = the dash scan + voice check). NO LinkedIn API. NO Chrome for posting.

## Notion Integration
No new database. Episodes are rows in the existing **Content Library** (db_id b7305101-b911-4b9e-9196-8e7ac259a7a7, data_source_id 0f511509-1c63-4b22-a328-976d6d56d6aa, see vault/projects/content-machine/status.md). Conventions: Title prefix "Building Alex ENN:", Platform=LinkedIn, Type=post, Source="Building Alex series", Status flow **Draft → Approved → Staged → Published** (Approved + Staged added to the select 2026-06-13), Publish Date = slot date, FULL post text in page body. Sprint board row: "LinkedIn Series (Personal Ops System)".

**X-row convention (P9, three-plan validation, written BEFORE the first X row exists).** Every X-repurposing variant is a row in the SAME Content Library carrying **Platform=X** (Source stays "Building Alex series"). The `Platform` select gains the `X` option via the documented Notion ALTER sequence (root CLAUDE.md "Notion creation sequence" step 3, `notion-update-data-source` ALTER COLUMN) at the moment the first X row is created - the LinkedIn staging workflow filters `Platform=LinkedIn`, so an X row is excluded from LinkedIn staging **by construction**, no workflow change and no risk of an X variant staging as a LinkedIn episode. There is NO X API and NO auto-post: X stays a human-posts lane (Alex repurposes into a Draft, Shaheen posts).

## n8n workflow "LinkedIn Series" (staging only)
Scheduled run → query Content Library for the oldest row matching the deployed three-way filter **Status=Approved AND Source="Building Alex series" AND Platform=LinkedIn** (the Platform=LinkedIn leg is what keeps a future Platform=X repurposing row from ever being staged as a LinkedIn episode; verified in docs/n8n/linkedin-series-staging/workflow.json) → create Drive folder "Building Alex"/episode-NN-slug/ → build post.txt from the page body (deterministic dash scan + bullet/number fidelity) → upload the TEXT ONLY into that episode folder → write Status=Staged + the Drive folder link back to Notion → read-back verify both writes. No image node: images are manual, Shaheen adds his image to the episode folder himself. Morning Brief flags posting days.

**Cadence honesty (F14, three-plan validation).** The deployed cron is `0 8 * * 2,4` (Tue/Thu 08:00, Europe/Stockholm). The "weekly to mid-August" calendar is enforced by **approval supply**, not the cron: the workflow no-ops on an empty Approved queue, so it only stages when Shaheen has approved a row. Do NOT "fix" the cron to a weekly schedule blind - the twice-weekly cron + supply-gating is the intended design.

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
- Posts 5-12 to draft from posts-5-12-plan.md: one per week until mid-August 2026, then two or three per week.
- Staging-workflow quality fixes (dash scan, text fidelity, per-episode folder, Drive-link write-back, read-back verify) tracked in n8n-staging-fix-plan.md.

## Trifecta
Gate: **human-posts**. Legs: private_data=true, untrusted_content=false, external_comm=true (agent-security Rule-of-Two, three-plan validation P3, 2026-07-17). Private real numbers + external publish path (LinkedIn). n8n stages text only, Shaheen makes the image and posts. Source of truth: the `trifecta` block in system/manifest.json + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.
