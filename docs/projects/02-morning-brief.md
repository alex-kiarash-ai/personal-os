# 02 — Morning Brief

## What it actually does
Every day at 08:00 it reads the last 12 hours of unread Gmail, today's calendar, and the system's own state, filters out the noise, and writes one prioritized briefing: what needs action, what's just FYI, what broke overnight. On Mondays it carries the AI Radar's findings; every day it surfaces Airbnb booking flags, pipeline crash alerts from Notion, notes Shaheen dropped into the HQ inbox overnight, and people waiting in the review queue. Since July 2026 it also carries a small **Life Ops** block read from Shaheen's own Google Sheet: which plants need watering today, whether it's a gym day, and the day's learning blocks.

## Why it exists
Mornings used to start with twenty tabs: inbox, calendar, spreadsheets, dashboards. The brief compresses that into one read with coffee. It's also the system's main *delivery channel*: half the other automations write things "for the morning brief" because it's the one place guaranteed to be read daily — which is exactly why alarms are pointed at it.

## Works together with
- **[Email Triage](07-email-triage.md)** — the deeper inbox pass later in the day; the brief is the headline, triage is the processing.
- **[Alex AI Radar](15-alex-ai-radar.md)** — its Monday Radar section.
- **[Airbnb Host](13-airbnb-host.md)** — booking and arrival flags land here.
- **[Alex HQ](16-alex-hq.md)** — collects dropped notes at brief time; the brief quotes HQ health.
- **The n8n [Pipeline Error Alert](../n8n/pipeline-error-alert/)** — overnight crashes surface here.
