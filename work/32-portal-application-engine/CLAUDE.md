# Portal Application Engine (stage 2 of the company-portal job lane)

> **Split from #31 on 2026-07-28** (command-layer review F-9). The portal lane has always been TWO n8n
> workflows, but the manifest carried only one, so the scanner's id and cron lived in prose and nothing
> asserted them. This entry gives the drain half its own registry row. See "Why the split" below.

## Type
Automation (LIVE, n8n on the Hetzner box). Stage 2 of 2. Owns no scanning: it drains the queue that
[[work/31-portal-scanner]] banks and turns it into review-ready drafts.

## Purpose
Drain `sourced_unscored` rows from the Portal Job Pipeline sheet and run each through this lane's OWN
cloned Match -> Gate -> Writer -> QA -> Render -> Drive pipeline, producing CV + cover-letter drafts.
**Draft-only, no auto-submit anywhere.** Shaheen reviews and submits.

## Live state (API-verified 2026-07-28)
| Thing | Value |
|---|---|
| n8n workflow | `sxEYRyeHH7i1mHzb` "Portal Application Engine" (34 nodes) |
| Cron | `43 15 * * 2,4` (Tue & Thu 15:43 Stockholm) |
| Active | `true` |
| First fire | 2026-07-28 13:43Z, status `success` |
| Sheet | `1hmLHyW0Yu6ZV8MpiKrECo2OACk4eC3Eb5xWR73HIeiU` (shared with #31) |
| Drive folder | `1FUjKlw-sGvXrApvZ6hSu190m72x1YKDr` |

## Model routing
Runs Moonshot `kimi-k3` at `reasoning_effort: 'high'` with the other three job lanes (Shaheen 2026-07-27).
Model nodes call `api.moonshot.ai/v1/chat/completions` via the `Kimi K3 (Moonshot header)` credential
(`OffvMkWR01zcpqxo`), `max_tokens` 16384, 10-min HTTP timeout. The contract is manifest
`meta.model_routing`, enforced by validator V6. Never change the model here; change it there and run the
generator. #31 makes no model call.

## Why the split (F-9, the reasoning worth keeping)
Before this, `system/manifest.json` #31 carried `n8n: sxEYRyeHH7i1mHzb` and `n8n_cron: "43 15 * * 2,4"`,
and the scanner id `5tPXbhdpp6PfF56V` appeared exactly once in the whole registry: inside a prose
`one_liner`. Two guards read only the structured field, so the scanner had neither:

- **V6 leg (c)** asserts a declared `n8n_cron` against the live scheduleTrigger. The scanner's cron was
  undeclared, so a drifted or PUT-clobbered trigger would never fail a build.
- **`scripts/n8n-active-check.ps1`** (daily 08:10) walks LIVE projects whose `n8n` field is a workflow-id
  string and asserts `active == true`. The scanner was not a value it could see.

**The stage ordering is what makes that dangerous.** #31 banks, #32 drains. If the scanner silently
deactivates, the drain still fires on schedule, finds an empty queue, completes without error and reports
GREEN. A pipeline reporting green because it has no input is worse than one reporting red, because red
gets investigated. The observable symptom is "no new drafts lately", which is indistinguishable from a
slow week in the job market. This is the same shape as the 2026-07-10 silent dual-engine deactivation
that produced the Verify-after-write standing order, with one difference: there the missing output was
noticed, here the missing output is a plausible normal state.

Splitting was chosen over an `n8n_extra[]` array because it needs **zero code change**: two ordinary rows
mean both workflows come under V6 and the active watcher through the paths that already exist.

## Hard boundary (inherited from #31, never violate)
Does NOT edit, feed, or read-mutate `9XuIEfxS71DEetVR` (#03), `9x9M3EnEEeX3O8dy` (#14), their Sheets,
their Drive folders, or their crons. Shared CREDENTIALS and shared infra (Gotenberg) only.

## Skills (bindings)
n8n work is MANDATORY-gated: `n8n-workflow-patterns` first, then `n8n-node-configuration`,
`n8n-code-javascript`, `n8n-validation-expert`. Build via the REST API, backup-first, GET read-back
verified (Verify-after-write). API key: `work/03-application-engine/config/n8n-api-key.txt`.
Writer/CV prompt work: `resume-ats-optimizer` + `resume-tailor` (advisory).

## Trifecta
Gate: **draft-only**. Legs: private_data=true (reads the CV), untrusted_content=true (consumes the
portal postings #31 banked), external_comm=true (produces outbound-destined CV + cover-letter PDFs).
**All three are real here, which is exactly why this half keeps the gate and #31 does not.**

Verified against the live workflow `sxEYRyeHH7i1mHzb` on 2026-07-29 rather than assumed: there is **no
send node** anywhere in it. Outbound HTTP is only `api.moonshot.ai` (the model) and internal
`gotenberg:3000` (PDF render); the strings that pattern-match as `gmail` are Shaheen's own contact block
printed ON the rendered documents, not a delivery path. Alex drafts to Drive, Shaheen submits. The
external leg is defused by that human submit step, which is what `draft-only` asserts.

Source of truth is the `trifecta` block in `system/manifest.json` + [[research/trifecta-map]]; validator
V12 fails the build if this section stops naming the declared gate.

## Vault
- Tier 1: `vault/projects/portal-application-engine/status.md`
- Shared design record: [[research/company-portal-scanning]]; sibling: [[projects/portal-scanner/status]]

## Close-Out Extras
Beyond the universal list: the drain's run_log row exists for the run; pass rate recorded against #31's
banked count (the lane's kill criterion); any model/cron change verified by a GET read-back in the same
run and reflected in manifest `meta.model_routing` / `n8n_cron`.
