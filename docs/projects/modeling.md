# Modeling (unnumbered, tracked in the vault)

## What it actually does
Runs Shaheen's international modeling career as an engineered system rather than a hobby: a personal site (shaheenkiarash.com, on Cloudflare Workers), a structured status page and infrastructure page in the vault, planned n8n workflows for the operational side (outreach, portfolio, travel logistics), and research support from the wider system (e.g. the flight-search research for an Istanbul trip came through the Research Team).

**Content engine (chosen 2026-07-15):** a self-hosted, open-source social tool (Postiz) on the same Hetzner box runs the Instagram side for @shaheen.kiarash: it writes captions in Shaheen's voice, plans a visual calendar, and auto-publishes the batch he approves. It never auto-likes, auto-comments or auto-DMs, that stays a human job (a real booking account, not worth a ban). The deploy config and runbook live in `work/modeling/`. Instagram publishing needs the account set to Business/Creator and linked to a Facebook page.

## Why it exists
It's a real parallel track of Shaheen's life with real logistics, and the system's job is to run *all* of his life, not just the career pivot. Treating it as an engineered project - same status pages, same infrastructure discipline - means it benefits from every shared asset: the domain, the server, the research machinery, the calendar.

## Works together with
- **Shared infrastructure** - same Cloudflare domain and Hetzner server as everything else.
- **[Research Team](04-research-team.md)** - travel and market research runs.
- **The vault** - vault/projects/modeling/ holds its status and infrastructure pages.

*Honest status note: like venture-sync, this lives in the vault but outside the numbered routing table - a known documentation gap on the Recovery layer's fix list.*
