# Security Playbook (P5, 2026-07-17)

Hand-written companion to `security-sweep.ps1`. When the monthly sweep turns a red (or you're setting it up), this is the procedure. The sweep DETECTS; a human ROTATES. Nothing here auto-repairs.

## Standing stance on a PUBLIC repo (read first)
The repo is public since 2026-07-16. `.gitignore` is the SOLE barrier between personal data and the whole internet. Two rules follow:
1. **On any leaked secret: ROTATE, do not (only) rewrite.** Forks, clones and GitHub's own caches remember a pushed secret even after a history rewrite. Rewriting history is damage-limitation, not a fix. The fix is a new credential.
2. **Every new gitignored file gets its `.gitignore` line + a `git check-ignore` proof BEFORE its first commit.** One forced `git add -f` of a secret is instantly and permanently public.

## Per-credential response (mirrors system/credentials-ledger.json)

| Credential | Where it lives | Rotate how | Dependents (downtime) |
|---|---|---|---|
| n8n API key | `work/03-application-engine/config/n8n-api-key.txt` (gitignored) | n8n UI -> Settings -> API -> revoke + new; update the file | ALL n8n REST (generator V6, deployed probe, every wrapper's push). Brief downtime until the file is updated. |
| Alex HQ token | `work/16-alex-hq/config/alex-hq-token.txt` (gitignored) | Rotate the bearer on the box's webhook config + update the file | Every wrapper's HQ run_status push + health/inbox webhooks. HQ tiles go stale until updated. |
| Alex HQ basic-auth | Caddy config on the box (`/opt`) + password manager | Edit the Caddyfile hash + reload Caddy + password manager | Browser access to hq.shaheenkiarash.com only. |
| Bright Data key | **data-gap - locate on first review** | Provider dashboard | Scraping lanes (radar/whatsapp Phase 3) if wired. |
| GitHub backup PAT | Windows Credential Manager (age owned by recovery C15) | GitHub -> Settings -> Developer -> Tokens; update Credential Manager + `$patExpiry` in check.ps1 | The nightly 21:30 public push. Backup skips until fixed (RED HQ). |
| vault-backup GPG passphrase | local-only file, outside repo (path in `system/credentials-ledger.json`, gitignored) + password manager | Re-encrypt existing backups with a new passphrase; update both stores; refresh C14's `passphrase-attested.txt` | The nightly 21:45 encrypted backup. **If the ThinkPad dies and this is not in the password manager, the off-machine backup is unrecoverable.** |

## Per-assertion response
- **S1 gitleaks hit** -> identify the secret + the commit; ROTATE it (table above); then optionally scrub history + force-push. Add a tuned baseline so a known false-positive doesn't re-fire.
- **S2 tracked-ignored** -> `git rm --cached <path>` (keeps the local file), confirm `.gitignore` covers it, commit. If it was ever pushed, treat the content as leaked (rotate).
- **S3 credential over-age / never-recorded** -> confirm the credential is still valid (or rotate it), then set `last_rotated` in the ledger to today.
- **S4 n8n version / advisory** -> the sweep reads the DEPLOYED version from the b30 probe, never prose. On a stale probe, verify the live box version (`ssh n8n 'docker inspect ...'`) and fix the probe. On an advisory hit, open a human-actions row and plan a pinned upgrade; never auto-update.
- **S5 port drift** -> capture `ssh n8n 'ss -tlnp'`, diff against the reviewed baseline; an unexpected listener is investigated before anything else.
- **S6 MCP clients** -> compare connected clients against the Phase 2.0 baseline; an extra client on the instance MCP is a real intrusion signal.
- **S7 skills hash mismatch** -> `git diff` the SKILL.md; if it's a benign markdown edit, re-baseline the lock; if it's script injection or an unexpected change, revert (`git checkout`) and investigate the install path.
- **S8 visibility flip** -> if unintentional, flip back to private, THEN treat everything committed since 2026-07-04 as exposed (private-flip alone is not enough; purge history + rotate). If intentional, update `meta.repo_visibility`.

## Activation checklist (the sweep is BUILT but not yet scheduled)
The pure assertions (S2, S7, S8) run live today; the rest need setup:
1. `winget install gitleaks` (S1), run once, tune a committed baseline.
2. Capture `ssh n8n 'ss -tlnp'`, Shaheen reviews, save `work/18-recovery-layer/baselines/hetzner-ports.json` (S5).
3. Fill real `last_rotated` dates in `system/credentials-ledger.json` (S3) and locate the Bright Data key.
4. (After P2) the Chat Gateway 2.0 gate writes `work/18-recovery-layer/baselines/mcp-clients.json` (S6).
5. Register `PersonalOS-security-sweep` (monthly 1st Monday 07:20) via /cron-setup, add it to `system/manifest.json` #18 `schedule_jobs` + `scheduler/schedule.md` (with a light-class Task Hardening line), run `node scripts/generate-alex.js`, then `check.ps1 -Init`.
