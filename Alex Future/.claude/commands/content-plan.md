# /content-plan - Plan the Content Calendar

Spec: work/09-content-machine/CLAUDE.md (read it first). On-demand. Pairs with /content-machine.

## Step 0 - Context first
Read: vault/me/goals.md, vault/business/ (products, launches, positioning), vault/research/ (topics that could become content), vault/projects/content-machine/ (already created/planned), vault/business/competitors/ (if present - counter-position/fill gaps; skip gracefully if not built). notion-search the Content Library for what's already planned/published.

## Ask only what's needed
1. "How many weeks?" (can't infer)
2. If goals.md shows an upcoming launch/milestone: suggest, don't ask - "I see {launch} coming. Want content planned around it?"
3. If posting cadence isn't established: "How often per platform?"

## Plan
- Find gaps: empty days, underserved platforms, pillars with no recent posts.
- Propose topics as a TABLE: Title · Platform · Type · Pillar · Idea/angle · Source · Suggested Publish Date.
- User approves / edits / rejects each.
- Approved → Content Library row, Status **Idea**, with the publish date (full metadata; body can be a stub until /content-machine fills it).
- For each approved topic, tell the user: "Run /content-machine with '{topic}' to create the content."

## Notion
- Content Library db_id/data_source in vault/projects/content-machine/status.md. Calendar / Pipeline / By Platform / This Week views already exist.

## Post-Run
- status.md (planned items) + vault/log.md. No sprint re-mark.
