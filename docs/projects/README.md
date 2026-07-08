# The Projects - Plain-Language Guide

One file per project in the Personal OS: **what it actually does, why it exists, and which other projects it works with.** Written for a non-technical reader. The table below is GENERATED from the project registry (`system/manifest.json`) by `scripts/generate-surfaces.ps1`, so it cannot drift by hand (since 2026-07-06).

The system in one paragraph: Shaheen runs a personal AI agent ("Alex") that operates a markdown knowledge base (the vault), twenty-plus automations, a phone dashboard, and two job-hunting robots on a rented server. The automations feed each other: everything reports its numbers to the dashboard, everything writes what it learns into the vault, and a weekly report reads all of it. The technical specs live in `work/{NN}/CLAUDE.md`; the live n8n workflows are explained in [`docs/n8n/`](../n8n/); the whole-system map is `vault/identity.md`.

<!-- PROJECT-TABLE:BEGIN (generated from system/manifest.json by scripts/generate-surfaces.ps1) -->
| # | Project | State | One line |
|---|---------|-------|----------|
| 01 | [Sprint Tracker](01-sprint-tracker.md) | LIVE | Standup + velocity from the Notion Progress Tracker board; every automation reports Done to it. |
| 02 | [Morning Brief](02-morning-brief.md) | LIVE | The 08:00 brief: inbox, calendar, radar, alerts, life ops, inbox notes, interview flags. |
| 03 | [Application Engine (BI)](03-application-engine.md) | LIVE | Job pipeline, Power BI track: source, score, gate, draft, render daily; also an MCP server. |
| 04 | [Research Team](04-research-team.md) | ON-DEMAND | Adaptive multi-agent research squads; also the QA engine for new builds. |
| 05 | [Personal CRM](05-personal-crm.md) | LIVE | Relationship scoring + Monday follow-up list; reply drafts behind a hard never-send gate. |
| 06 | [Meeting Intel](06-meeting-intel.md) | ON-DEMAND | Dossiers before meetings; any dropped file becomes notes, actions, CRM updates after. |
| 07 | [Email Triage](07-email-triage.md) | LIVE | Inbox triage three times a day + voice-matched reply drafts; learns from Shaheen's edits. |
| 08 | [Expense Wrangler](08-expense-wrangler.md) | LIVE | Receipts to the Notion Expenses DB + an all-formula branded monthly Excel. |
| 09 | [Content Machine](09-content-machine.md) | RETIRED | Retired 2026-07-06: folded into #12 (one content system, same Content Library DB). |
| 10 | [Weekly Exec Report](10-weekly-exec-report.md) | LIVE | The Friday capstone: every automation + mail + calendar into one branded deck + Notion page. |
| 11 | [WhatsApp Harvest](11-whatsapp-harvest.md) | PARKED | Voice-corpus + people harvest. Parked: screen automation is a dead end; revisit = Phase 2 (iPhone backup) build-or-retire. |
| 12 | [LinkedIn Series](12-linkedin-series.md) | LIVE | Building Alex in public: locked ~150-word template, hard gates, real numbers; n8n stages, Shaheen posts. |
| 13 | [Airbnb Host](13-airbnb-host.md) | LIVE | Bookings + income from the Gmail feed (Airbnb has no host API); feeds the brief + runway. |
| 14 | [AI Application Engine](14-ai-application-engine.md) | LIVE | Job pipeline, AI track: clone of #03 with the AI CV + a recalibrated career-changer gate. |
| 15 | [Alex AI Radar](15-alex-ai-radar.md) | LIVE | The staying-current engine: weekly scored sweep, taste memory, friction-first matching, daily server-side collector + urgent lane. |
| 16 | [Alex HQ](16-alex-hq.md) | LIVE | The glanceable dashboard + two-way note inbox at hq.shaheenkiarash.com; every automation pushes run status here. |
| 17 | [Health Tracker](17-health-tracker.md) | LIVE | Daily Apple Health to the brief + HQ tiles; the Alex Sleep Score (0-100) computed server-side. |
| 18 | [Recovery Layer](18-recovery-layer.md) | LIVE | Backups (git + encrypted, drills proven), the weekly zero-token drift checker, the gated monthly lint, the auth probe. |
| 19 | [Venture Sync](19-venture-sync.md) | DORMANT | Read-only mirror of venture repos into the vault. Waiting on the repos existing on this machine. |
| 20 | [Runway](20-runway.md) | LIVE | The zero-date model: savings + burn + salary/severance/a-kassa + Airbnb income, all-formula SEK Excel. |
| 21 | [Interview Copilot](21-interview-copilot.md) | EVENT | Carries a booked interview to the finish: dossier, prep vs the answer bank, runway-aware negotiation drafts. Never sends. |
| 22 | [Teach-Alex](22-teach-alex.md) | EVENT | Ten-second corrections from the phone: classified, filed, confirmed for identity files, logged for #23. |
| 23 | [Self-Review](23-self-review.md) | LIVE | Alex reviews Alex weekly: clusters corrections, errors, INCOMPLETE close-outs; proposes upgrades behind approval. |
| 24 | [Flight Search](24-flight-search.md) | ON-DEMAND | Cheapest + best flights across four sources in parallel (Kiwi, Turkish, Google Flights, Skyscanner); hybrid criteria intake, dedupe to the single cheapest, rank by Shaheen's rules, 30-min follow-up memory, fresh every search. |
| - | [Voice](voice.md) | ON-DEMAND | Hands-free two-way voice: open-mic Whisper in, persistent Claude (sonnet) brain as the full Alex, Edge-TTS neural voice out with a never-mute Edge->SAPI floor. Free/local except the brain's Claude-plan usage. Adopted 2026-07-07 as THE voice solution (replaced v1's OpenAI TTS + the SAC-blocked Kokoro plan); latency + conversation tuning same day. |
| - | [Alex Cost Tracker](alex-costs.md) | ON-DEMAND | What Alex itself costs: all-formula Excel + 3-page Power BI dashboard (~1,032 kr/mo run rate). |
| - | [Modeling](modeling.md) | DORMANT | Modeling career run as an engineered system (Cloudflare Workers site, planned n8n flows). |
<!-- PROJECT-TABLE:END -->

Maintained under the Change Propagation standing order: when a project changes for real, its file here changes in the same session.
