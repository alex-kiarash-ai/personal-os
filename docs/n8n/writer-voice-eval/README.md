# Writer Voice Eval (n8n)

**Workflow id:** `grMqmGzzbTXTEdKr` · **State:** INACTIVE (manual-run only; no trigger fires it on a schedule) · **Built:** 2026-07-07 (upgrade-scan item 5).

## What it is, in plain words
A regression test for the job-pipeline's cover-letter/CV writer. The two live job engines (#03 BI,
#14 AI) generate prose with a "voice block" that `scripts/sync-soul-to-n8n.js` injects from `soul.md`.
Every time Shaheen's voice changes and the block is re-synced, the writer's prompt changes in
production, with nothing checking that the change didn't break the output. This workflow is that
check: it runs the REAL writer prompt on a set of test job postings and scores the output on hard,
deterministic rules. If a soul re-sync makes the writer start emitting dashes, or drift out of the
word range, or drop a section, this catches it before the next morning's real applications go out.

It is a SEPARATE workflow and does NOT touch the live 07:00 pipeline.

## Node by node
1. **When clicking Test** (manual trigger) - you press Execute in the editor.
2. **Build Match Request** (code) - outputs 6 seeded test cases. Named exactly "Build Match Request"
   so the copied writer node's `$('Build Match Request')` reference resolves. Each case carries every
   field the writer reads (title, company, location, description, target_role, fit/interest scores +
   rationales, matched_keywords, gaps, company_facts, work_condition_detected).
3. **Build Writer Request** (code) - a VERBATIM copy of the live writer node, so the eval tests the
   exact production prompt (includes the CV, the SYSTEM prompt, the TONE table, and the injected
   `<<<SOUL_VOICE>>>` block). Builds `writer_body` for `claude-sonnet-4-6`.
4. **Claude Writer** (HTTP) - POST to api.anthropic.com/v1/messages, Anthropic credential, batched 1.
   VERBATIM copy of the live node.
5. **Parse Writer** (code) - VERBATIM copy; parses the writer JSON (role_line/profile/experience/
   skills/cover_letter). Its `$('Stage 3 Gate')` read is try/caught, so it degrades cleanly here.
6. **Writer Metrics** (code, per case) - deterministic checks, no judge tokens:
   - em/en dashes in cover_letter + profile = 0 (CV date ranges in `experience` are excluded, since
     "2021-Present" legitimately uses an en-dash),
   - none of the banned AI-tell phrases present,
   - cover-letter word count in [100, 280] (the pipeline's QA range),
   - all structure fields present, and the writer JSON parsed.
   Emits pass/fail + labelled fail reasons per case (labels read from the case node).
7. **Eval Summary** (code, once) - total / passed / failed / pass_rate / verdict + the list of
   failures with the job title and why.

## How to run it
Open the workflow in the n8n editor and click **Execute workflow**. Read the **Eval Summary** node's
output. Do this after every `node scripts/sync-soul-to-n8n.js --apply` (the eval is a sync-soul
TARGET, so its writer node is refreshed in lockstep with the two live engines).

## Kept honest by
`scripts/sync-soul-to-n8n.js` lists this workflow as a third target, so a soul re-sync updates the
eval's writer node too. Costs ~6 Sonnet calls per run (occasional, only after a re-sync).

## Run history (2026-07-07)
- **First run: 4/6 pass.** Caught 2/6 cover letters containing dashes despite the no-dash rule (the
  n8n writer output was not dash-sanitized the way on-machine output is).
- **Fix applied same day:** a deterministic dash sanitizer added to the `Parse Writer` node of #03,
  #14 and this eval (em-dash -> comma; prose en-dash -> comma with numeric ranges protected; date
  en-dashes in experience kept).
- **Re-run after the fix: 6/6 ALL PASS.** Proves the sanitizer works on real writer output. Because
  this eval's Parse Writer is sanitized too, it now grades the SHIPPED (post-sanitize) artifact - a
  dash appearing here would mean a sanitizer edge-case miss, not a routine model slip.
- Resolved 2026-07-08: the model-routing rule now says prose nodes run `claude-sonnet-4-6`, matching
  what this writer actually runs (the rule was corrected to production; the gpt-4.1-mini switch was
  never applied).

_Latest JSON export: `workflow.json` in this folder (gitignored; local-only)._
