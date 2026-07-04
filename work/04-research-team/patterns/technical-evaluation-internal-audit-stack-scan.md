---
class: technical-evaluation
created: 2026-07-02
last_used: 2026-07-02
times_used: 2
---
# Internal audit + stack scan (build-something-on-our-own-system questions)

## Question shape
"We want to build X on top of our own system: what of OURS should feed it, what does our INFRA offer, and what's the best external TOOLING to build it with?" Two internal lanes + one web lane. Fits any feature that consumes existing Personal OS data (dashboard, digest, API, export).

## Team
- Project Auditor: sweep all builds' status.md + specs + vault/log.md; per build report measurable outputs (real example values), source of truth, cadence, tile/feed-worthiness High/Med/Low | tools: Explore (very thorough, read-only) | output: structured table + cross-cutting metrics list
- Infra Auditor: sweep the machinery (scheduler, error-log, n8n configs, hooks, MCP config, vault size, outputs/); report candidate system signals with capture difficulty EASY/MEDIUM/HARD + freshness; file-system evidence only, no external calls | tools: Explore (very thorough) | output: tiered signal table
- Stack Scout: web-only scan of the current tool landscape against an explicit working hypothesis from prior research; 8-12 searches, told to flag contradictions LOUDLY | tools: general-purpose + WebSearch/WebFetch | output: findings per question + URLs + hypothesis flags

## Synthesis approach
Main session decides, agents report. Key move: give the Scout the prior brief's hypothesis to attack, then resolve flags with a documented judgment call (here: kept Next.js over the practitioner-favored Vite SPA because one requirement, AI-compat, needs server routes). Rank internal findings into shipped rows (v1) vs bench (later) so scope stays honest. Confidence levels per lane; unknowns stay named.

## Lessons
- Feeding the Scout a hypothesis to falsify produced sharper findings than open-ended "find the best stack" (it surfaced the Tremor-is-frozen and Serwist/Turbopack traps a generic scan would have missed).
- Explore agents handled the internal audits well and cheaply; no general-purpose needed for read-only sweeps.
- The two internal lanes overlap slightly on run-log data; acceptable, they read it for different purposes (business numbers vs health signals).
- Reuse 2 (2026-07-02, Recovery layer): the pattern also fits "design a missing SYSTEM layer" questions, not just features. Splitting the internal audit into surface-vs-mechanism (what must stay consistent vs what already checks it) gave a clean gap table. Hypothesis-to-attack again outperformed open scanning: the Scout came back with two design corrections (level-triggered, detect-don't-repair) instead of a generic tool list. Internal lanes found the sharpest evidence themselves (drift the system didn't know it had, /lint never executed, no git).
