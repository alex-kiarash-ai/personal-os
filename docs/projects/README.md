# The Projects — Plain-Language Guide

One file per project in the Personal OS: **what it actually does, why it exists, and which other projects it works with.** Written for a non-technical reader. Snapshot date: 2026-07-02.

The system in one paragraph: Shaheen runs a personal AI agent ("Alex") that operates a markdown knowledge base (the vault), sixteen automations, a phone dashboard, and two job-hunting robots on a rented server. The automations feed each other: everything reports its numbers to the dashboard, everything writes what it learns into the vault, and a weekly report reads all of it. The technical specs live in `work/{NN}/CLAUDE.md`; the live n8n workflows are explained in [`docs/n8n/`](../n8n/); the whole-system map is `vault/identity.md`.

| # | Project | One line |
|---|---|---|
| 01 | [Sprint Tracker](01-sprint-tracker.md) | Daily standup from the project board: what moved, what's stuck. |
| 02 | [Morning Brief](02-morning-brief.md) | The 08:00 briefing: inbox, calendar, alerts, everything that matters today. |
| 03 | [Application Engine (BI)](03-application-engine.md) | The job-hunting robot for Power BI / data roles. |
| 04 | [Research Team](04-research-team.md) | On-demand research squad: designs its own team per question. |
| 05 | [Personal CRM](05-personal-crm.md) | Keeps relationships alive: who to follow up with every Monday. |
| 06 | [Meeting Intel](06-meeting-intel.md) | Dossiers before meetings, structured notes and actions after. |
| 07 | [Email Triage](07-email-triage.md) | Sorts the inbox three times a day, drafts replies in Shaheen's voice. |
| 08 | [Expense Wrangler](08-expense-wrangler.md) | Receipts in, monthly branded Excel + expense database out. |
| 09 | [Content Machine](09-content-machine.md) | Turns ideas into platform-native posts in Shaheen's voice. |
| 10 | [Weekly Exec Report](10-weekly-exec-report.md) | The Friday capstone: everything above, in one deck. |
| 11 | [WhatsApp Harvest](11-whatsapp-harvest.md) | (Paused) Reads WhatsApp to learn Shaheen's voice and keep people pages fresh. |
| 12 | [LinkedIn Series](12-linkedin-series.md) | "Building Alex": the public story of this system, episode by episode. |
| 13 | [Airbnb Host](13-airbnb-host.md) | Tracks the Stockholm apartment's bookings and income. |
| 14 | [AI Application Engine](14-ai-application-engine.md) | The second job robot, aimed at AI/automation roles. |
| 15 | [Alex AI Radar](15-alex-ai-radar.md) | Weekly scan of the AI landscape for tools worth adopting. |
| 16 | [Alex HQ](16-alex-hq.md) | The glanceable dashboard: every number on one screen, plus a note-drop to Alex. |
| — | [Venture Sync](venture-sync.md) | Mirrors business-venture documents into the vault. |
| — | [Modeling](modeling.md) | The modeling career, run as an engineered system. |

Maintained under the Change Propagation standing order: when a project changes for real, its file here changes in the same session.
