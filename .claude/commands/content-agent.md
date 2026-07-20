# /content-agent - Memory-Fed Building Alex Drafter

SOP: work/12-linkedin-series/content-agent.md. HARD RULES: work/12-linkedin-series/CLAUDE.md. Rules win over everything here.

The memory-fed upgrade to /post-episode: it reads what actually landed, ranks hooks with the reasoning shown, drafts in Shaheen's voice behind the #12 gates, and logs results so it compounds. It never posts.

## Draft flow (the main path)
1. Read context: concept.md (locked decisions + never-share list, EVERY run), the material plan (posts-5-12-plan.md), the outcome loop read (`vault/projects/linkedin-series/outcomes/winners.json` + `report-section.md`), and the published episodes as the quality bar.
2. If the weekly focus is ambiguous and not pinned by the material plan, ask one tight round (offer a skip). Otherwise proceed.
3. Generate 8-10 hooks for the chosen material, ranked with rationale + variant tags (hook_type / framing / format / topic). If the loop has a cleared winner (>= 4 resolved), lean on it and name the real result. If it is still accumulating, SAY SO on the output: the ranking is soul.md + past posts, not proven numbers.
4. Brand + Soul Pre-Flight Gate (voice output): print the pre-flight line, re-read soul.md. Draft 2-3 posts on the /post-episode quality bar (locked EPISODE TEMPLATE, ~150 words, one thought per line, Built with: footer, 3-4 niche hashtags). English only. Real numbers only.
5. Deterministic dash scan (em/en dash codepoints) + never-share check on every draft. Any hit = rewrite before showing.
6. For each post moving toward posting, register its variant: `node scripts/alex-content-loop.js add --post-id ep-NN --episode NN --title "..." --hook <type> --framing <f> --format <fmt> --topic <t>`.
7. Save to episodes/episode-NN-slug.md + the Content Library row (Draft), STOP for review. Harvest Shaheen's edits into soul.md before Approved. Staging stays /post-publish (Approved-only, n8n).

## Log flow (the 30-second compounding step)
`/content-agent log ep-NN <impressions> <reactions> <comments> [reposts]` runs:
`node scripts/alex-content-loop.js log ep-NN <impressions> <reactions> <comments> [reposts]`
That resolves the row; the next draft run reads the result. Published episodes 01-05 can be backfilled the same way.

## Post-run
Update vault/projects/linkedin-series/status.md, vault/log.md. Print the close-out line: what was drafted, what got registered, loop state (accumulating / winner).
