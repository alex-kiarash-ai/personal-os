# shaheenkiarash.com — Deploy Runbook

**Home: `work/30-modeling/` (project #30).** Written 2026-07-19 into the retired pre-promotion path `work/modeling/`; folded into #30 on 2026-07-20 (that folder no longer exists).

**Discovered + first used 2026-07-19** (closes the run-31 "deploy path UNDOCUMENTED" gap). This is how the modeling website ships. The #30 monthly strategy reviewer (step H, CLAUDE.md) uses this exact path for its `/now` rebuild + `wrangler deploy`.

## What serves the site
- **Cloudflare static-assets Worker** named **`plain-block-545a`** (account `36f1f2149fe6965f741e24c40f29c7aa`, zone `ec8e707d1dac7e1f144bfd5c60bd789a`).
- Custom domain binding: `shaheenkiarash.com -> plain-block-545a` (in Cloudflare → Workers & Pages → Custom Domains). The binding is attached to the worker NAME, so redeploying the same-named worker keeps the domain.
- No bindings, no server script — pure static assets. Originally created via dashboard **upload** (drag-drop). There are 3 other unused workers on the account (black-disk-9cb8, mute-haze-d66d, v1); ignore them.
- Also reachable at `plain-block-545a.shaheen-kiarash.workers.dev` (workers.dev preview URL, enabled by default). Same public content; `<link rel=canonical>` in the HTML points search engines at the apex domain. Optional cleanup: add `"preview_urls": false` to the config to turn the workers.dev URL off.

## Source of truth (local)
- **Live content:** `Desktop\Claude\Modeling\Website-v2-build\` — this folder IS what's deployed. Edit here.
- **Deploy config (kept OUTSIDE the assets folder so it never gets served):** `Desktop\Claude\Modeling\deploy-config\wrangler.jsonc`:
  ```jsonc
  { "name": "plain-block-545a", "compatibility_date": "2026-05-31", "assets": { "directory": "../Website-v2-build" } }
  ```
- **`.assetsignore`** inside the build folder excludes `.wrangler`, `.assetsignore` itself, `*.csv`, `.DS_Store`, `Thumbs.db` from being served. Keep it — it's what stops a stray file going public.
- The old `Desktop\Claude\Modeling\Website\` folder is the PRE-upgrade content (now superseded by the build). Kept as a local rollback copy only.

## To deploy a change
1. Edit files in `Website-v2-build\`.
2. `cd Desktop\Claude\Modeling\deploy-config` then `npx wrangler deploy --dry-run` — confirm the file count and that no stray/private file is listed.
3. `npx wrangler deploy` (needs `npx wrangler login` first if the token expired).
4. **Verify (never "it uploaded" = done):** `curl` the live page and hash-compare to the built `index.html`; check new asset files return 200 and any guard/private file returns 404; render both widths and LOOK; test the og-image share-card.

## Rollback (two ways)
- **Fast:** Cloudflare dashboard → the worker → Deployments → pick a prior version → Rollback. Or `npx wrangler rollback --name plain-block-545a <version-id>`.
- **From disk:** deploy the byte-identical pre-upgrade backup at `Desktop\personal-os-backups\website-2026-07-18\`.
- Version history: pre-upgrade live = `46fb5323-4db2-4fc9-8659-d1d3045f93d0`; the 2026-07-19 upgrade = `07007ec5-f4e4-4db7-a1b5-43df53a228dc`.

## Login note
`wrangler` is installed (v4.112.0). Auth is OAuth via `npx wrangler login` (browser). Token cached at `%APPDATA%\Roaming\xdg.config\.wrangler\config\default.toml` (local-only, gitignored territory — never commit it).
