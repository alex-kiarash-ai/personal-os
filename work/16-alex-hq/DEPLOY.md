# Alex HQ - Deployment (LIVE since 2026-07-02)

**URL: https://hq.shaheenkiarash.com** · basic auth (creds in `config/hq-basic-auth.txt`, local only) · Cloudflare A record `hq → 62.238.21.62` DNS-only (added by Shaheen 2026-07-02); Caddy auto-issued the Let's Encrypt cert. Old path `n8n.shaheenkiarash.com/hq` 308-redirects here. Verified: n8n untouched 200, bare 401, authed 200, live data + manifest 200. Install on iPhone: open in Safari, log in, Share → Add to Home Screen.

## As deployed (on the box via SSH host alias `n8n` = root@62.238.21.62)
- App source: `/opt/alex-hq` (tar-copied from work/16-alex-hq/app, minus node_modules/.next/.env.local). Root-path build, NO basePath.
- Container: `alex-hq` service in the LIVE compose at **`/opt/n8n/docker-compose.yml`** (NOT /root/n8n - that one is a stale Traefik leftover). Env: `HQ_SUMMARY_URL=http://n8n:5678/webhook/alex-hq-summary` + `HQ_WEBHOOK_BASE=http://n8n:5678/webhook` (both internal network, skip Caddy) + `ALEX_HQ_TOKEN` in `/opt/n8n/.env`.
- **Two-way inbox additions (2026-07-02):** n8n service gained a bind mount `/opt/alex-inbox-audio:/data/inbox-audio` (voice-note audio drop) + env `N8N_RESTRICT_FILE_ACCESS_TO: /data/inbox-audio`. Compose backup before this change: `docker-compose.yml.bak-20260702-inbox`.
- Proxy: `/opt/n8n/Caddyfile` has two site blocks: `hq.shaheenkiarash.com` → `basic_auth` (user shaheen, bcrypt) → `alex-hq:3000`; `n8n.shaheenkiarash.com` → `handle /hq*` 308-redirect to the subdomain + fallback `handle` → `n8n:5678`.
- Backups on box: `docker-compose.yml.bak-20260702`, `Caddyfile.bak-20260702` (pre-alex-hq state).

## Redeploy after app changes
```
cd work/16-alex-hq && tar czf - --exclude=node_modules --exclude=.next --exclude=.env.local app | ssh n8n "rm -rf /opt/alex-hq && mkdir -p /opt/alex-hq && tar xzf - -C /opt/alex-hq --strip-components=1"
ssh n8n "cd /opt/n8n && docker compose up -d --build alex-hq"
```

## Hard-won gotchas (2026-07-02)
- **n8n `:latest` denies Read/Write File node writes to EVERY path by default** - "The file ... is not writable" even on a fresh bind mount the node user owns. It is not filesystem perms (verified with `docker exec -u node touch`); you must allowlist via `N8N_RESTRICT_FILE_ACCESS_TO`. Writing under `/home/node/.n8n` is doubly blocked (config-dir guard) - never disable that one, mount a dedicated dir instead.
- **Never inline a bcrypt hash through an unquoted remote heredoc**: the remote shell eats the `$2a$14$` segments and Caddy fails with "illegal base64 data". Build the Caddyfile locally, `scp` it.
- **Never extract the hash with `grep shaheen`**: the site line `n8n.shaheenkiarash.com {` ALSO contains "shaheen", so awk picks up a stray `{` (bit us on the subdomain flip; validate caught it). Re-hash from the password in config/ instead.
- **Never pipe `caddy validate` to tail and trust `&&`**: the pipe masks the exit code. Validate bare, check output, THEN reload. (Caddy kept serving the old config on every failed reload, so nothing broke, but only by Caddy's grace.)
- Right after a container rebuild the prerendered "Backend unreachable"/stale page may serve for up to `revalidate` (60s); don't panic-debug a fresh deploy, request it again.
- Old headless-Chrome screenshot trap documented here previously: use puppeteer-core viewport emulation for QA (devDependency).

## Local-QA gotcha (learned 2026-07-25, the round-2 build)
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
The 2026-07-29 reskin is live: DARK default (the pre-reskin tokens verbatim - his call after seeing the
light renders), the measured light theme behind the header toggle, Oxanium / Instrument Sans / Martian
Mono (D6 as replaced), the WebGL 3D Brain (react-force-graph-3d + three - the box build pulls the new
deps from package.json), CSS tilt/parallax. Live-verified real-browser **11/11** at 390 + 1440 (fresh
opens DARK with nothing stored, toggle flips + persists, 3D mounts both widths); bare 401 / authed 200;
n8n untouched. **Rollback copy on the box: `/opt/alex-hq.bak-20260729`** (the round-2 build; restore it,
then `docker compose up -d --build alex-hq`). Live shots: `outputs/alex-hq/2026-07-29/live-*.png`.
Verify gotcha recorded: a toggle test STORES its theme in the shared headless profile and poisons the
next probe's "default" - clear localStorage per probe or the dark-default check fails against the test's
own leftovers (it did, once, here).

## Round-2 design overhaul: DEPLOYED 2026-07-25 (Shaheen: "deploy")
All 21 items of `outputs/research-team/2026-07-25/alex-hq-design-overhaul-plan-v2.md` are live.
Live-verified with a real browser at 390 + 1440 including both drill-downs: **13/13** (verdict line,
luminance ladder, mobile fold 517px, strip naming its item, Custard 24px count, Send armed orange, graph
veil, 6-track brain strip, period suffixes, 36px overlay numerals, no white focus ring, 5/5 idle dots,
state-not-colour aria). Bare 401 / authed 200 re-checked; n8n untouched (200).
**Rollback copy on the box: `/opt/alex-hq.bak-20260725`** (restore it, then
`docker compose up -d --build alex-hq`). Renders: `outputs/alex-hq/2026-07-25/live-*.png`.

**Post-rebuild "Backend unreachable" is EXPECTED, not a fault.** The page is statically prerendered during
`docker build`, where the build stage cannot reach the `n8n` service, so the fallback gets baked in. At
runtime ISR serves that stale prerender on the first hit past the window and regenerates behind it: the
NEXT request is live. Do not roll back on the first response. (Same stale-serve mechanic the R2-1 client
double-refresh fix exists for.) Confirm with a second request before diagnosing anything.

## Hard rule (unchanged)
The app has no built-in auth; the proxy's basic_auth is the ONLY gate. Any Caddyfile change must keep /hq behind auth. Never expose alex-hq:3000 with a `ports:` mapping.
