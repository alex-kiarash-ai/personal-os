# Alex AI Radar

## Type
Automation (on-demand pilot, then a weekly Stream B sweep folded into the Morning Brief; n8n plumbing deferred to Phase 2). One engine, three output taps. Alex is the brain, the vault is the memory, Notion holds the decision pipeline.

## Purpose
Turn the daily flood of AI-field noise into a small number of decisions Shaheen actually acts on, and get sharper about his taste every week while doing it. Not a digest. A research partner with compounding memory.

One scrape/fetch feeds one scoring pass, which routes survivors to three taps:
- **Tap 1 (Stream B, capability upgrades):** new MCPs, models, libraries, techniques that make Alex and the existing automations better. **Ships first.**
- **Tap 2 (content angles):** interesting items routed to the [[projects/linkedin-series/status|Building Alex series]] (#12; Content Machine retired into it 2026-07-06). Nearly free once the engine runs. Ships second.
- **Tap 3 (Stream A, product opportunities):** ideas Shaheen could build and sell. **Stays dark until Stream B earns trust**, and when live it runs behind the drop-rule guardrail (Run Check 6).

Core principle, encoded not hoped: **Alex proposes, Shaheen decides.** Alex never advances an item past "Interesting," never installs, builds, deploys, or spends, without an explicit yes. The permission rule is a Notion status gate (Run Check 2), not a promise.

Reframe that shaped this spec (2026-07-01 research run, [[research/alex-ai-radar-validation]]): the constraint is output, not signal. So the radar is only allowed to be net-neutral or net-negative on open loops. Every "ready to build" must name what gets dropped to make room.

## Entry Points
- **On-demand (Phase 0-1):** `/alex-radar` - Alex runs the whole loop by hand (fetch → dedup → score → present → update memory).
- **Seed mode (added 2026-07-02):** `/alex-radar {url}` - Shaheen drops any link he spots (LinkedIn, X, anywhere). Alex scores that ONE item through the same rubric + run checks (dedup vs memory, corroboration search is reading), writes the Notion row at Status <= Interesting, updates memory. Ten-second capture path; every reaction on a seeded item warms the taste profile, currently the coldest part of the system.
- **Scheduled (Phase 1, LIVE 2026-07-02):** weekly Stream B sweep, **Mondays 07:30** (slot confirmed by Shaheen 2026-07-02), Task Scheduler job `PersonalOS-alex-radar` → `scripts/run-alex-radar.ps1` → headless `claude -p "Run /alex-radar --weekly"`, log in `outputs/logs/alex-radar.log`. Runs BEFORE the 08:00 [[projects/morning-brief/status|Morning Brief]], which surfaces the output as its **Radar section** (rule added to work/02-morning-brief/CLAUDE.md), not a separate ritual.
- **Phase 2 collection half LIVE (2026-07-06, audit step 6):** n8n workflow **"Alex Radar - Collector (15)"** (`PYePT4Al6aPZi56M`, daily 06:00 + manual `GET /webhook/radar-collect`) pulls the Tier 1 feeds (Claude Code / MCP servers / MCP spec / n8n release atoms, OpenAI + DeepMind RSS, 3 HN Algolia queries) into data table **`radar_inbox`** (`GLyqcNyG7iCudXcI`), dedup = 3-day recency window + in-batch hash (NO table read in-workflow: the dataTable get/returnAll node crashed the box, see error-log 2026-07-06). An **urgent lane** (Tier-1 breaking-change vocabulary OR friction-list keyword match) POSTs one aggregated note per run to the alex_inbox (`/webhook/alex-note`, field `text`) so breakage news reaches Shaheen same-day instead of Monday. The weekly sweep READS the table first (REST rows GET, cursor pagination) and live-fetches only Product Hunt / community / MCP directories / Anthropic news + as fallback. Builder: `scripts/build-radar-collector.js` (idempotent, re-run to update); exports in config/ + docs/n8n/radar-collector/. Error handler wired (Pipeline Error Alert), but note: CRASHED executions bypass it (liveness catches those). X via Bright Data / official MCP remains the deferred paid half of Phase 2.

## Tools Used
- **WebSearch + WebFetch** (load via ToolSearch first) - the pilot data layer. Free feeds only, no scraping in Phase 0-1.
- **Notion MCP** (`notion-create-database`, `notion-move-pages`, `notion-update-data-source`, `notion-create-view`, `notion-create-pages`, `notion-fetch`, `notion-update-page`, `notion-search`) - the Tools decision pipeline + status gate.
- **Vault (Read/Write/Edit)** - the compounding memory (Taste Profile, Landscape Memory, decisions log). This is the hero, and it is vault-native markdown, not Notion.
- **Chrome** - only for a source that blocks plain fetch. Never for the free APIs, never for Gmail/Calendar/Notion.
- Feeds [[projects/morning-brief/status|Morning Brief]] and the [[projects/linkedin-series/status|Building Alex series]] (content lane; Content Machine retired into #12 on 2026-07-06).
- **Phase 2 only:** Bright Data (X scrape, ~$30/mo bolt-on) + n8n. Model routing rule applies (see Phase 2).

## Sources (Phase 0-1: free feeds, ~$0)
Backbone is free and stable. X is a Phase 2 paid bolt-on, not the backbone (research corrected the original spec, which had it inverted).

**Stream B (ships first):**
- Hacker News (Firebase API + Algolia search) - front page, Show HN, `ai`/`mcp`/`agent` matches. No key, no rate limit.
- GitHub - release + tag Atom feeds (`/releases.atom`) for stack repos (n8n, MCP servers, AI tooling); REST for trending-by-search. No auth for the feeds.
- Product Hunt - GraphQL API / RSS, developer-tools + AI categories.
- Model provider changelogs - OpenAI RSS (`openai.com/news/rss.xml`), Google DeepMind blog RSS. **Anthropic has no official RSS**, use a third-party feed (e.g. Releasebot) or fetch the news page.
- MCP registry - new server listings.

**Self-watch lane (added 2026-07-02, Shaheen's "keep Alex updated" decision: feeds weekly + diff monthly):** the radar's mirror - releases of Alex's OWN stack, not the field. Four free feeds ride every weekly sweep: Claude Code releases (`anthropics/claude-code/releases.atom`), official MCP servers (`modelcontextprotocol/servers/releases.atom`), n8n (`n8n-io/n8n/releases.atom`), Anthropic news page (no RSS). Scored and gated like any item, `Improves = Alex`. On the **first Monday of each month**, the weekly run ALSO does a **capability diff**: inventory local reality (`claude --version`, installed MCP servers, skills list, Hetzner n8n version) vs the self-watch releases since the last diff, and propose upgrades as Tools rows at Status <= Interesting. Installs still need an explicit yes, always.

**Friction-first matching (added 2026-07-02):** `vault/projects/alex-ai-radar/friction-list.md` is the radar's demand side - the table of known pains and their current workarounds (no Airbnb API, WhatsApp screen-capture, Notion row-listing gap, legacy-SSE MCP transport, ...). Every sweep matches surviving items against it BEFORE generic scoring. A friction match is named explicitly in the presentation ("kills friction #5"), justifies a maxed Leverage score, and gets presented even in an otherwise zero-item week. Alex maintains the list: add a row when a new workaround gets built, strike (with date) when something kills one. This is also the standing "better MCP for a tool I already use" watchlist.

**Error-log flywheel (added 2026-07-02):** staying updated includes stopping repeated mistakes. On the first-Monday run (alongside the capability diff), Alex retros HERSELF: scan `vault/projects/error-log.md`, failed/flagged runs in `outputs/logs/*.log` since the last diff, and any wrong assumption caught mid-build (like decision #1's voided Notion-refactor target). Propose up to 3 concrete spec/runbook fixes in the presentation. Fixes are applied only on Shaheen's yes, then propagated per the Change Propagation standing order.

**Community feeds (added 2026-07-02, Shaheen's explicit call, noise-capped):** r/mcp, r/ClaudeAI, n8n community forum (free RSS, endpoints in sources.md). Guardrails while the taste profile is cold (<20 dated decisions): max 2 community items presented per sweep; echo inside one community counts as ONE corroboration; no community item reaches high-confidence without a non-community corroborating source.

**Stream A (Phase 2, when Tap 3 activates):** curated X list (20-40 high-signal accounts) via Bright Data, plus HN/Show HN and Product Hunt AI as free supplements. **Nitter is dead in 2026, do not build on it.**

**Match keywords:** AI agents, MCP, workflow automation, n8n, RAG, data workflows, new model/API release, "just shipped", "launching", indie AI, Power BI + AI.

Full source list with endpoints lives in `vault/projects/alex-ai-radar/sources.md`.

## Notion Integration
**One new database in the pilot: `AI Radar Tools`** (Stream B pipeline). The Ideas DB (Stream A) is defined below but **not created until Tap 3 activates**. Memory (Taste Profile, Landscape Memory) does NOT go in Notion; it lives in the vault.

Bootstrap on first run per the root **Bootstrap Protocol** (Notion creation sequence: `notion-create-database` → `notion-move-pages` under the Personal Ops System parent → `notion-update-data-source` ALTER COLUMN to restore select options → `notion-create-view`). Save IDs to `vault/projects/alex-ai-radar/status.md`.

- parent_page_id: `37bb5342-d7f1-81a4-8bf1-d5642d7c3e85` (Personal Ops System page)

**`AI Radar Tools` schema (Stream B):**
- **Tool** (title)
- **Type** (select: MCP, Model, Library, Technique, Product)
- **What it does** (text)
- **Improves** (select: Alex, Personal Ops System, Job Pipeline, Modeling, Content)
- **Source** (url)
- **Corroboration** (number - count of INDEPENDENT sources after dedup, Run Check 1)
- **Fit score** (number - rubric total, see Scoring)
- **Status** (select: New, Interesting, Approved to research, Researched, Approved to install, Installed, Dropped)
- **Effort** (select: Trivial, Moderate, Heavy)
- **Decision** (select: Pending, Yes, No, Park)
- **First seen** (date)
- **Notes** (text)

**`AI Radar Ideas` schema (Stream A, DEFERRED, create only when Tap 3 goes live):**
- **Idea** (title), **Concept** (one-line text), **Bucket** (select: Interesting, Ready to build, Heavy infrastructure), **Opportunity score** (number), **Rationale** (text), **Sources** (text), **Status** (select: New, Interesting, Approved for deep-dive, Deep-dived, Validated, Decided), **Drops-what** (text - the guardrail: what Shaheen drops to build this), **Decision** (select: Build, Park, Drop, Pending), **First seen** (date), **Notes** (text).

**Gotcha (same as [[projects/sprint-tracker/status|Sprint Tracker]]):** `notion-fetch` on a database/data source returns schema + views only, NOT rows. Primary read path: fetch each row by page ID from the snapshot table in `status.md`. Use `notion-search` scoped to the data source only to discover hand-added rows; it caps at 25 and is not exhaustive, never the sole listing. Add any newly discovered row's page ID to the snapshot.

**Permission gate (HARD, Run Check 2):** Alex may set Status only up to **Interesting** unattended. EXCEPTION: an item clearing the Auto deep-dive threshold may advance **Approved to research → Researched** on the standing auto-research rule (research is reading). Beyond "Researched" (Approved to install, Installed) always needs Shaheen's explicit yes in-session. Same ladder for the Ideas DB (Approved for deep-dive → Deep-dived allowed on threshold; Validated / Decided / Build need a yes).

## Scoring (rubric, numbers you can sort by)
No LLM re-checking an LLM. Deterministic gates + one reasoning pass.

**Stream B (Tools), each 1-5, sum = Fit score (max 20):**
- Real vs hype (is it shipping and usable, or a demo/announcement)
- Fit to my stack (does it slot into n8n / Claude / Power BI / the automations)
- Leverage (how much it improves Alex or an existing automation)
- Effort-inverse (5 = trivial to adopt, 1 = heavy)

**Stream A (Ideas), each 1-5, sum = Opportunity score (max 20):** real-vs-hype, buildable-with-my-stack, novelty, sellable-size.

**Corroboration gate:** 2+ independent sources (after dedup) before an item is presented as high-confidence / "ready". A single source stays "watch", capped at Interesting regardless of score.

## Vault Structure
work/ holds this spec + config only. All knowledge is in the vault.

- **Tier 1:** `vault/projects/alex-ai-radar/status.md` - DB IDs, schema, phase, source list pointer, Tools row snapshot (Task/Status/Since/Page ID), last run, current outcome metric.
- **Tier 2 (the brain, markdown, wiki-linked, git-tracked):**
  - `vault/projects/alex-ai-radar/taste-profile.md` - **the hero.** Alex's model of Shaheen. Seeded from the vault on run 1 (Run Check 4). Sections: My stack · What "sellable" means to me · Greenlit patterns · Rejected patterns · Topics I care about · Topics to ignore · Profile confidence (cold until ≥20 dated decisions) · Last pruned.
  - `vault/projects/alex-ai-radar/landscape-memory.md` - the "what's cooking" tracker. One row per theme: theme · first seen · last seen · **independent-event count (dedup'd, Run Check 1)** · notable players · trajectory (accelerating / steady / cooling) · amplified-not-accelerating flag · note.
  - `vault/projects/alex-ai-radar/decisions.md` - append-only ground truth. One line per Shaheen yes/no/park, dated, with the item and reason. Feeds the Taste Profile and the outcome metric. Never overwritten.
  - `vault/projects/alex-ai-radar/radars/YYYY-MM-DD.md` - one radar output per run (the shortlist presented, with scores + corroboration).
  - `vault/projects/alex-ai-radar/sources.md` - free-feed source list + endpoints (config that reads as knowledge).

## Vault Reads
- **soul.md** (voice + priorities: rent-moving work first, job pivot > curiosities; the "My Words" corpus for any human-facing prose; the Building Alex never-share list before any content-tap suggestion).
- `taste-profile.md`, `landscape-memory.md`, `decisions.md` (the compounding memory - read every run).
- `friction-list.md` (the demand side - matched against every sweep's survivors before generic scoring).
- `vault/projects/error-log.md` + `outputs/logs/*.log` (first-Monday flywheel retro only).
- `vault/me/goals.md` and `vault/me/situation.md` (the too-many-tracks constraint that the drop-rule enforces).
- `vault/projects/*/status.md` (what's already built + his real stack, so "Improves which project" and "fit to my stack" are grounded, not guessed).

## Run Checks (every run, before writing output)
1. **Dedup-before-count.** Canonical URL + fuzzy title match. Collapse the same launch/story from N sources into ONE item carrying N as its corroboration count. Reshares/echo count as one, never N independent signals. This runs BEFORE any Landscape Memory counting (fixes the pseudoreplication trap).
2. **Permission status gate.** Never advance a Tools or Ideas row past "Interesting" without an explicit yes. Hard stop. This is the encoded permission model.
3. **Corroboration gate.** 2+ independent sources before an item is presented as high-confidence / "ready to build/adopt". Single-source items stay in watch, capped at Interesting.
4. **Taste-seed / cold-start guard.** On run 1, seed `taste-profile.md` from the vault (greenlit/rejected patterns, soul.md priorities, the Building Alex never-share list, past project decisions). Until the profile has ≥20 dated decisions in `decisions.md`, label every score "low-confidence, profile still cold" and do not narrow hard on taste.
5. **Recency cap + drift sweep.** Weekly, run a contradiction/consolidation sweep on `taste-profile.md`: store dated decisions, never overwrite into a prose blob; cap recency weighting so recent picks don't dominate; drop or reconcile contradictions. Hold out a few of Shaheen's past judgments and check the profile still predicts them.
6. **Stream A leash (drop-rule).** Tap 3 stays dark until the weekly Stream B sweep has run for ≥3 weeks with a positive outcome metric. When live, NO idea is presented as "ready to build" unless the row's `Drops-what` field names what Shaheen drops to make room. Net-neutral on open loops or it does not ship.
7. **Cadence / missed-run.** Weekly Stream B sweep. If a week was skipped, the output opens with "Missed N sweep(s) since YYYY-MM-DD" and the run notes it. Never silently absorb a gap (mirrors Sprint Tracker missed-run detection).
8. **Outcome metric, not approval.** Track the real signal: of items presented, how many became **shipped / adopted / posted within 30 days**. Weekly hit-rate (approval share) is secondary and gameable by safe picks; the 30-day downstream-action count is ground truth. Both logged in `status.md`.

## Deep-dive flow (manual greenlight OR auto on high score)
Research is reading, so it is allowed once Shaheen greenlights an item, OR automatically when an item clears the Auto deep-dive threshold below. Still no build/install/spend either way.
1. Reopen the saved source. Pull full content, find 2+ independent corroborating sources.
2. Write it up: what it actually is, how it works, buildable-with-my-stack, what adoption/build takes, prior art/competitors, and (Stream A) the sellable angle.
3. Assign the bucket / effort. Present for a joint decision. Install or build only after a SECOND explicit yes.
4. New companies/people found → `vault/business/`, `vault/people/` (Post-Run ingestion).

## Auto deep-dive (Research Team integration, set 2026-07-01)
High-conviction items get researched automatically, no manual greenlight, because research is reading. A build/install/spend still always needs an explicit yes.
- **Trigger:** Fit score ≥ 16/20 (Stream B) or Opportunity score ≥ 16/20 (Stream A) AND corroboration ≥ 2 independent sources (post-dedup). Thresholds tunable in status.md.
- **Rate cap:** top 1 auto-deep-dive per on-demand run, top 2 per weekly sweep. Highest-scored only. Zero is fine. A threshold that fires on everything is the failure mode; protect tokens and attention.
- **What runs:** the [[projects/research-team/status|Research Team]] (#04) decision-brief pattern (`work/04-research-team/patterns/decision-brief-concept-validation.md`), extended with a phased build plan. Reuses Research Team's whole flow (design lanes → parallel sub-agents → synthesize → vault + Notion + branded PDF). The radar is the trigger, Research Team is the engine.
- **Auto vs interactive:** an auto-triggered deep-dive SKIPS Research Team's interactive team-approval gate (the whole point is automation). The score threshold + rate cap are the control instead.
- **Question shape:** "Evaluate {item}: what it is, how it works, buildable with my stack, upside, downside, challenges, potential, and a step-by-step build plan (phased)."
- **Output:** branded concept PDF → `outputs/alex-ai-radar/YYYY-MM-DD/{slug}.pdf`, ALEX brand per brand/config/brand-config.md (since the 2026-07-03 rebrand; pre-rebrand PDFs used the deep-space personal aesthetic). Sections: What it is · How it works · Fit to my stack · Upside · Downside · Challenges · Potential · Build in steps (phased) · Verdict. Plus `vault/research/{slug}.md` + a Notion research page. The Tools/Ideas row links the PDF and moves to **Researched**, then STOPS. Build/adopt/spend is still Shaheen's call.
- **Cost note:** this spends Claude tokens (compute), NOT infra. Distinct from the 50 EUR/mo infra cap. The rate cap bounds it.

## Vault Writes
- `radars/YYYY-MM-DD.md` per run.
- Update `taste-profile.md` after every decision (dated append + prune, never blob-overwrite).
- Update `landscape-memory.md` (dedup'd theme counts, trajectory, amplified flags).
- Append `decisions.md` on every Shaheen yes/no/park.
- Refresh `status.md` snapshot (Status, Since reset on change, Page ID for new rows, last_run, outcome metric).
- `vault/log.md` entry; `vault/index.md` on first run / new pages.

## Connections
- **Feeds into:** [[projects/morning-brief/status|Morning Brief]] (weekly Radar section - the delivery surface, no separate ritual); the [[projects/linkedin-series/status|Building Alex series]] (Tap 2 content angles; Content Machine retired into #12 on 2026-07-06); the job pivot / Alex-product demo (the taste-learning memory IS the portfolio artifact).
- **Fed by:** free feeds (HN, GitHub, Product Hunt, OpenAI/Google RSS, MCP registry); soul.md + the vault (taste seed); Phase 2 n8n + Bright Data (X).
- **Reuses:** the [[projects/application-engine/status|Application Engine]] n8n + Bright Data muscle pattern for Phase 2 (already in production, do not rebuild).
- **Auto-invokes:** [[projects/research-team/status|Research Team]] (#04) for the auto deep-dive on high-conviction items → concept PDF (see Auto deep-dive). Shared surfaces: `vault/research/` + Notion.

## Permission Model (hard rules)
- **Allowed without asking:** read, fetch, dedup, score, save to Notion at Status ≤ Interesting, update vault memory, present. Deeper research + web search (reading only): on manual greenlight, OR automatically for high-conviction items per the Auto deep-dive rule.
- **Standing auto-research rule (Shaheen 2026-07-01):** an item clearing the auto-deep-dive threshold may advance to "Researched" and get a concept PDF WITHOUT a per-item yes, because research is reading. That is the only relaxation of the gate.
- **Never without an explicit yes:** build, deploy, write production code, install an MCP/tool, spend money (incl. turning on Bright Data, or adding infra even under the 50 EUR/mo cap), change any live system, or advance any row past **Researched** (auto-deep-dive items) / **Interesting** (everything else).

## Cost Model
- **Phase 0-1: ~$0.** Free feeds + API/RSS only. The only cost is Alex's reasoning time, spent on decisions not noise.
- **Phase 2: ~$30-90/mo, decide at activation (assumption corrected 2026-07-01, see [[research/x-mcp-cost-validation]]).** The old line here ("official X API is $90-200/mo gatekept, skip it, use Bright Data") is STALE: X moved to pay-per-use default on 6-Feb-2026 (no monthly floor, $0.005/read, recent 7-day search open to all). Two live options at Phase 2:
  - **X official hosted MCP** (recent search, app-only Bearer, read-only): ~$45-90/mo for ~30 accounts daily, tunable under the 50 EUR cap. First-party, legal, zero ban risk, zero scraper/proxy infra. **Default to this first.**
  - **Bright Data X scraper**: ~$14-27/mo ($1.50/1K records), cheaper on raw price but needs proxy infra + a legal posture. Fallback if a live per-read test shows X billing blows the cap.
  - Open before committing: per-read billing granularity (per-post vs per-request) + MCP rate limits, closable only by a small live test (a spend, gated). Full-archive search (Pro $5k / Enterprise $42k, closed to new signups) is NOT needed, we want fresh signal not history.

## Rollout
- **Phase 0 (this week):** create the `AI Radar Tools` DB, seed `taste-profile.md` from the vault, run one Stream B sweep by hand on free feeds, present ONE item (zero-item runs allowed and good). Shaheen reacts.
- **Phase 1 (LIVE 2026-07-02):** weekly Stream B sweep, scheduled Mondays 07:30 (`PersonalOS-alex-radar`), folded into the Morning Brief. Tune the source list and Taste Profile against decisions. Watch the outcome metric.
- **Phase 2:** move the muscle into n8n (schedule, dedup, Inbox DB write). Alex keeps brain + memory. **X-signal source DECIDED (Shaheen 2026-07-01):** default to **X's official hosted MCP first** (recent 7-day search, app-only Bearer, read-only), under a **hard 50 EUR/mo cap**, cost-watched; **Bright Data is the named fallback** if the real cost runs hot. Activation step 1 is a live ~$5 per-read test (settles per-post-vs-per-request billing, the $45-vs-$90 question), THEN cap and wire. See [[research/x-mcp-cost-validation]]. This supersedes the old "Bright Data only" plan. **Model routing rule:** any human-facing prose node (content-tap drafts) uses claude-sonnet-4-6 fed from soul.md (rule corrected 2026-07-08 to match production); every scoring/dedup/classification/gate node uses Claude.
- **Phase 3:** activate Tap 3 (Stream A) behind the drop-rule, and automate the 30-day outcome-metric review.

## Post-Run (mandatory)
1. New people → `vault/people/` (People Intake Protocol); new companies/tool vendors → `vault/business/`, with [[wiki links]].
2. [[wiki links]] between the radar, taste-profile, landscape-memory, and any project/business/people pages touched.
3. Update Notion (Tools rows at Status ≤ Interesting only, unless Shaheen instructed a specific advance).
4. Update `vault/index.md` (first run / new pages only).
5. Update `vault/log.md`: `## [YYYY-MM-DD HH:MM] alex-radar | {n} items scored, {m} presented, {tap}, outcome-metric {x/y}`.
6. Sprint board: mark the "Alex AI Radar" row Done on first successful build (contract with /new).
- Alex HQ metrics push (added 2026-07-02): POST the run's key metric(s) to the build #16 ingest webhook per the contract in work/16-alex-hq/CLAUDE.md; exact curl in .claude/commands/alex-radar.md. Failure-tolerant, token never printed.

## Implementation Notes (as specced 2026-07-01, not yet built)
- Design source of truth: [[research/alex-ai-radar-validation]] (3-lane research run) + the v0.1 pilot spec Shaheen drafted. This file supersedes the v0.1 draft.
- **Corrections baked in from research:** Bright Data is cheap and low-risk (was wrongly flagged expensive/fragile); free feeds are the backbone, not X; the taste model does NOT compound on autopilot (cold-start/drift/echo), so Run Checks 1/4/5 are mandatory, not optional; Stream A is a real personal gap but weak product, so it ships last behind the drop-rule.
- **Decisions locked with Shaheen (2026-07-01):** all three taps wanted, but as ONE engine with three taps, sequenced B → content → A. Build for use, keep clean enough to screen-record as an Alex-product / interview artifact ("both, use-first"). Memory is the hero feature.
- **Open:** confirm the ~20-40 X account list (Phase 2 only, not needed for Stream B start). Monday slot CONFIRMED + scheduled 2026-07-02 (Mondays 07:30).
- **Pending wiring (done when Shaheen runs it as a new project):** add row 15 to the Routing Table in the root CLAUDE.md and register `/alex-radar`; create the `vault/projects/alex-ai-radar/` folder + `status.md`; add the "Alex AI Radar" row to the Sprint board.
- Standup/output voice: Alex (soul.md). Lead with the one item that clears the bar (or "nothing cleared the bar today"), then the memory update, then any theme that is genuinely accelerating (after dedup). No digest-speak.
