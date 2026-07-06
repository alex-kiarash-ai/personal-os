# /alex-radar - Daily AI Capability + Opportunity Radar

Spec: work/15-alex-ai-radar/CLAUDE.md (read it first, it is authoritative).

One engine, three taps, sequenced. Stream B (tools) ships first; content tap second; Stream A (build-and-sell ideas) stays dark behind the drop-rule until Stream B earns trust. Alex proposes, Shaheen decides. Alex never advances a Notion row past "Interesting."

## Modes
- `/alex-radar` - on-demand full loop (Phase 0-1).
- `/alex-radar --weekly` - the Monday Stream B sweep, surfaced as a Radar section in the Morning Brief.
- `/alex-radar {url}` - **seed mode**: Shaheen dropped a link. Skip the feed fetch; run steps 1-2, then score THAT item through steps 4-9 (dedup vs memory, corroboration search allowed, friction-list match, Notion row <= Interesting, memory update). His reaction goes to decisions.md like any other - seeded items warm the taste profile fastest.

## Steps
1. **Bootstrap check.** Read vault/projects/alex-ai-radar/status.md. If no `tools_db_id`, run the Bootstrap Protocol: create the `AI Radar Tools` DB (Notion creation sequence: create-database -> move under Personal OS parent -> update-data-source ALTER COLUMN for selects -> create-view), save IDs to status.md. Schema in the spec.
2. **Read memory.** taste-profile.md, landscape-memory.md, decisions.md, **friction-list.md** (the demand side). Load soul.md (voice + priorities + Building Alex never-share list).
3. **Read the collector table FIRST, live-fetch the rest (since 2026-07-06).** The n8n "Alex Radar - Collector (15)" workflow (PYePT4Al6aPZi56M) pulls the Tier 1 feeds (Claude Code / MCP servers / MCP spec / n8n releases, OpenAI + DeepMind, 3 HN queries) into data table `radar_inbox` (id `GLyqcNyG7iCudXcI`) daily at 06:00 server-side, so a sleeping laptop no longer loses a week of signal.
   - **Primary read:** REST `GET /api/v1/data-tables/GLyqcNyG7iCudXcI/rows?limit=100` (key at work/03-application-engine/config/n8n-api-key.txt; paginate by `nextCursor` via `?cursor=`, NOT skip/offset). Select rows with `seen_at` in the last 8 days; dedup by `hash` (cross-day duplicates are expected by design; the `swept` column is unused for now because the rows API cannot update).
   - **Live fetch (WebSearch/WebFetch) still covers:** Product Hunt, the community feeds (r/mcp, r/ClaudeAI, n8n forum; cold-profile cap: max 2 community items presented, in-community echo = 1 corroboration, high-confidence needs a non-community source), the MCP registry/directories, and Anthropic's news page (no RSS). Also the FALLBACK for everything if the table is empty or unreachable: fetch live from sources.md exactly as before.
   - Self-watch releases arrive via the collector now; still scored like any item, `Improves = Alex`.
   - Rows with `urgent=1` were already pushed to the alex_inbox the day they landed (the urgent lane); treat them as pre-flagged, not new.
3b. **Capability diff + flywheel retro (first Monday of the month only, --weekly runs).** Two halves, skip both entirely on non-first Mondays:
   - **Diff:** inventory local reality: `claude --version`, installed MCP servers, skills list, Hetzner n8n version (API base in work/03-application-engine/config/). Diff against self-watch releases since the last diff (note the date in status.md). Upgrade proposals become normal Tools rows at Status <= Interesting; NEVER install without a yes.
   - **Flywheel:** retro Alex herself. Scan vault/projects/error-log.md, failed/flagged runs in outputs/logs/*.log since the last diff, and wrong assumptions caught mid-build. Propose up to 3 concrete spec/runbook fixes in the presentation (what broke, the pattern, the exact file+change). Apply only on Shaheen's yes, then propagate per the Change Propagation standing order. If the logs are clean, say so in one line and move on.
4. **Run Checks (spec, before any output):** 1 dedup-before-count · 2 permission status gate (stop at Interesting) · 3 corroboration (2+ independent sources for high-confidence) · 4 cold-start guard (seed from vault run 1; low-confidence until >=20 dated decisions) · 5 recency cap + weekly drift sweep · 6 Stream A leash (drop-rule, Tap 3 dark until Stream B proven) · 7 missed-run · 8 outcome metric.
5. **Friction match, then score.** Check every survivor against friction-list.md FIRST: a match is named in the presentation ("kills friction #5"), justifies a maxed Leverage score, and a friction-killer gets presented even in a zero-item week. Then score on the rubric (Stream B: real-vs-hype, fit-to-stack, leverage, effort-inverse). Route to the right tap. Maintain the list: new workaround built → add a row; friction killed → strikethrough + date.
6. **Write** to Notion `AI Radar Tools` at Status <= Interesting only. Update landscape-memory.md (dedup'd counts). Write radars/YYYY-MM-DD.md.
7. **Auto deep-dive (spec).** If the top item clears Fit/Opportunity >= 16/20 AND corroboration >= 2, auto-invoke the Research Team decision-brief pattern (rate cap: 1 on-demand / 2 weekly, highest-scored only). Produce a branded concept PDF (What it is / How it works / Fit / Upside / Downside / Challenges / Potential / Build in steps / Verdict) to outputs/alex-ai-radar/YYYY-MM-DD/, plus vault/research/{slug}.md + Notion page. Move the row to "Researched", then STOP. No build/install/spend.
8. **Present** in Alex voice: the ONE item that clears the bar (or "nothing cleared the bar today"), the memory update, any genuinely accelerating theme (after dedup), and a link to any auto concept PDF. Zero-item runs are good.
9. On a Shaheen yes/no/park: append decisions.md (dated), update taste-profile.md, and only THEN advance the Notion status past Researched (auto items) / Interesting.

## Post-Run
- vault/log.md: `## [YYYY-MM-DD HH:MM] alex-radar | {n} scored, {m} presented, {tap}, outcome {x/y}`.
- New companies/people from deep-dives -> vault/business/, vault/people/.
- Refresh status.md snapshot + outcome metric. vault/index.md only for new page types.
- NEVER build, install, deploy, spend, or advance a row past Interesting without an explicit yes.
- **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"project":"radar","metric_key":"shipped_30d","value_num":{outcome metric},"headline":"{today's ONE item, or: nothing cleared the bar}","status":"green"}' || true`
