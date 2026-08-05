# Portfolio Website (#30)

Registered 2026-08-03. Took number 30 from the retired modeling lane the same day (that lane was wiped whole, no successor; tombstone in `system/manifest.json` `meta.unnumbered` + `vault/archive/modeling/`). This project inherits the NUMBER only, nothing else. Source spec: `Desktop\PROJECT.md` (Shaheen's frozen v1, amended 2026-08-03 by research-team run 40). Decision record: `outputs/research-team/2026-08-03/30-modeling-restructure-plan.md` + [[research/modeling-restructure-plan]].

## Type
Build project (ON-DEMAND). Not scheduled: deploys ride GitHub Actions on push to main, which is repo-side. No local wrapper, no cron, no Notion DB in v1.

## What this is
**shaheenkiarash.com rebuilt as a public-repo Astro static site.** Two purposes, both real: Shaheen's working modeling portfolio, and a proof-of-work case study for Senior Power BI / AI Automation interviews. The operations story (CI/CD, decisions log, tested restore) is built to production standard *because it is part of the showcase*.

The whole system in one sentence, and every word must be explainable in depth (that is PROJECT.md's own standard):

> Built with Astro and TypeScript, compiled to static HTML and CSS, served from Cloudflare's edge, deployed automatically by GitHub Actions.

**All TypeScript runs at BUILD time**, once, on the GitHub runner: it reads content files, generates responsive image variants, assembles pages, emits `dist/`. The visitor gets plain HTML/CSS/images and near-zero JS. Nothing dynamic runs anywhere. Nothing to patch.

### v1 scope (frozen, Shaheen)
4 pages: Home, Portfolio, About, Contact. One curated portfolio stream (~20-30 images, 4:5 crops, hero may break ratio). Plus the **In Motion film section** (amendment R10 - it is live content today, so keeping it is scope-neutral). Contact is email + Instagram links only: **no forms, no backend**. Content model carries an empty `tags` field so categories are a later data change, never a restructure.

Explicitly out of v1: booking/contact forms, lightbox (candidate v1.1), a CMS, and the n8n content pipeline (deferred).

## Where things live
| Thing | Path | Note |
|---|---|---|
| This spec + ops knowledge | `work/30-portfolio-site/` | personal-os side |
| Deploy runbook (LIVE, the site ships through it today) | `work/30-portfolio-site/deploy-runbook.md` | seeds the new repo's `deploy/README.md` at B2 |
| **The website repo** | `C:\Users\Thinkpad\Desktop\shaheenkiarash.com` | **a SIBLING of personal-os. NEVER nested inside it.** Two gits, two validator regimes, two publics; personal-os's hooks must never see the site tree. `git config core.longpaths true` on clone. |
| GitHub | public repo `shaheenkiarash.com` under Shaheen's own account | his portfolio, his commit identity - not the machine account |
| Photo masters (private tier) | `Desktop\Claude\Modeling\{Website, _backups}\`, `Desktop\personal-os-backups\website-2026-07-18\` | full-resolution originals NEVER enter the public repo |
| Live serving | Cloudflare Worker `plain-block-545a` | see deploy-runbook.md |

## Hosting: Cloudflare, not the VPS (amendment A1 - APPROVED by Shaheen 2026-08-03)

> **Settled, and it is now the spec.** Shaheen's words: *"Approve A1, keep it on Cloudflare."* This was the one amendment that touched his frozen scope. The VPS path is deferred rather than dead; the conditions for reviving it are at the end of this section.

PROJECT.md specified self-hosting on the Hetzner VPS behind a reverse proxy. **Rejected for v1, and the rejection is itself the interview artifact.** Three reasons, all evidence not taste:

1. **The box is production.** `work/18-recovery-layer/baselines/hetzner-ports.json` records ports 80/443 held by `docker-proxy -> n8n-caddy-1 (caddy:2-alpine)`. Behind it: the n8n job engines, the MCP server, Alex HQ, Postgres, and the primary vault-backup destination. PROJECT.md's own rule says whatever holds those ports stays - and its "plain directory, no Docker for the site" serving model therefore **does not exist on this box**: joining that proxy means editing and restarting the container fronting production.
2. **The zone carries his mail.** `shaheen@shaheenkiarash.com` (the site's own contact address) rides Cloudflare Email Routing on the same zone. The VPS path needs an apex A-record repoint with MX surviving intact; the Cloudflare path needs **no DNS change at all**. A cutover you never perform has no failure modes.
3. **The story is stronger.** "I evaluated self-hosting on my own VPS and rejected it to keep a public surface off my production automation box" is a more senior sentence than a vhost file, and it goes in `docs/decisions.md`.

**Deferred, not dead:** the VPS move keeps its own go/no-go. If it is ever revived, two things become blocking first - the containerised-Caddy serving mechanics must be specced (volume mount + Caddyfile block + a production proxy restart), and the SSH hardening below stops being optional.

## Hard rules (structural, not vibes)

1. **Zero secrets in the repo, ever.** The Cloudflare API token lives only in GitHub Actions secrets, scoped to Workers Scripts:Edit, in a protected environment. No `.env` is ever committed. The repo is public from commit one, so this is by construction, not by gitignore.
2. **Web masters in the repo, originals never.** `src/assets/photos/` holds ~2400px web masters only; Astro generates every smaller variant at build time. Full-resolution originals stay in private storage. **If the photographer's grant is narrowed, masters move to a build-time fetch from private storage and the repo stays public** - a "no" costs a config change, not a re-architecture.
3. **The film file never enters git.** The In Motion section stays in scope; the ~19 MiB H.264 does not go in a public repo (history-permanent redistribution plus repo bloat). It rides the private-asset path (Cloudflare R2 or equivalent), poster + lazy-load per the deploy runbook.
4. **Solo profile, and it now binds git history too.** Never feature Shaheen's partner or any private individual - the MHL/_EMM personal set stays permanently CUT, never shown, never named, and no vault/people page exists for that person (a deliberate People Intake exception). Professional CO-MODELS from real campaign shoots ARE allowed as supporting frames; Shaheen's solo frames lead. **Extension for a public repo (A10): the prohibition covers filenames, alt text, commit messages and git history.** A public repo's history is permanent - rename any offending source file BEFORE the first `git add`, never in a later "cleanup" commit.
5. **License split, stated on the first screen.** Code permissive (MIT) with photos explicitly excluded; `src/assets/photos/**` all-rights-reserved, no reuse, photographer credited. A public repo with no license reads as "scrape me".
6. **CI is hardened from the first workflow file.** Third-party actions pinned to commit SHAs, not tags. Top-level `permissions: contents: read`. Deploy job on push-to-main only. Never `pull_request_target` with secret access. GitHub secret scanning + push protection ON at repo creation.
7. **Deploys are verified, never assumed.** "It uploaded" is not done. Post-deploy CI asserts: fetch + hash-compare against the built file, new assets 200, guarded/private paths 404, og-card present. This is the Verify-after-write standing order applied to the web, mechanised instead of remembered.
8. **The Worker name is load-bearing.** The custom-domain binding is attached to the NAME `plain-block-545a`. Every deploy targets that exact name. A rename is a deliberate re-binding step, never a side effect.
9. **The Cloudflare zone is never touched casually.** Email Routing on this zone carries `shaheen@shaheenkiarash.com`. No DNS or MX change is part of this project.
10. **Identity-carrying copy is written in an Alex session.** A session opened in the sibling repo is plain Claude - no soul.md, no constitution, no gates. Code work there is fine. About-page prose, portfolio captions, anything a human reads as Shaheen's words gets drafted at the personal-os root under the Brand + Soul Pre-Flight Gate, then carried across as files.

## Phases (the runbook; each phase is its own session, entry and exit gated)

| # | Phase | Entry gate | Output | Exit gate |
|---|---|---|---|---|
| **B0** | Spec amendments | ~~T1 committed + Shaheen's A1 sign-off~~ **CLEARED 2026-08-03** | PROJECT.md amended in place; rights ask sent; URL inventory + 301/kill map drafted | **PASSED 2026-08-03.** PROJECT.md internally consistent with A1, consistency-checked; A1 approved by Shaheen the same day |
| **B1** | Content + design | B0 | Photo inventory A/B/C + rights column + hero check; 3 reference sites picked; wireframes for 4 pages + film; palette stress-tested on near-black; typography locked | **PROJECT.md's own gate: no code before this is done** |
| **B2** | Foundation | B1 + `portfolio-desktop-creds` closed | Public repo created (secret scanning + push protection on); Astro scaffold; LICENSE split; hardened `deploy.yml`; scoped CF token in Actions secrets; **first CI deploy to a STAGING worker**, not production; smoke checks wired; `deploy/README.md` + `docs/decisions.md` seeded | Scaffold live on staging via green CI |
| **B3** | Build | B2 + the rights answer (or the private-fetch fallback wired) | 4 pages + film section; image pipeline from renamed masters; responsive; SEO + canonical/og; redirect map; Lighthouse 95+. **Then point CI at `plain-block-545a`** and cut over | New site live, old content one `wrangler rollback` away. Stamp `first_fire` + run the generator |
| **B4** | Operations | B3 | External uptime check; restore drill = documented from-scratch redeploy, performed and timed; analytics decision recorded | Monitoring live, drill actually run once |
| **B5** | Interview artifact | B4 | Architecture diagram, written case study, 5-minute walkthrough | Shaheen can give it cold |

**B2 does NOT deploy to production.** PROJECT.md says "hello world live on day one of Phase 2", which was written for a parallel VPS host; under A1 the first CI deploy would land on the Worker serving the live portfolio. Staging worker first; production sees CI at B3 exit, content-complete and rollback-armed.

**If a local Phase-4 monitor is ever built**, its `scripts/run-*.sh` wrapper, its `scheduler/schedule.md` entry, its `meta.model_routing.local_wrappers` pin and an `hq_project` slug all arrive in the SAME change. Not before.

## Notion Integration
None in v1. Nothing here is row-shaped; `vault/projects/portfolio-site/status.md` is the record. (The Progress Tracker board row is a separate, owner-side thing.)

## Vault Structure
- Tier 1: `vault/projects/portfolio-site/status.md` - state, phase, decisions, deploy pointers.
- Tier 2: none yet. `docs/decisions.md` inside the website repo is the design record by design (PROJECT.md rule 4: by launch the case study exists for free).

## Connections
- Retired predecessor: `vault/archive/modeling/` (the lane that held number 30; the tombstone carries the external-state teardown checklist).
- The photographer of the portfolio work owns the repo-redistribution rights answer. **His page lives in `vault/people/network/` (local-only) and his name is deliberately not written into this spec or any tracked file** - this repo is public, and a real person's name is exactly what the personal-data guard exists to keep out of it. Pointer, never the value.
- [[business/shady-rays]] + [[business/lullevibes]] - the credited clients on the live site; Lullevibes is the In Motion film. (Companies, already public on the site, so they are named freely.)
- The Cloudflare zone is shared with `shaheen@` mail (#07 email-triage's inbound path) - hence hard rule 9.

## Trifecta
Gate: **human-posts**. Legs: private_data=false, untrusted_content=false, external_comm=true.
Honest classification: the site publishes only content chosen for publication (no vault or personal data flows through it); it ingests nothing (no forms, no mail, no scraping - CI supply-chain risk is hard rule 6's problem, not an ingestion leg); and a push to main publishes to the open web. Alex stages branches and commits; **Shaheen's approved merge/push is what publishes**. Source of truth: the `trifecta` block in `system/manifest.json` + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.

## Close-Out Extras
Beyond the universal list:
- Any deploy -> the verification ritual of hard rule 7 actually ran, with its output quoted (not "deployed OK").
- Any decision taken during a phase -> a paragraph in the website repo's `docs/decisions.md` the same session. That file is the interview artifact and it is written continuously or not at all.
- Any photo added -> its rights row is real (photographer, grant scope incl. repo redistribution) before the file is committed.
- First real production deploy -> stamp `first_fire` + `first_fire_kind: "live"` in `system/manifest.json`, then run `node scripts/generate-alex.js`.
- Public copy shipped -> Brand + Soul Pre-Flight line printed, and the Close-Out C grader run (identity output).

## Skills
- `frontend-design` - MANDATORY before any visual/design work, per the standing picture rule.
- `ai-seo` + `seo-audit` - ADVISORY but genuinely load-bearing here: this is a real public web page meant to be found and cited, which is exactly the case where AI-search optimisation pays (unlike a LinkedIn post). Run before publishing public copy.
- `image-manipulation-image-magick` - ADVISORY, deterministic local crops/resizes of masters.
- `karpathy-guidelines` - ADVISORY on the code. Scope guard from root CLAUDE.md still applies: its "surgical changes" section never overrides Change Propagation or the Close-Out Gate.
- `webapp-testing` - ADVISORY, verifying the built site in a real browser.
- `pdf` - ADVISORY (comp card / portfolio PDF checks).
