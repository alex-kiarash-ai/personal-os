# Modeling - code & config (Postiz social engine)

This is the **code/config home** for the Modeling project. Knowledge lives in the vault:
- Tier 1 status: `vault/projects/modeling/status.md`
- Tier 2 infra: `vault/projects/modeling/infrastructure.md`
- Human-readable: `docs/projects/30-modeling.md`

Everything for this one project lives together: this folder (deploy config), the vault pages (status + infra + history), and the manifest entry (`system/manifest.json` numbered project **#30 "modeling"**; promoted from meta.unnumbered 2026-07-18, `git mv work/modeling work/30-modeling`). Shaheen's call, 2026-07-15: one project, one place. The last stray file left behind in the old `work/modeling/` path (`WEBSITE-DEPLOY.md`, written there 2026-07-19) was folded in here 2026-07-20; `work/modeling/` no longer exists.

## What this runs
**Postiz** (self-hosted, open-source, `gitroomhq/postiz-app`, AGPL-3.0, ~33k stars) as the Instagram content engine for @shaheen.kiarash: writes captions (Claude, in Shaheen's voice), plans a visual calendar, and **auto-publishes the approved queue on schedule**.

### The autonomy rule (do not break without an explicit call)
- **Auto mode = auto-PUBLISH only.** Shaheen approves a batch of posts in the calendar, Postiz posts them on schedule with no further clicks.
- **No auto-engagement.** No auto-DM, auto-comment, auto-like, auto-follow. Engagement stays a read-only digest that Shaheen replies to by hand. This is the standing Modeling-project rule and it is the one line that keeps a real booking account from tripping Instagram's bot detection and getting nuked. Turning it off is a separate, explicit decision with a ban-risk warning.

## Why self-hosted Postiz
Chosen from a 4-way comparison (Postiz vs own-n8n vs Mixpost vs Metricool) under: drafts-then-approve, ~0-150 SEK/mo, self-host on infra already paid for. Postiz won on being the most-used IG-capable self-hosted tool with an agent/MCP layer that hooks into the existing n8n. Full comparison: the approved plan + `vault/projects/modeling/status.md`.

## Files here
- `docker-compose.reference.yml` - **REFERENCE ONLY.** Postiz changes services/images/env between releases; at deploy time clone the canonical `gitroomhq/postiz-docker-compose` and reconcile against it. This file is the shape to expect, not the source of truth.
- `postiz.env.example` - env template. Copy to `config/postiz.env` (gitignored via `work/*/config/`), fill real values, never commit it.
- `.gitignore` - keeps `config/`, data dirs, and any `.env` local.
- `WEBSITE-DEPLOY.md` - the **shaheenkiarash.com** deploy runbook (Cloudflare static-assets Worker + wrangler + rollback). Not Postiz: this is the portfolio website's ship path, kept in the same project home per "one project, one place".

## Stand-up (mostly Shaheen's hands - see the "Waiting on you" queue)
1. **DNS:** point `social.shaheenkiarash.com` -> the Hetzner box `62.238.21.62` (Cloudflare, proxied). One A record.
2. **Secrets:** `cp postiz.env.example config/postiz.env`, then set a long random `JWT_SECRET`, a DB password, and the URLs. Also drop the passphrase/secrets into the password manager.
3. **Deploy:** on the box, `docker compose -f docker-compose.reference.yml --env-file config/postiz.env up -d` (after reconciling with the canonical repo). Reverse-proxy `social.shaheenkiarash.com` -> port 4007 with TLS (Caddy/Traefik already on the box for the other subdomains).
4. **Instagram connect:** Postiz publishes via the Instagram Graph API, which requires an **Instagram Business or Creator account linked to a Facebook page**. Convert @shaheen.kiarash to Business/Creator and link a page first, or the connect step fails. Then add the Facebook app credentials to `config/postiz.env` and connect IG inside Postiz.
5. **Voice wiring:** captions are drafted by Claude in Shaheen's voice. Any caption generation runs the Brand + Soul pre-flight gate (read `brand/config/brand-config.md` + `soul.md` first). Postiz's agent CLI / MCP is the hook; it can also be driven from the existing n8n on the same box.
6. **Turn on auto-publish:** approve the content queue once, Postiz posts on schedule. Leave engagement as a read-only digest.
7. **Later:** layer the own-n8n audience/lead-gen workflows from `vault/projects/modeling/infrastructure.md` (the part Postiz can't do: prospect/hashtag/competitor research and outreach drafts).

## Verify after deploy (not "it returned 200")
- Schedule a real test post, confirm Postiz **auto-publishes it at the set time** and it appears live on IG, then read the post status back. Only then is auto-publish "on".
- Confirm the IG account is Business/Creator + page-linked before wiring (silent failure otherwise).

## Cost
0 SEK/mo new. Runs on the Hetzner box (EUR 9.99/mo, already paid) alongside n8n. Postiz self-hosted is free.
