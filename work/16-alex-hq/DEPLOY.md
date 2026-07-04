# Alex HQ - Deployment (LIVE since 2026-07-02)

**URL: https://hq.shaheenkiarash.com** · basic auth (creds in `config/hq-basic-auth.txt`, local only) · Cloudflare A record `hq → 62.238.21.62` DNS-only (added by Shaheen 2026-07-02); Caddy auto-issued the Let's Encrypt cert. Old path `n8n.shaheenkiarash.com/hq` 308-redirects here. Verified: n8n untouched 200, bare 401, authed 200, live data + manifest 200. Install on iPhone: open in Safari, log in, Share → Add to Home Screen.

## As deployed (on the box via SSH host alias `n8n` = root@62.238.21.62)
- App source: `/opt/alex-hq` (tar-copied from work/16-alex-hq/app, minus node_modules/.next/.env.local). Root-path build, NO basePath.
- Container: `alex-hq` service in the LIVE compose at **`/opt/n8n/docker-compose.yml`** (NOT /root/n8n — that one is a stale Traefik leftover). Env: `HQ_SUMMARY_URL=http://n8n:5678/webhook/alex-hq-summary` + `HQ_WEBHOOK_BASE=http://n8n:5678/webhook` (both internal network, skip Caddy) + `ALEX_HQ_TOKEN` in `/opt/n8n/.env`.
- **Two-way inbox additions (2026-07-02):** n8n service gained a bind mount `/opt/alex-inbox-audio:/data/inbox-audio` (voice-note audio drop) + env `N8N_RESTRICT_FILE_ACCESS_TO: /data/inbox-audio`. Compose backup before this change: `docker-compose.yml.bak-20260702-inbox`.
- Proxy: `/opt/n8n/Caddyfile` has two site blocks: `hq.shaheenkiarash.com` → `basic_auth` (user shaheen, bcrypt) → `alex-hq:3000`; `n8n.shaheenkiarash.com` → `handle /hq*` 308-redirect to the subdomain + fallback `handle` → `n8n:5678`.
- Backups on box: `docker-compose.yml.bak-20260702`, `Caddyfile.bak-20260702` (pre-alex-hq state).

## Redeploy after app changes
```
cd work/16-alex-hq && tar czf - --exclude=node_modules --exclude=.next --exclude=.env.local app | ssh n8n "rm -rf /opt/alex-hq && mkdir -p /opt/alex-hq && tar xzf - -C /opt/alex-hq --strip-components=1"
ssh n8n "cd /opt/n8n && docker compose up -d --build alex-hq"
```

## Hard-won gotchas (2026-07-02)
- **n8n `:latest` denies Read/Write File node writes to EVERY path by default** — "The file ... is not writable" even on a fresh bind mount the node user owns. It is not filesystem perms (verified with `docker exec -u node touch`); you must allowlist via `N8N_RESTRICT_FILE_ACCESS_TO`. Writing under `/home/node/.n8n` is doubly blocked (config-dir guard) — never disable that one, mount a dedicated dir instead.
- **Never inline a bcrypt hash through an unquoted remote heredoc**: the remote shell eats the `$2a$14$` segments and Caddy fails with "illegal base64 data". Build the Caddyfile locally, `scp` it.
- **Never extract the hash with `grep shaheen`**: the site line `n8n.shaheenkiarash.com {` ALSO contains "shaheen", so awk picks up a stray `{` (bit us on the subdomain flip; validate caught it). Re-hash from the password in config/ instead.
- **Never pipe `caddy validate` to tail and trust `&&`**: the pipe masks the exit code. Validate bare, check output, THEN reload. (Caddy kept serving the old config on every failed reload, so nothing broke, but only by Caddy's grace.)
- Right after a container rebuild the prerendered "Backend unreachable"/stale page may serve for up to `revalidate` (60s); don't panic-debug a fresh deploy, request it again.
- Old headless-Chrome screenshot trap documented here previously: use puppeteer-core viewport emulation for QA (devDependency).

## Hard rule (unchanged)
The app has no built-in auth; the proxy's basic_auth is the ONLY gate. Any Caddyfile change must keep /hq behind auth. Never expose alex-hq:3000 with a `ports:` mapping.
