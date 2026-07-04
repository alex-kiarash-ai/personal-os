# /content-machine - Create Platform-Native Content in Shaheen's Voice

Spec: work/09-content-machine/CLAUDE.md (read it first). On-demand. 3-agent pipeline.

## Step 0 — Context first (before asking anything)
Read: vault/me/goals.md, vault/business/brand.md + vault/business/, vault/research/, vault/people/, vault/projects/content-machine/status.md, soul.md, vault/me/writing-style-notes.md, brand/config/brand-config.md. notion-search the Content Library for past content on the topic (don't repeat angles).
Then ask AT MOST 1-2: the opinion/hot-take angle, and which platforms (if unspecified). Rich vault context on the topic → skip straight to creation.

## Pipeline
1. **Researcher** (sub-agent): read the source deeply + WebSearch. Output a brief built on the single insight worth sharing (claims, data, quotes, frameworks, counterintuitive angle). Not a summary.
2. **Writer:** brief + soul.md → one piece per requested platform, each in its real format (X thread / LinkedIn / IG caption / TikTok script / newsletter / blog — structures in spec).
3. **Editor:** load soul.md + writing-style-notes. Hard checks: no em-dashes, no filler, no parallel triplets, no uniform sentence length, no hollow enthusiasm. Rewrite anything AI-sounding. Must pass as human.

## Save (3 places)
- **Notion Content Library** (id in status.md): one row per piece with ALL metadata (Platform/Type/Pillar/Idea/Source/Target Audience/Status=Draft/Publish Date if known). FULL content in page body under `## {Platform}` headers.
- **Vault:** vault/projects/content-machine/kits/YYYY-MM-DD-{topic}.md (all pieces + metadata, [[links]] to research/business).
- **Files:** outputs/content-machine/YYYY-MM-DD-{topic}/ — one .md per platform.

## Post-Run
- New data/insight → vault/research/. New people/companies → vault/people/ or vault/business/.
- Edits/rejections → vault/me/writing-style-notes.md.
- status.md (kits index, pillars/platforms covered) + vault/index.md + vault/log.md.
- Do NOT re-mark the sprint row (Done at build). Keep only per-platform .md in the output folder.
