# Postiz deploy runbook (dedicated CX33 box)

Status: **STAGED 2026-07-18, deploy BLOCKED on a new CX33 box being created.** Secrets generated
(`config/postiz.env`), production override + Caddyfile written. Run + **validate every step on the
live box** - the compose could not be tested locally.

## Why this exists / the two decisions
1. **Postiz re-architected around Temporal.** The old `docker-compose.reference.yml` (app + PG + Redis)
   is STALE. The current canonical compose also bundles Temporal + a Temporal-Postgres + Elasticsearch +
   Temporal-UI + admin-tools (required, v2.12+). Postiz docs recommend 4 vCPU / **8 GB**.
2. **Host = a SEPARATE Intel CX33 box, NOT the n8n box** (Shaheen 2026-07-18, after the cost check).
   The n8n box is AMD, and Hetzner locks a rescale to the box's own (expensive) line - the console priced
   rescale-to-8GB at **EUR 45/mo**. A fresh **CX33 (Intel, 4 vCPU / 8 GB / 80 GB) = EUR 10.61/mo** is the
   cheapest 8 GB tier AND fully isolates Postiz from n8n. Totals: two boxes (n8n ~EUR 9.99 + CX33 EUR 10.61
   = ~EUR 20.6) cost LESS THAN HALF of one rescaled EUR 45 box. (The EUR 48 Shaheen first saw = CCX33, a
   dedicated-vCPU 32 GB box on the wrong tab. ARM/CAX is ruled out: Postiz has no ARM64 image, issue #995.)

## Prerequisites (Shaheen-side, tracked in system/human-actions.jsonl)
1. **Create the CX33 box.** Hetzner Cloud -> Add Server -> **Shared vCPU** tab (NOT Dedicated/General
   Purpose - that is the EUR 48 CCX trap) -> **CX33** (Intel, 8 GB, EUR 10.61/mo). Ubuntu 24.04. Add Alex's
   SSH key. Then set an ssh alias `postiz` -> the new IP so `ssh postiz` works. (queue: `modeling-postiz-newbox`)
2. **DNS.** Cloudflare A record `social.shaheenkiarash.com` -> **the NEW box's IP** (not the n8n box).
   Needed BEFORE first `up`, or Caddy's TLS (ACME) loops. (queue: `modeling-postiz-dns`)
3. **Instagram Business/Creator** linked to a Facebook page - needed to CONNECT IG in Postiz, not to
   deploy. Before first publish. (queue: `modeling-postiz-ig-business`)
4. **Mirror secrets** JWT_SECRET + POSTGRES_PASSWORD from `config/postiz.env` into the password manager.
   (queue: `modeling-postiz-secrets-mirror`)

## Deploy (Alex, on the NEW CX33 box)
```bash
# 0. confirm the box + Docker
ssh postiz 'free -m; uname -m; docker --version || (curl -fsSL https://get.docker.com | sh)'

# 1. clone the CANONICAL compose (Postiz: always pull the compose from the repo)
ssh postiz 'git clone https://github.com/gitroomhq/postiz-docker-compose /opt/postiz'

# 2. drop in our override + Caddyfile + secrets (scp from work/30-modeling/)
scp work/30-modeling/docker-compose.override.yaml  postiz:/opt/postiz/docker-compose.override.yaml
scp work/30-modeling/Caddyfile                     postiz:/opt/postiz/Caddyfile
scp work/30-modeling/config/postiz.env             postiz:/opt/postiz/.env      # compose reads .env for ${...}
ssh postiz 'chmod 600 /opt/postiz/.env'

# 3. VALIDATE the merged config BEFORE up - secrets resolved, no :latest, caddy + temporal present
ssh postiz 'cd /opt/postiz && docker compose config | grep -E "image:|JWT_SECRET|POSTGRES_PASSWORD|social.shaheenkiarash"'

# 4. up (first boot pulls images + runs Prisma migrations; ~3-5 min on a fresh box)
ssh postiz 'cd /opt/postiz && docker compose up -d'

# 5. watch health - all must reach healthy; app has a 120s start_period
ssh postiz 'cd /opt/postiz && watch -n5 docker compose ps'
ssh postiz 'cd /opt/postiz && docker compose logs -f postiz'   # server listening on :5000
```
No n8n coexistence or memory guardrail needed here - this box runs ONLY Postiz.

## First admin + lock registration
- `config/postiz.env` ships `DISABLE_REGISTRATION=false` so you can create the first account.
- After DNS is live: open `https://social.shaheenkiarash.com`, register the ONE admin account.
- Then set `DISABLE_REGISTRATION=true` in `/opt/postiz/.env` and
  `ssh postiz 'cd /opt/postiz && docker compose up -d postiz'` (recreates just the app). No open signups.

## TLS / Caddy
Caddy is IN this compose (service `caddy`, publishes 80/443, reverse-proxies `postiz:5000`). Nothing to
cross-wire. It auto-issues a Let's Encrypt cert once DNS points at the box. If the cert fails, check DNS is
live and 80/443 are open in the Hetzner firewall, then `ssh postiz 'cd /opt/postiz && docker compose logs caddy'`.

## Verify-after-deploy (Verify-after-write standing order)
- `docker compose ps` -> every service `healthy`.
- On box: `curl -sI http://127.0.0.1:4007` -> 200/redirect.
- Public: `curl -sI https://social.shaheenkiarash.com` -> 200, valid cert.
- Admin login works; connect the Instagram channel (needs prereq 3 + FACEBOOK_APP_ID/SECRET in `.env`).

## Rollback (n8n is a DIFFERENT box - never touched)
`ssh postiz 'cd /opt/postiz && docker compose down'` stops the whole Postiz stack. Data persists in the
named volumes; add `-v` to wipe. Production n8n lives on the other box and is entirely unaffected.

## Post-deploy propagation (Close-Out)
manifest `modeling` DORMANT->LIVE (or the #30 promotion per the run-29 plan); vault/projects/modeling/status.md;
docs; queue items closed; decisions.md; the plain-English guide + ALEX-OS-master (a live surface went up);
add the new box + its SSH alias + its own backup story to the infra map + credentials-ledger.
