# WhatsApp Harvest - Live Gateway Runbook (WAHA) - DEFERRED, DO NOT DEPLOY YET

> **STATUS: BUILD-READY, SWITCHED OFF (decided 2026-07-10).**
> **Trigger to deploy = the day Shaheen signs a job offer.** Until then the active path is the
> zero-risk iPhone backup (`phase2-runbook.md`). This runbook exists so turning on a live feed later
> is a switch-flip, not a rebuild.

## Why deferred (the decision)
A read-only linked-device gateway is the only way to get a LIVE personal-WhatsApp feed, but it uses an
unofficial client, so it carries a **~2-5%/yr WhatsApp account ban risk** (the scary "68%" figure was
fabricated - see the research page). A ban = the number offline ~60 days = losing Shaheen's primary
line to family across Istanbul, Dubai, Erbil, Stockholm (close family). Mid-job-hunt
that is an asymmetric, badly-timed bet. The iPhone backup covers the real need (history + own-lines
corpus + CRM last-contact) at zero risk, so the live feed waits until a ban stops being catastrophic.
Full evidence + the 3-agent research: [[research/whatsapp-access-2026]].

## Chosen tech: WAHA Core
- Apache-2.0, no licensing server (Evolution API forces licensing activation since v2.4.0, and its
  pairing code is flaky). Self-host as a Docker container, fully headless.
- Links once via an API-returned QR (`GET /api/{session}/auth/qr`), scanned from the phone; the session
  persists across container restarts.
- Webhook payload carries `fromMe`, `timestamp`, `from`/`to`, `body`, `id` - exactly what the CRM +
  corpus need. Sources: https://waha.devlike.pro , https://github.com/devlikeapro/waha (verified 2026-07-10).

## Architecture (when switched on)
- WAHA Core in its OWN Docker container on the Hetzner box, resource-capped (`--cpus=1 --memory=2g`) so
  a Baileys CPU storm or protocol break can never starve the PRODUCTION n8n. No public port (internal
  Docker network only; n8n reaches it there).
- Link once by QR (scan from phone). Read-only: WAHA send endpoints are NEVER called. No media stored.
- Webhook (`message` / `message_create`) -> n8n `/webhook/whatsapp-harvest`:
  - `fromMe: true`  -> append Shaheen's line to the own-lines corpus (soul.md "My Words" per language
    register EN/AR/SV) - the same voice-corpus target as the backup.
  - `fromMe: false` -> update ONLY `last_contact` + minimal context on the person's people-page
    frontmatter; DROP the message body (privacy rule: friends' words never stored).
  - unanswered >48h -> morning-brief flag.
- CRM path: `channel` + `last_contact` land on the people page -> #05 syncs to Notion `Last Contact` +
  `Channel` (identical path to the backup and #07's email feed). WhatsApp recency becomes REAL +
  self-refreshing, retiring the manual `talked` bridge.

## docker-compose sketch (reference only)
```yaml
services:
  waha:
    image: devlikeapro/waha:latest
    container_name: waha-harvest
    environment:
      WHATSAPP_HOOK_URL: http://n8n:5678/webhook/whatsapp-harvest
      WHATSAPP_HOOK_EVENTS: "message"
    volumes: [ "waha_data:/data" ]
    restart: unless-stopped
    deploy:
      resources:
        limits: { cpus: '1.0', memory: 2G }
    # no host port published - internal Docker network only
```

## Kill switch
`docker stop waha-harvest` + delete the WAHA session (unlinks the device). History stays safe in soul.md
+ the vault regardless.

## Ban-risk posture (on record)
~2-5%/yr, read-only linked device, protocol-level detection (read-only only marginally helps). If banned:
number offline ~60 days (appealable); recovery = re-link a new number, re-scan QR, resume. Corpus + CRM
history are preserved locally either way.

## Trigger to deploy
Post-offer only. Reminder logged in [[me/reminders]]. Until then: OFF.
