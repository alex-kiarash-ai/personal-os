# 03 - Application Engine (BI)

## What it actually does
A job-hunting robot that runs on the rented server every morning at 07:00: finds fresh Power BI / data jobs on LinkedIn in Shaheen's target cities, scores each one against his CV, filters by his work-condition rules (remote/hybrid/on-site per city), and for every job that passes, writes a tailored CV + cover letter, renders them as PDFs into Google Drive, and logs everything in a Google Sheet - including the AI cost per job (cents). Shaheen reviews and clicks submit himself; the robot never applies on its own. A local command (`/application-engine`, 08:30) reads the ledger and reports. Since 2026-07-01 the pipeline is also *askable*: an MCP server lets Shaheen's AI assistant query it conversationally ("how did the pipeline do this week?").

## Why it exists
The math: proper applications cost 1-2 hours of tailoring each, which caps any serious volume. The engine removes the hours and keeps the human decision. It's also the flagship exhibit of the career pivot - the thing Shaheen shows when he says "I build AI automation": two AI reasoning calls wrapped in deterministic gates, review-first, costs tracked to the cent.

## Works together with
- **[14 - AI Application Engine](14-ai-application-engine.md)** - its clone for AI roles; two lanes of one job hunt.
- **The n8n side** - the workflow itself, its MCP front desk and three query tools, its crash alarm, and the stats sidecar are all documented in [docs/n8n/](../n8n/).
- **[Alex HQ](16-alex-hq.md)** - daily pipeline tiles via the stats sidecar.
- **The vault** - every interesting company found becomes a page in vault/business/ (46 and counting).
- **[LinkedIn Series](12-linkedin-series.md)** - this build is the star of several episodes.
