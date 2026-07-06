# 14 - AI Application Engine

## What it actually does
The second job-hunting robot: an exact clone of the [BI Application Engine](03-application-engine.md), running 30 minutes later (07:30) and aimed at **AI and automation roles** - AI Automation Engineer, n8n Developer, LLM Engineer, AI Consultant - across the Gulf, London remote, Stockholm, and remote Europe. It carries Shaheen's AI-direction CV instead of the BI one, scores each job on how *central* AI is to the role (not just whether he qualifies), and keeps its own ledger, Drive folder, and cost log. Verified at scale: 905 jobs processed, 48 tailored applications drafted, total AI spend under $3.

## Why it exists
The pivot in machine form. One CV can't credibly chase both the safe lane (senior Power BI, pays the bills) and the desired lane (AI automation, the future) - so the hunt runs two engines with two identities. This one is the aspirational lane; the numbers it produces are also proof for that very lane: "I built the robot that applies for AI jobs" is itself an AI-automation credential.

## Works together with
- **[03 - Application Engine](03-application-engine.md)** - its parent and twin; shared scraper, PDF renderer, spending account, and philosophy (review-first, never auto-submit).
- **The n8n side** - the workflow, its crash alarm, and the stats sidecar: [docs/n8n/14-ai-application-engine](../n8n/14-ai-application-engine/).
- **[Alex HQ](16-alex-hq.md)** - its daily stats tile via the sidecar.
- **The vault** - AI-track companies found become vault/business/ pages, sharpening the target map.
