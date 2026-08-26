# Portal Application Engine (stage 2 of the company-portal job lane)

> **Split from #31 on 2026-07-28** (command-layer review F-9). The portal lane has always been TWO n8n
> workflows, but the manifest carried only one, so the scanner's id and cron lived in prose and nothing
> asserted them. This entry gives the drain half its own registry row. See "Why the split" below.

## 2026-08-07 Anthropic split migration: opus-5 scores, sonnet-5 writes (SUPERSEDES kimi-k3)

Moved off Moonshot kimi-k3 back to Anthropic, Shaheen's call. **`Claude Match+Research` -> `claude-opus-5`**
(fit scoring is the judgment call), **`Claude Writer` -> `claude-sonnet-5`** (the soul.md voice block carries the
prose). Both call `api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01`.

**Why:** the Moonshot org went to a NEGATIVE balance (`cash_balance -4.37`, `available 0`) and every kimi-k3 call
returned HTTP 429 *"account is suspended due to insufficient balance"*. An account suspension wearing a rate-limit
status code, so retry/backoff/spacing do nothing: 60/60 failed at one call per 3s. The account had been recharged
8.34 USD on 08-05 and drained inside a day. **n8n discards the provider body on a thrown HTTP error**, so the
execution record shows only its canned "too many requests" text - the real reason is not visible there. Read the
body from a live probe before diagnosing a 429.

**Provider migration, not a string swap.** Per lane: the two `Claude *` HTTP nodes repointed to Anthropic with
`predefinedCredentialType`/`anthropicApi`; the two Build nodes rewritten from OpenAI `messages:[system,user]` +
`reasoning_effort` to a top-level Anthropic `system` BLOCK with a `cache_control` breakpoint +
`thinking:{type:'adaptive'}` + `output_config:{effort:'high'}` + user-only `messages`; the two Parse nodes moved
from `choices[0].message.content` to the TEXT blocks of `content[]` and to Anthropic usage fields
(`input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`), with `stop_reason`
handling for `max_tokens` and `refusal`. `max_tokens` stays 16384: on this family it caps thinking AND text together.

**The trap that would have failed silently:** adaptive thinking is ON BY DEFAULT on opus-5/sonnet-5, so
`content[0]` is a THINKING block. A `content[0].text` reader returns empty on every call and every job dies at the
gate as a parse error - an outage that looks like a model fault. The parse filters `type === 'text'` and joins.

**Prompt caching is back and it is the cost story:** system prompt + master CV is ~9.3K chars of identical prefix
per job, and Moonshot had no cache-write tier. From the second call in a run that prefix bills at ~0.1x (live probe:
2277 cache-write tokens, 12 uncached input). opus-5 $5/$25 per M, sonnet-5 $3/$15 ($2/$10 intro to 2026-08-31).

**Proven, not asserted:** both credentials probed live on 4 candidate models (200 OK); the exact generated body
shape probed against the real API on both models (200, cache write confirmed); the patched Parse nodes run offline
against healthy / thinking-first / refusal / truncated / n8n-error-item / fenced replies (35/35); Writer Voice Eval
re-run on sonnet-5 = **6/6 ALL PASS, 0 dashes, no AI tells**; independent read-back on all four lanes.

**V6 enforces BOTH models now.** `meta.model_routing.overrides[].models` pins each node by name, because V6 leg (a)
only inspects `checked_node` (`Build Writer Request`) and leg (b) skips voice-sync targets - the opus-5 scoring call
would otherwise have been enforced by nothing. Negative-tested: a deliberately wrong pin fails V6 naming the node.

Script + backups (gitignored, `.gitignore:80`): `work/03-application-engine/config/apply-anthropic-migration-2026-08-07.js`
(`--dry` / `--restore` / `--only=<id>`), `backup-before-anthropic-<id>-*.json`.

**#32 only:** `Format Processed Row` still carries a live RATES map (its processed_jobs ledger survived the 07-28
simplify; #03/#14's did not). `claude-opus-5` ($5/$25, cache 6.25/0.5) and `claude-sonnet-5` ($3/$15, cache
3.75/0.3) were priced in. **The `kimi-k3` row is kept on purpose** so already-logged rows still price correctly
instead of falling through to the deliberately-expensive `_fallback`. sonnet-5 is listed at LIST price, not the
$2/$10 intro, matching that module's rule that a model should over-report rather than quietly under-report.
**Posture untouched:** loud posture (retry 4x5s, no `onError`), node count 34, canvas positions unmoved.

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
- **`scripts/n8n-active-check.mjs`** (daily 08:10) walks LIVE projects whose `n8n` field is a workflow-id
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

## Filename law (STANDING ORDER, Shaheen 2026-08-20, every lane, every producer)

His words: *"NEVER AGAIN when you prduce a new CV for any compay, mention the company name in the
file name itself. Nver again. fix this! Only my name and CV or a cover letter."*

Only two filenames may ship: **`Shaheen_Kiarash_CV.{pdf,docx}`** and
**`Shaheen_Kiarash_Cover_Letter.{pdf,docx}`** (the live engines' `Shaheen_Kiarash_CoverLetter.pdf`
also passes). No company, no role, no lane, no date, no version. Those belong in the FOLDER name and
the ledger row, which never leave this machine. The filename travels with the attachment: a
per-company name tells the recruiter this is one of many tailored versions and, on a forward, names
the target. Enforced by `node scripts/outputs-ledger.js validate` (exit 2), which the Monday recovery
sweep C12 calls; files dated before 2026-08-20 are grandfathered as already-sent history.
