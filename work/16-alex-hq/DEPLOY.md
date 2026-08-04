# Alex HQ - Deployment

**Deploys automatically via Vercel on every push to `main`** of the **alex-hq repo** (GitHub-connected;
set up 2026-08-04). No manual redeploy step - no Dockerfile, no SSH, no `docker compose`. Push, wait for
the build, done. (The CLI note worth knowing: `vercel deploy` cuts a *preview* deployment except on a
project's first-ever deploy, which Vercel auto-promotes to production regardless of the flag used.)

- **Vercel project:** `taraz/alex-hq` (org `taraz`, project id `prj_zsRRUoOSTwa88fnQHs1SgirMVda0`).
- **Current deploy URL:** https://alex-hq-sigma.vercel.app (Vercel-assigned; no custom domain yet).
- **Env vars** (set on the Vercel project, not committed - `vercel env add` per environment):
  `HQ_SUMMARY_URL`, `HQ_WEBHOOK_BASE`, `ALEX_HQ_TOKEN`, pointed at the **public** n8n webhooks
  (`https://n8n.shaheenkiarash.com/...`) - not the old Docker-internal `http://n8n:5678` addresses,
  which only resolved inside the Hetzner box's compose network and are unreachable from Vercel.

> **The website moved out of this repo on 2026-08-04**, then flattened its own `app/` subfolder into
> its repo root the same day. It lives in its own repo, a SIBLING of personal-os (`../alex-hq` by
> default; the authoritative pointer is `system/manifest.json` → `meta.paths.alex_hq_repo`, resolved
> by `scripts/lib/alex_paths.py` and `work/16-alex-hq/scripts/lib/paths.mjs`). What stayed here: this
> file, CLAUDE.md, `scripts/`, and the gitignored `config/`.

## Open items (moved off Hetzner 2026-08-04, not yet reconciled)
The prior deploy (Hetzner box, Docker, Caddy reverse proxy at `hq.shaheenkiarash.com`) is retired; its
box-specific gotchas (Caddyfile bcrypt quoting, n8n file-access allowlisting, the `/opt/alex-hq-data`
volume mount, rollback-copy-on-the-box) no longer apply and were removed from this file. Three things
that setup handled and Vercel does not yet:
- **No auth gate.** Caddy's `basic_auth` was the ONLY thing standing between the internet and this
  dashboard's real personal data (notes, appointments, metrics). Vercel has no drop-in equivalent -
  **the app itself still has no built-in auth.** Do not treat the current Vercel URL as the real
  production home until an auth story exists (Vercel Deployment Protection, a middleware password
  gate, etc.) - right now it is a bare public URL.
- **No custom domain.** `hq.shaheenkiarash.com` still needs pointing at Vercel (or a new subdomain
  chosen) once the auth gap above is closed.
- **Data-serving mechanism unverified.** The old setup volume-mounted `/opt/alex-hq-data` (scp'd by
  personal-os's build scripts) over the container's `public/data`, so a data refresh needed NO
  rebuild. `public/data/*.json` is gitignored, so a Vercel deploy today serves whatever was baked into
  the last build, not a live-updating volume - a data refresh with no code change currently does
  nothing until the next deploy. Needs a decision: commit the JSON per push, an API route reading from
  Vercel Blob, or something else.

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
