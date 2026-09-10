# Alex HQ - Deployment

**What actually serves `hq.shaheenkiarash.com` (measured on the wire 2026-09-09 and 2026-09-10, stress-test
A16-T24 / A09-T1 / A09-T24): the Hetzner box, Docker, Caddy reverse proxy with `basic_auth`, answering 401 at
the door.** Until 2026-09-10 this file said that deploy was retired and that Vercel was the current home. Both
halves were wrong on the wire, and the second was dangerous, see the next paragraph.

**The Vercel project `taraz/alex-hq` (org `taraz`, project id `prj_zsRRUoOSTwa88fnQHs1SgirMVda0`) is an
UNPROTECTED SNAPSHOT, not a deploy.** It was connected on 2026-08-04 and has served the whole dashboard build of
that day (verdict line, waiting strip, inbox notes, kr amounts, health words) to anyone holding the URL, with no
login, ever since (stress-test A09-T25, FAIL Critical; verified 2026-09-10: HTTP 200, no challenge). The URL is
deliberately not written in this file any more. Until Shaheen turns on Vercel Deployment Protection or deletes
the project (queued `hq-vercel-public-snapshot`, critical), every Vercel URL of this project is public. The
monthly security sweep's S10 probes each surface listed in the gitignored `work/16-alex-hq/config/public-surfaces.json`
and reports a FINDING on any that answers 200 without a challenge; that list carries this one and the live door.

- **Source:** the Next.js app left this repo on 2026-08-04 (`e274c75`) for a sibling repo (`../alex-hq` by the
  manifest's `meta.paths.alex_hq_repo`). On this machine that path holds only `public/data/` with no git; the
  running site's source is recoverable at `e274c75^` (46 files, waiver `V8-hq-repo-absent` until 2026-09-30).
  Four documents described four deploys before 2026-09-10; this paragraph is the one that matches the wire.
- (Vercel CLI note, kept for whenever the project is protected or rebuilt: `vercel deploy` cuts a *preview*
  deployment except on a project's first-ever deploy, which Vercel auto-promotes to production regardless of flag.)
- **Env vars** (set on the Vercel project, not committed - `vercel env add` per environment):
  `HQ_SUMMARY_URL`, `HQ_WEBHOOK_BASE`, `ALEX_HQ_TOKEN`, pointed at the **public** n8n webhooks
  (`https://n8n.shaheenkiarash.com/...`) - not the old Docker-internal `http://n8n:5678` addresses,
  which only resolved inside the Hetzner box's compose network and are unreachable from Vercel.

> **The website moved out of this repo on 2026-08-04**, then flattened its own `app/` subfolder into
> its repo root the same day. It lives in its own repo, a SIBLING of personal-os (`../alex-hq` by
> default; the authoritative pointer is `system/manifest.json` → `meta.paths.alex_hq_repo`, resolved
> by `scripts/lib/alex_paths.py` and `work/16-alex-hq/scripts/lib/paths.mjs`). What stayed here: this
> file, CLAUDE.md, `scripts/`, and the gitignored `config/`.

## Open items (still open 2026-09-10)
- **No app-layer auth.** Caddy's `basic_auth` on the box is the ONLY gate on the live deploy and the app has
  none of its own (08-05 pen test P-44). Vercel has no drop-in equivalent, which is exactly why the Vercel
  snapshot above is public.
- **No custom domain on Vercel, and no decision to move.** The box serves the domain today. Pointing
  `hq.shaheenkiarash.com` at Vercel is a decision for after an app-layer auth story exists, not before.
- **Data path.** The live deploy volume-mounts `/opt/alex-hq-data` (scp'd by `scripts/hq_harvest_push.py`,
  re-shipped by the self-heal loop) over the container's `public/data`, so a data refresh needs no rebuild. A
  Vercel deploy serves whatever was baked at build time, which is why the snapshot is frozen at 2026-08-04.

## Local-QA gotcha (learned 2026-07-25, the round-2 build; not deploy-target-specific)
`pkill -f "next-server"` does NOT free port 3000 on Windows. If the old server survives a rebuild, `npm start`
silently fails with EADDRINUSE and the SURVIVING server keeps serving HTML that points at CSS chunk filenames
the new build renamed - so the page renders **completely unstyled**. That looks exactly like a catastrophic
brand regression and cost this session a round of chasing six phantom QA failures. Kill by port first:
```
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select -Expand OwningProcess -Unique | ForEach { Stop-Process -Id $_ -Force }
```
Then prove the stylesheet actually resolves before trusting ANY styling QA result: pull the
`_next/static/chunks/*.css` href out of the served HTML and `curl` it, expecting 200.

## 3D reskin: DEPLOYED 2026-07-29 (Shaheen: "Go back to the same colors, apply the new design and deploy")
The 2026-07-29 reskin went live on the (since-retired) Hetzner deploy: DARK default (the pre-reskin
tokens verbatim - his call after seeing the light renders), the measured light theme behind the header
toggle, Oxanium / Instrument Sans / Martian Mono (D6 as replaced), the WebGL 3D Brain
(react-force-graph-3d + three), CSS tilt/parallax. Live-verified real-browser **11/11** at 390 + 1440
(fresh opens DARK with nothing stored, toggle flips + persists, 3D mounts both widths). Live shots:
`outputs/alex-hq/2026-07-29/live-*.png`. Verify gotcha recorded: a toggle test STORES its theme in the
shared headless profile and poisons the next probe's "default" - clear localStorage per probe or the
dark-default check fails against the test's own leftovers (it did, once, here).

## Round-2 design overhaul: DEPLOYED 2026-07-25 (Shaheen: "deploy")
All 21 items of `outputs/research-team/2026-07-25/alex-hq-design-overhaul-plan-v2.md` went live on the
(since-retired) Hetzner deploy. Live-verified with a real browser at 390 + 1440 including both
drill-downs: **13/13** (verdict line, luminance ladder, mobile fold 517px, strip naming its item,
Custard 24px count, Send armed orange, graph veil, 6-track brain strip, period suffixes, 36px overlay
numerals, no white focus ring, 5/5 idle dots, state-not-colour aria). Renders: `outputs/alex-hq/2026-07-25/live-*.png`.

**Post-rebuild "Backend unreachable" was EXPECTED on the old Docker deploy, not a fault** - the page was
statically prerendered during `docker build`, where the build stage couldn't reach the `n8n` service by
its internal hostname, so the fallback got baked in; the next request past the ISR window regenerated
it live. **Unverified whether this still applies on Vercel**: the build now points at the *public*
`https://n8n.shaheenkiarash.com` webhook rather than an internal Docker-network hostname, so the build
step may simply reach it directly. Re-check on the next deploy before assuming either way.
