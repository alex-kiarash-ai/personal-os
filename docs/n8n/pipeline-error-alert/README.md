# Pipeline Error Alert — the smoke alarm

**Workflow ID:** `QlGy1BFzdKF852uR` · **Runs:** only when another workflow crashes · **Nodes:** 3 · **Export in this folder:** workflow.json (2026-06-30 version, latest)

## What it does

Nothing, on a good day. It sits silent until any workflow on the n8n server throws an error — then it wakes up automatically, writes down what died and why, and creates a row in the Notion "Pipeline Alerts" database. The morning brief reads that database every day at 08:00, so a crash at 03:00 is on Shaheen's breakfast briefing, not buried in a server log.

## Why it exists

Bought with pain. In late June 2026, **both** job engines went dark for five days — the Anthropic monthly spending cap had tripped, every run failed quietly, and nobody noticed because there was no alarm. Five mornings of "the robot is applying for me" while it applied to nothing. This workflow is the lesson made permanent: failures must announce themselves, in a place that gets read daily.

## The steps, node by node

- **On Workflow Error** — n8n's built-in tripwire: fires the moment any workflow on this server that designates this as its error handler fails.
- **Build Alert Payload** — plain code that gathers the facts: which workflow, which node, what error message, when.
- **Notion: Create Alert** — writes the alert as a row in the Pipeline Alerts database in Notion (database `08504afe-ba13-4691-9e67-0ed9a00c8e8c`).

## Connected to

- **[03-application-engine](../03-application-engine/)** and **[14-ai-application-engine](../14-ai-application-engine/)** — the workflows it primarily guards (any workflow on the box can nominate it as error handler).
- **Morning Brief** — reads the Pipeline Alerts database daily; the alarm is only useful because something checks it.
- **Alex HQ** — pipeline health tiles catch the same outages from the numbers side ([hq-pipeline-stats](../hq-pipeline-stats/)); two independent alarms for one failure class, on purpose.
