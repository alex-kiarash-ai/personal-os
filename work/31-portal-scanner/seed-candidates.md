# Phase 0 Seed - candidate companies (AWAITING SHAHEEN'S APPROVAL)

The detector runs over THIS list once you approve it. Cut what you don't want, add your real targets,
then I run `portal-detector.js` and report the go/no-go count (how many actually return a scrapable role
after the title/location prefilter). Tier A only for v1: Greenhouse, Lever, Ashby.

Confidence key: **HIGH** = ATS + slug confirmed (from your vault ack or a live board URL); **MED** = board
found, slug inferred, detector confirms; **DETECT** = careers URL only, detector resolves the ATS (may
come back "not Tier A").

| # | Company | Why it fits you | ATS | Slug | Conf | Source |
|---|---------|-----------------|-----|------|------|--------|
| 1 | Bjak | You already applied via their Ashby board | ashby | bjak | HIGH | vault ack (no-reply@ashbyhq.com) |
| 2 | BLP | You applied (Founding Forward Deployed Engineer) via Ashby | ashby | blp | HIGH | vault ack |
| 3 | Appfire | You shortlisted their Sr AI Automation Eng (n8n/Claude/MCP named) | greenhouse | appfire | HIGH | vault, confirmed slug |
| 4 | Pleo | Danish fintech, Copenhagen/remote EMEA, hiring Applied AI Engineers | ashby | pleo | HIGH | live board |
| 5 | Polar Analytics | Remote-EU data+AI platform, uses Claude/MCP heavily | ashby | polaranalytics | HIGH | live board |
| 6 | Nord Security | Nordic (LT), analytics/data engineering roles | lever | nordsec | HIGH | live board |
| 7 | GitBook | Europe-remote, data/analytics generalist roles | ashby | GitBook | HIGH | live board |
| 8 | Remote.com | Global-remote, has a "CX AI & Automation Lead" + Nordics lanes | greenhouse | remotecom | HIGH | live board (236 jobs) |
| 9 | Ebury | Fintech, remote/Madrid, senior analytics engineering | greenhouse | ebury | MED | board found, slug inferred |
| 10 | Tibber | Nordic energy-tech scaleup (Stockholm/Oslo/Berlin), data-heavy | ? | ? | DETECT | in your vault |
| 11 | Greenstep | Finland/Nordic data+AI+Fabric consultancy, Power BI roles | ? | ? | DETECT | likely Teamtailor (may fail Tier A) |

Notes:
- 10-11 are DETECT-only: the detector sniffs their careers page. Greenstep's `careers.greenstep.com` looks
  like Teamtailor (Tier C, not v1), so it will probably come back "not Tier A" - that is useful signal, not
  a failure.
- Your enterprise/agency targets (Danone/iCIMS, BRF/SuccessFactors, Mondelez/Workday, Teamtailor firms,
  Robert Half etc.) are deliberately NOT here: none are Tier A free-JSON, and agencies have no scrapable
  portal. That was the whole point of the review.
- Add any company you actually want to watch. The best seed is YOUR target list; this is just a starter.
