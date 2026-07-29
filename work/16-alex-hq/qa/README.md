# Alex HQ - brand & layout guard (QA)

Item 4 of the AI-guide upgrade plan ([[research/alex-upgrade-from-ai-guide]]). An automated regression guard for the HQ dashboard: it catches a broken brand color, a swapped font, an accent-law violation, a collapsed grid, a missing logo, a flattened luminance ladder, or a broken theme default, before a deploy ships it.

**Rewritten 2026-07-29 for the two-theme reskin (defaults reversed same day, Shaheen: "Go back to the same colors").** DARK is the DEFAULT canvas (Ink Black, the pre-reskin tokens) with the measured light theme behind the manual toggle; the guard probes BOTH themes at both viewports (4 probes), selecting each theme the way the real toggle does - `localStorage("hq-theme")` - so the pre-paint theme script is exercised too. A page that opens light with nothing stored fails the dark probe's canvas assertion. Harness rule learned live: clear storage per probe - a toggle test that STORES a theme poisons the next probe's "default" path (it did, once, in the deploy verify).

## Why this is NOT a pixel-diff (the honest ground truth)
The plan first specified a masked pixel-baseline diff. Running it against the real HQ showed why that is the wrong shape here:
- HQ renders private data from **two dynamic sources**: the server-side Summary/Inbox (env-gated remote fetch) AND the client-fetched `/data/*.json` (all gitignored, real data, personal notes with names and appointments).
- A masked pixel baseline (a) risks leaking a private note the selector-mask missed, and the first attempt DID put personal notes into the baseline, and (b) false-fails every day the content changes.
- A robust pixel diff would need a full **synthetic fixture server** for both sources. That is a real sub-project with schema-drift risk. Deferred as Phase 2 (see below).

So the guard tests the brand and layout **directly, via computed styles and structure**, which are content-independent: it never screenshots private data, it cannot leak, it is stable run to run, and it still catches a real styling regression. Same goal as the plan ("catch a styling / brand / layout regression"), done the safe robust way for this app.

## What it checks (390 mobile + 1440 desktop, in light AND dark)
- The theme actually applies per probe (`data-theme` on the root): nothing stored = DARK (the default), stored "light" = light. A broken default or a dead toggle path fails here.
- Canvas per theme: Ink Black `#001219` (dark, the default) / white `#ffffff` (light, law §3).
- Kicker font is Oxanium; data numerals (`.big`) are Martian Mono (D6 as replaced 2026-07-29 in brand-config.md).
- The ALEX logo is present and loaded.
- At least 4 tiles render; the content grid is 1-col on mobile and multi-col on desktop (layout not collapsed).
- The one-accent law: golden-orange `#ee9b00` appears but stays sparse (within a calibrated bound), so nobody has turned the dashboard orange.
- **The luminance ladder, per theme** (the R2-4 invariant, direction preserved in both themes: healthy faces read BRIGHTER than alarm faces). Measured on the declared `--card`/`--elev` tokens, not sampled pixels. Light band: healthy >= 250 / alarm <= 248 / gap >= 6 (reference: white 255.0 vs Warm Cream 245.7). Dark band: healthy >= 38 / alarm <= 29 / gap >= 8 (reference: 42.7 vs 28.4 - alarm faces must STAY at `#00232e` or the D7 burn numerals lose the only ground they clear). A future flatten in either theme fails the guard.
- The hybrid-3D contract: a WebGL canvas is mounted inside `.brain-wrap` (the ONE WebGL surface).

Expected values live in `EXPECT` at the top of `brand-guard.mjs`, calibrated from the known-good render + `brand/config/color-system.md` + the D6/D7 deviations in `brand-config.md`. If the brand law changes on purpose, update `EXPECT` (that is the "accept the new look" step). Parser note: the production bundle minifies `#ffffff` to `#fff` (Lightning CSS), so the guard's luma parser accepts shorthand hex - keep it that way.

## Run it
```
cd work/16-alex-hq/app
npm run build   # if .next is stale
npm start &     # serves the LOCAL build on :3000 (never point the guard at production)
node ../qa/brand-guard.mjs
```
Exit 0 = PASS, exit 1 = a brand/layout invariant broke (the message names which one and the actual value). It reads only computed styles, so it needs no baseline files and writes nothing to disk. Port gotcha: if :3000 is already held, kill BY PORT (`Get-NetTCPConnection -LocalPort 3000`) - a surviving old server serves stale chunk names and fakes a catastrophic regression (DEPLOY.md, learned 2026-07-25).

## Render harness: `render-shots.mjs` (permanent tool, added 2026-07-29)
Every design wave used to re-write its screenshot script ad hoc; this is the reusable one. Shoots the LOCAL build at 390 + 1440 in both themes (full page + first fold) into a dated outputs folder, step-scrolling so `whileInView` reveals fire and dwelling so the 3D brain settles:
```
cd work/16-alex-hq/app
node ../qa/render-shots.mjs ../../../outputs/alex-hq/YYYY-MM-DD [prefix]
```
Renders contain real private data - they belong in `outputs/` (gitignored), never in the repo.

## Where it belongs (wiring)
Advisory gate in the #16 HQ **deploy Close-Out** (see `work/16-alex-hq/CLAUDE.md`): run it against the local build before a deploy; a FAIL blocks until a human fixes the regression or accepts the new look by updating `EXPECT`. Never blocks a run on its own (ADVISORY), and never touches production.

## Phase 2 (deferred): true pixel-diff on synthetic fixtures
For a pixel-perfect visual regression, stand up a small fixture server that returns synthetic Summary + Inbox JSON and swap `/data/*.json` for fixtures, then run the local build against them (no private data, fully deterministic) and diff masked screenshots. Not built: it needs the full data schema reproduced and kept from drifting. This guard covers the high-value brand/layout regressions in the meantime.

## Reversibility
Delete `work/16-alex-hq/qa/`. No baselines, no cron, no manifest entry, no generated surface.
