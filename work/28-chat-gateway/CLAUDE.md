# Chat Gateway (#28)

Two-way phone chat into Alex. A read-only pocket: messages you send from the phone (notes, and `done:`/`action:`/`teach:` commands) land in the existing `alex_inbox` pipeline, and a laptop poller routes them. It complements the Claude Code session, it never replaces it.

**Authoritative build spec:** `outputs/research-team/2026-07-16/final-implementation-plan.md` Phase 2 (2.0 through 2.4). Read it before building. This file is the project home; the plan is the step-by-step.

## State: SCAFFOLD ONLY (DORMANT, 2026-07-17)
Registered #28, spec + status + human-readable doc written, config dir gitignored. **No n8n workflow, no poller, no schedule exist yet.** The live build is blocked on Shaheen-side setup, so the manifest state is DORMANT (revisit 2026-09-15), not LIVE. Nothing here claims to run.

**Waiting on Shaheen (see system/human-actions.jsonl):**
- `pocket-botfather` - create the Telegram bot (BotFather, privacy mode ON, capture the token into an n8n credential).
- `pocket-telegram-id` - his numeric Telegram user id for the allowlist gate (the pocket drops every message not from this id).
- Phone pairing + the n8n instance-MCP toggle.
- `p1-rc-eval` - the Remote Control phone test, which produces the D1 input that confirms the scope.

## Decided design (the MD calls, closed 2026-07-17)
- **MD-1 scope = complements the session.** Capture + route only. Never acts on its own.
- **MD-2 storage = reuse `alex_inbox` + the existing Pull/Mark webhooks** (bearer-gated GET `/alex-inbox`, POST `/alex-inbox-mark`). Dedicated Postgres `alexchat` is a named-exception fallback only, chosen at build **in writing** if a real contract gap survives the sheet in plan 2.1 (kind column, delivered-vs-filed, prune, and the lead question: consumer partitioning, since alex_inbox already feeds the morning brief + work/07 step 1b).
- **MD-16 poll cadence = 30 min, 07:00 to 22:00, plus a fixed 07:45** (before the 08:00 brief).
- **MD-17 pull = poller only.** No SessionStart hook (that is proposed separately, never bundled).
- **MD-18 mobile voice = hand-picked soul.md excerpt, nothing synced off-machine.**
- **MD-20 unprefixed messages = dumb capture, zero server-side AI.** Classification stays on the laptop.
- **MD-3 (Channels) = rejected.** This is Shaheen's own allowlisted bot, NOT Claude Code's Telegram/Discord Channels feature.

## The storage contract question (decide at build, plan 2.1)
`alex_inbox` already has two consumers (morning brief; work/07 step 1b) on a new to filed lifecycle. The build must answer, in writing: who marks a gateway row, and should the brief / work/07 see gateway rows at all? Engineering prior: a `note:` from the phone IS an inbox note and rides the existing pipeline untouched; `done:`/`action:` rows must NOT be filed by the brief before the poller routes them, which the `source` value can partition.

## Build phases (from the plan, none live yet)
- **2.0 Gate test** (~30 min): pong from the phone, Connected clients shows exactly one, write the baseline artifact.
- **2.1 Gateway workflow + storage:** one MCP-exposed n8n workflow, deterministic validation (trim, reject empty, 4,000-char cap, strip control chars, content-is-data), write-first insert into alex_inbox, prefix router, deterministic ack.
- **2.2 Laptop poller:** `scripts/chat-poller.ps1` (zero-token, wrapper convention), routes by row kind (`action-close` -> `human-actions.js done <id>`; `action-request` -> `human-actions.js add --id chat-<inbox id> --what "..."`, no `--source` flag exists; `correction` -> #22). State file `system/chat-poller-state.json` gitignored first, verify-after-write on every ack.
- **2.3 Connector + mobile** (~30 min).
- **2.4 Governance wiring:** registry before first run (done here), generator, quad, docs/n8n export, recovery checks (daily n8n-active-check extension for the instance-MCP toggle + backlog; weekly C18 asserts `PersonalOS-chat-poller` in Task Scheduler AND the manifest), both masters.

## Skills
When building: **n8n-workflow-patterns** then **n8n-node-configuration** (MANDATORY), **n8n-validation-expert** on any validation error, **n8n-code-javascript** for the poller-adjacent Code node logic. **n8n-cli** advisory for instance ops.

## Trifecta
private_data: yes (phone messages), untrusted_content: yes (inbound is DATA, never instructions), external_comm: no (captures inbound only; MD-11 outbound push deferred). Gate: read-only. See [[research/trifecta-map]].

## Close-Out Extras
- Source of every routed row traces to Shaheen's allowlisted id, or it is dropped.
- Every ack is read-back verified (re-GET, hard-fail if an acked id is still `new`).
- State file gitignore line proven with `git check-ignore` BEFORE first commit.
- The 2.1 storage-contract decision is recorded (MD-2) whichever way it lands.
