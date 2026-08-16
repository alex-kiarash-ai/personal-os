# /content-agent - Memory-Fed Building Alex Drafter

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#12 /content-agent · LIVE · Trigger: on-demand + n8n staging (scheduled)**
> Registry: `system/manifest.json` · Spec: `work/12-linkedin-series/CLAUDE.md` · Status: `vault/projects/linkedin-series/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

SOP: work/12-linkedin-series/content-agent.md. HARD RULES: work/12-linkedin-series/CLAUDE.md. Rules win over everything here.

The memory-fed upgrade to /post-episode: it reads what actually landed, ranks hooks with the reasoning shown, drafts in Shaheen's voice behind the #12 gates, and logs results so it compounds. It never posts.

## Draft flow (the main path)
1. Read context: concept.md (locked decisions + never-share list, EVERY run), the material plan (posts-5-12-plan.md), the outcome loop read (`vault/projects/linkedin-series/outcomes/winners.json` + `report-section.md`), and the published episodes as the quality bar.
2. If the weekly focus is ambiguous and not pinned by the material plan, ask one tight round (offer a skip). Otherwise proceed.
3. Generate 8-10 hooks for the chosen material, ranked with rationale + variant tags (hook_type / framing / format / topic). **Cite the loop data INLINE per hook (Phase 2, 2026-07-25):** append each hook's variant evidence from `winners.json` + the per-dim tallies, e.g. "hook_type=contrarian: mean ER 4.2% over 6 resolved (proven)" or "framing=lesson: accumulating 2/4 resolved (soul.md-based, not proven)". If the loop has a cleared winner (>= 4 resolved), lean on it and name the real result. If it is still accumulating, SAY SO on the output: the ranking is soul.md + past posts, not proven numbers.
4. Brand + Soul Pre-Flight Gate (voice output): print the pre-flight line, re-read FULL soul.md (deliberate exception to the gate-40 card rule, 2026-08-16: the LOCKED EPISODE TEMPLATE + the Building Alex public register live deep in the corpus, outside the card's newest-20 slice and the approved pin list). Draft 2-3 posts on the /post-episode quality bar (locked EPISODE TEMPLATE, ~150 words, one thought per line, Built with: footer, 3-4 niche hashtags). English only. Real numbers only.
5. Deterministic dash scan (em/en dash codepoints) + never-share check on every draft. Any hit = rewrite before showing.
6. For each post moving toward posting, register its variant: `node scripts/alex-content-loop.js add --post-id ep-NN --episode NN --title "..." --hook <type> --framing <f> --format <fmt> --topic <t>`.
7. Save to episodes/episode-NN-slug.md + the Content Library row (Draft), STOP for review. Harvest Shaheen's edits into soul.md before Approved. Staging stays /post-publish (Approved-only, n8n).

## Log flow (the 30-second compounding step)
`/content-agent log ep-NN <impressions> <reactions> <comments> [reposts]` runs:
`node scripts/alex-content-loop.js log ep-NN <impressions> <reactions> <comments> [reposts]`
That resolves the row; the next draft run reads the result. Published episodes 01-05 can be backfilled the same way.

## Harvest flow (Phase 1, 2026-07-25 - feed the loop without the human)
`/content-agent harvest` (weekly, read-only claude-in-chrome over Shaheen's OWN posts). For each post still
`pending` in `posts.jsonl` AND posted >= 3 days ago: open Shaheen's LinkedIn post analytics (his session),
read impressions/reactions/comments/reposts off the post's own card, and resolve it via `alex-content-loop.js
log ep-NN ...`. **Read-back verify:** `node scripts/alex-content-loop.js status` must show resolved rose by
the number logged; else PARTIAL + log it. NEVER guess a number Alex cannot read confidently - leave it
pending (phantom-reading discipline). Only Shaheen's own posts, read-only, no writes to LinkedIn. On a
browser wall, file nothing and drop one brief line "content harvest needs a hand". Spec: work/12 CLAUDE.md.

## Post-run
Update vault/projects/linkedin-series/status.md, vault/log.md. Print the close-out line: what was drafted, what got registered, loop state (accumulating / winner).
