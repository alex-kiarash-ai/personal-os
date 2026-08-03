# shaheenkiarash.com - Deploy Runbook

**LIVE OPERATIONAL DOC, not history.** Carried into #30 portfolio-site on 2026-08-03 from the retired `work/30-modeling/WEBSITE-DEPLOY.md` (readable at `git show dca7893:work/30-modeling/WEBSITE-DEPLOY.md`). Under amendment A1 the Worker does **not** die: the site keeps serving from it, and the deploy path is being upgraded from hand-run `wrangler` to git-driven CI. Everything below is true today and stays true after the cutover except the "to deploy" section, which CI replaces at B3.

This file seeds the new repo's `deploy/README.md` at B2.

## What serves the site
- **Cloudflare static-assets Worker `plain-block-545a`** (account `36f1f2149fe6965f741e24c40f29c7aa`, zone `ec8e707d1dac7e1f144bfd5c60bd789a`).
- Custom domain: `shaheenkiarash.com -> plain-block-545a`. **The binding is attached to the worker NAME**, so redeploying the same-named worker keeps the domain. This is why hard rule 8 exists.
- No bindings, no server script - pure static assets. Originally created by dashboard drag-drop upload. Three other unused workers sit on the account (`black-disk-9cb8`, `mute-haze-d66d`, `v1`); ignore them.
- Also reachable at `plain-block-545a.shaheen-kiarash.workers.dev`. Same content; `<link rel=canonical>` points search engines at the apex. Optional cleanup: `"preview_urls": false`.
- **The zone also runs Email Routing**, including `shaheen@shaheenkiarash.com`, the site's own contact address. Nothing in this project touches DNS or MX (hard rule 9).

## Current source of truth (until B3 cutover)
- **Live content:** `Desktop\Claude\Modeling\Website-v2-build\` - this folder IS what is deployed.
- **Deploy config, deliberately OUTSIDE the assets folder so it is never served:** `Desktop\Claude\Modeling\deploy-config\wrangler.jsonc`
  ```jsonc
  { "name": "plain-block-545a", "compatibility_date": "2026-05-31", "assets": { "directory": "../Website-v2-build" } }
  ```
- **`.assetsignore`** inside the build folder excludes `.wrangler`, itself, `*.csv`, `.DS_Store`, `Thumbs.db`. It is what stops a stray file going public. Its lesson carries into the new repo as a day-one `.gitignore` plus the license split.
- `Desktop\Claude\Modeling\Website\` is the pre-upgrade content, kept as a local rollback copy.

## After the B3 cutover
Source of truth becomes the public repo at `Desktop\shaheenkiarash.com`. `dist/` is built by GitHub Actions and deployed with `wrangler deploy` to the **same worker name**, using a scoped Cloudflare API token held in Actions secrets. The `Website-v2-build` folder becomes a private archive, not a deploy source.

**The B2 mechanics were resolved 2026-08-03, ahead of the phase, so it starts with no unknowns:**

| Question | Answer | Source |
|---|---|---|
| `cloudflare/wrangler-action` pin | **v4.0.0 = commit `ebbaa1584979971c8614a24965b4405ff95890e0`** (released 2026-05-12; lightweight tag, so that ref IS the commit). Pin the SHA, not the tag, per hard rule 6 | GitHub API, read this session |
| Does `_redirects` work on Workers static assets? | **YES, natively** - "Workers natively supports `_headers` and `_redirects` files for static assets", placed in the assets directory. No assets-router or meta-refresh fallback needed | developers.cloudflare.com/workers/static-assets/redirects |
| Static-site `wrangler.jsonc` shape | No `main`, no Worker script. `assets.directory` plus `not_found_handling: "404-page"` and `html_handling: "auto-trailing-slash"` (the latter matters here: the indexed intent-page URLs carry no trailing slash) | Cloudflare Workers docs |
| API token scope | Account-level **Workers Scripts: Edit**; the dashboard's "Edit Cloudflare Workers" template covers it. **Confirm against the template at creation** - not verified from a primary source, and Shaheen sees the real option names when he makes the token | to confirm |

Concrete config for B2 (worker name kept, per hard rule 8):

```jsonc
{
  "name": "plain-block-545a",
  "compatibility_date": "2026-08-03",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  }
}
```

## To deploy a change (current, hand-run)
1. Edit files in `Website-v2-build\`.
2. `cd Desktop\Claude\Modeling\deploy-config` then `npx wrangler deploy --dry-run` - confirm the file count and that no stray/private file is listed.
3. `npx wrangler deploy` (needs `npx wrangler login` if the token expired).
4. **Verify - "it uploaded" is never done:** curl the live page and hash-compare against the built `index.html`; new assets return 200; guarded/private paths return 404; render both widths and LOOK; test the og share card.

Step 4 is the ritual that becomes the automated post-deploy smoke job in `deploy.yml` (hard rule 7).

## Rollback
- **Fast:** dashboard -> the worker -> Deployments -> pick a prior version -> Rollback. Or `npx wrangler rollback --name plain-block-545a <version-id>`.
- **From disk:** deploy the byte-identical pre-upgrade backup at `Desktop\personal-os-backups\website-2026-07-18\`.

## Version history (the rollback map - keep appending)
| Date | Version id | What |
|---|---|---|
| pre-upgrade | `46fb5323-4db2-4fc9-8659-d1d3045f93d0` | the original site |
| 2026-07-19 | `07007ec5-f4e4-4db7-a1b5-43df53a228dc` | the run-31 upgrade (WebP pass, mobile nav, lightbox, CTA, head tags, client strip, contrast AA) |
| 2026-07-19 | `a0285185` | digitals surgery |
| 2026-07-20 | `dcbe495a-8a67-4ef1-9697-73d62abef591` | digital-6 swap |
| 2026-07-24 | `95486b2a-64e0-41fe-9876-c919c57cd58f` | portfolio expansion, grid 12 -> 26 frames (pre-change copy: `_backups\portfolio-2026-07-24\`) |
| 2026-07-24 | `883d5ac4-fd09-44c7-9694-dc56ded36a8a` | portfolio prune + shuffle, down to the **24-frame curated grid** that stands today (pre-change copy: `_backups\portfolio-2026-07-24b\`) |
| 2026-07-24 | `4a098101-47fd-46e5-9392-bc0eb594b883` | `/digitals` pulled from public view: nav link removed from all 5 headers, dropped from `sitemap.xml`, `.assetsignore` 404s the page and its images. Source files untouched on disk |
| 2026-07-24 | `a89735f0-8905-47dd-a323-8d90178d9f6a` | client swap: Joma out, Shady Rays + Lullevibes in, every "Joma" mention scrubbed site-wide. The 5 tennis frames STAY, relabelled generic "Commercial" (Shaheen's informed call) |
| 2026-07-24 | `13bdbeb0-6899-404d-94f9-867b6a4a9c63` | **In Motion film section published.** Lullevibes brand film, 130 MB source two-pass re-encoded to 18.99 MiB H.264 ~3 Mbps, audio stripped (silent loop), `+faststart`, under the 25 MiB Cloudflare per-file cap. Lazy: `preload="none"` + IntersectionObserver play/pause, `prefers-reduced-motion` shows the poster. VideoObject JSON-LD. Recipe: `ffmpeg -i src -c:v libx264 -b:v 3000k -pass 1/2 -an -movflags +faststart out.mp4` |
| 2026-07-24 | `5e9fb055-649d-4ce6-b29e-8083188c6456` | film moved ABOVE the portfolio grid. Section order: About 01 / Film 02 / Portfolio 03 / Contact 04 |

**The live site as of 2026-08-03** is `5e9fb055`: 4 sections (About / Film / Portfolio / Contact), a 24-frame curated grid, Shady Rays + Lullevibes credited, `/digitals` deliberately 404. That grid is already curated, already rights-vetted, already rule-4 filtered - it is the starting point for the B1 inventory, not a blank page.

## Login note
`wrangler` v4.112.0 installed. Auth today is OAuth via `npx wrangler login`; token cached at `%APPDATA%\Roaming\xdg.config\.wrangler\config\default.toml` (local-only, never commit). **At B2 this is superseded** by a scoped API token in GitHub Actions secrets; the OAuth token can then be revoked (an upgrade: scoped beats account-wide).
