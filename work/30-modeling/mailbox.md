# Mailbox architecture - the radar's fuel line

Decision (growth plan, master note 2): **alias-primary + sender-fallback filters, converging on ONE Gmail label.** The radar reads `label:modeling/castings` and nothing else.

## Routing chain
```
platform -> castings@shaheenkiarash.com -> Cloudflare Email Routing -> shaheen.kiarash@gmail.com
        -> Gmail filter (to:castings@) -> label modeling/castings + skip inbox (archive)
```
- The alias is structural: set once at platform signup, every mail to it is casting traffic BY CONSTRUCTION (no maintained sender list = no routing drift).
- Skip-inbox keeps the personal stream clean; email-triage (#07, 05:00) additionally carries a `-label:modeling/castings` exclusion so the two lanes never double-touch a mail even if one lands in the inbox.
- The radar's idempotency labels: `modeling/castings` (Label_13) = unprocessed feed; `modeling/castings-done` (Label_14) = processed. Both created 2026-07-18 via MCP, read-back verified. Query: `label:modeling/castings -label:modeling/castings-done newer_than:7d`.

## Active sources narrowed (Shaheen, 2026-07-22)
The radar scores mail from **Statist, ModelManagement, ACasting ONLY**. StagePool / Jooble / StarNow are **deactivated as sources** in `parsers.md` (their mail, if any, is ignored - not scored, not counted as unparsed). This is a parser-registry decision, not a Gmail-filter change: the plumbing below stays as-is; the six signups Shaheen did all remain valid, three just aren't consumed. Criteria the radar applies: **worldwide** (location is a travel-cost discount, never a drop), **male** castings only, **no nude/erotic** briefs (dropped). Radar cadence: **every 2nd day 06:45** (Shaheen 2026-07-22, down from daily).

## Gmail filters (Shaheen creates in the Gmail UI - the MCP cannot create filters)
| # | Match | Action |
|---|---|---|
| F1 | `to:(castings@shaheenkiarash.com)` | Apply label `modeling/castings`, Skip inbox (Archive), Never send to Spam |
| F2 (legacy fallback) | `from:(modelmanagement.com)` | Apply label `modeling/castings`, Skip inbox (Archive), Never send to Spam |

F2 exists because the ModelManagement account predates the alias (registered under the old address; email-change surgery on a live profile is riskier than a filter). Any future platform that cannot use the alias gets its own F-row here; this table is part of the parser-registry review (a new sender = a new `parsers.md` entry + possibly an F-row).

**MM web-UI reality (Shaheen, 2026-07-22 signup pass):** the ModelManagement web app has **no saved-search feature and no job-category filter** - only an online-job vs in-person-job toggle. So `modeling-signup-mm` reduced to nothing configurable on-site; MM's default match/casting emails are the fuel and F2 catches them. Account is **PAID tier**, so the "one-free-application wall" does not apply to Shaheen. If MM calibration comes back zero, the lever is MM's account-level email/notification preferences (turn casting-match emails ON), not a per-search alert.

## Cloudflare side (Shaheen, ~2 min)
Email Routing already runs the domain (shaheen@ live since the funnel work). Add: `castings@shaheenkiarash.com` -> forward to `shaheen.kiarash@gmail.com`. Nothing else changes.

## Calibration week (week 1 after signups)
The debate's weakest assumption is alert cadence on free tiers - MEASURED here, not assumed. During week 1 the radar logs per-platform mail counts into `vault/projects/modeling/metrics.jsonl` (`kind:"loop"` rows). Expected walls (v2, priced): ~~ModelManagement's one-free-application limit~~ **[corrected 2026-07-22: Shaheen is on a PAID MM membership, no free-app wall applies]**; StagePool free tier only; never auto-renew anything. Outcome decides the ONE-premium contingency (0-200 SEK/mo) or an honest weekly-cadence downgrade.

## Starvation + drift alarms (wired in the radar + weekly run)
- 7 consecutive zero-mail days AFTER first_fire = RED (starvation, risk R1).
- >=3 UNPARSED mails from one sender in 7 days = parse-drift RED + a named fix task (risk R2).
- Pre-first_fire (DORMANT calibration), zero mail is normal and reports green with a "waiting on signups" note, never RED.
