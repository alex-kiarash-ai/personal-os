# Alex HQ - brand & layout guard (QA)

Item 4 of the AI-guide upgrade plan ([[research/alex-upgrade-from-ai-guide]]). An automated regression guard for the HQ dashboard: it catches a broken brand color, a swapped font, an accent-law violation, a collapsed grid, or a missing logo, before a deploy ships it.

## Why this is NOT a pixel-diff (the honest ground truth)
The plan first specified a masked pixel-baseline diff. Running it against the real HQ showed why that is the wrong shape here:
- HQ renders private data from **two dynamic sources**: the server-side Summary/Inbox (env-gated remote fetch) AND the client-fetched `/data/*.json` (all gitignored, real data, personal notes with names and appointments).
- A masked pixel baseline (a) risks leaking a private note the selector-mask missed, and the first attempt DID put personal notes into the baseline, and (b) false-fails every day the content changes.
- A robust pixel diff would need a full **synthetic fixture server** for both sources. That is a real sub-project with schema-drift risk. Deferred as Phase 2 (see below).

So the guard tests the brand and layout **directly, via computed styles and structure**, which are content-independent: it never screenshots private data, it cannot leak, it is stable run to run, and it still catches a real styling regression. Same goal as the plan ("catch a styling / brand / layout regression"), done the safe robust way for this app.

## What it checks (both 390 mobile and 1440 desktop)
- Canvas background is Ink Black `#001219`.
- Kicker font is Chakra Petch; data numerals (`.big`) are IBM Plex Mono (per the HQ instrument-surface brand law).
- The ALEX logo is present and loaded.
- At least 4 tiles render; the content grid is 1-col on mobile and multi-col on desktop (layout not collapsed).
- The one-accent law: golden-orange `#ee9b00` appears but stays sparse (within a calibrated bound), so nobody has turned the dashboard orange.

Expected values live in `EXPECT` at the top of `brand-guard.mjs`, calibrated from the known-good render + `brand/config/color-system.md`. If the brand law changes on purpose, update `EXPECT` (that is the "accept the new look" step). Skill binding: `webapp-testing` (Playwright/puppeteer-core), ADVISORY.

## Run it
```
cd work/16-alex-hq/app
npm run build   # if .next is stale
npm start &     # serves the LOCAL build on :3000 (never point the guard at production)
node ../qa/brand-guard.mjs
```
Exit 0 = PASS, exit 1 = a brand/layout invariant broke (the message names which one and the actual value). It reads only computed styles, so it needs no baseline files and writes nothing to disk.

## Where it belongs (wiring)
Advisory gate in the #16 HQ **deploy Close-Out** (see `work/16-alex-hq/CLAUDE.md`): run it against the local build before a deploy; a FAIL blocks until a human fixes the regression or accepts the new look by updating `EXPECT`. Never blocks a run on its own (ADVISORY), and never touches production.

## Phase 2 (deferred): true pixel-diff on synthetic fixtures
For a pixel-perfect visual regression, stand up a small fixture server that returns synthetic Summary + Inbox JSON and swap `/data/*.json` for fixtures, then run the local build against them (no private data, fully deterministic) and diff masked screenshots. Not built: it needs the full data schema reproduced and kept from drifting. This guard covers the high-value brand/layout regressions in the meantime.

## Reversibility
Delete `work/16-alex-hq/qa/`. No baselines, no cron, no manifest entry, no generated surface.
