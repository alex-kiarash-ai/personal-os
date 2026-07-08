# Reference Map — Refactor v2 (P1-S0 step 4, built 2026-07-08)

Every file that mentions `PROTOCOL.md`, `SYSTEM-GUIDE.md`, `SCHEDULING-GUIDE.md`, `GETTING-STARTED.md`,
the global `~/.claude/CLAUDE.md`, the `work/18-recovery-layer/manifest.json` path, or the two scripts
being absorbed (`generate-surfaces.ps1`, `sync-soul-to-n8n.js`). Grep of the whole tree including the
gitignored vault/ (node_modules, .git, .browser-profile excluded).

Every entry must be resolved by end of Phase 1. Resolution classes:
- **FIX** — updated by this refactor (Phase 1, this agent).
- **RETIRES-WITH-FILE** — the mention lives inside a file that is itself deleted in P1-S2/S4.
- **EXEMPT-SPEC** — the refactor spec + companion analysis doc; they describe the pre-refactor state by design.
- **EXEMPT-HISTORY** — append-only or dated records (vault/log.md, close-out-log.md, dated history/, the 2026-07-06 archived routing table, decisions/carry-over records). Never rewritten; same exemption class the recovery checker uses.
- **ORCHESTRATOR** — live vault pages (index, identity, status, research). Vault propagation is explicitly reserved for the orchestrator session at end of run; exact file:line recorded here so nothing dangles.

## 1. PROTOCOL.md

| File:line | Class | Resolution |
|---|---|---|
| PROTOCOL.md (self) | RETIRES-WITH-FILE | git rm in P1-S1.2 |
| SYSTEM-GUIDE.md:6, :36 | RETIRES-WITH-FILE | file retired in P1-S4 |
| ALEX-REFACTOR-SPEC-FOR-CLAUDE-CODE.md | EXEMPT-SPEC | describes the pre-state |
| docs/architecture-analysis-2026-07-08.md | EXEMPT-SPEC | describes the pre-state |
| vault/identity/alex-explained.md:111, :130 | ORCHESTRATOR | drop the PROTOCOL.md pointer; behavior law = CLAUDE.md + docs/ARCHITECTURE.md |
| vault/me/decisions.md:24 | EXEMPT-HISTORY | dated decision record (pronoun decision) |
| vault/me/carry-overs.md:30 | EXEMPT-HISTORY | dated carry-over record |
| vault/research/alex-c-level-briefing.md:51 | ORCHESTRATOR | dated research page; orchestrator's call to annotate or leave |
| vault/log.md (multiple) | EXEMPT-HISTORY | append-only |

## 2. SYSTEM-GUIDE.md

| File:line | Class | Resolution |
|---|---|---|
| SYSTEM-GUIDE.md (self) | RETIRES-WITH-FILE | git rm in P1-S4 |
| GETTING-STARTED.md:3 | RETIRES-WITH-FILE | file retired in P1-S4 (replaced by generated docs/GETTING-STARTED.md) |
| ALEX-REFACTOR-SPEC / architecture-analysis | EXEMPT-SPEC | — |
| vault/identity/installing-alex.md:11 | ORCHESTRATOR | pointer becomes docs/GETTING-STARTED.md + docs/ARCHITECTURE.md |
| vault/identity/alex-explained.md:129 | ORCHESTRATOR | same |
| vault/me/decisions.md:24, carry-overs.md:30/33/34/35 | EXEMPT-HISTORY | dated records |
| vault/research/alex-c-level-briefing.md:51 | ORCHESTRATOR | see above |
| vault/projects/morning-brief/history/2026-07-05.md:22 | EXEMPT-HISTORY | dated brief |
| vault/log.md | EXEMPT-HISTORY | append-only |

## 3. SCHEDULING-GUIDE.md

| File:line | Class | Resolution |
|---|---|---|
| SCHEDULING-GUIDE.md (self) | RETIRES-WITH-FILE | git rm in P1-S4 (content → templates/getting-started.template.md scheduling section) |
| SYSTEM-GUIDE.md | RETIRES-WITH-FILE | — |
| ALEX-REFACTOR-SPEC / architecture-analysis | EXEMPT-SPEC | — |
| vault/me/carry-overs.md:35 | EXEMPT-HISTORY | dated record |

## 4. GETTING-STARTED.md (root, hand-written)

| File:line | Class | Resolution |
|---|---|---|
| GETTING-STARTED.md (self) | RETIRES-WITH-FILE | git rm in P1-S4; replacement generated at docs/GETTING-STARTED.md |
| SYSTEM-GUIDE.md | RETIRES-WITH-FILE | — |
| ALEX-REFACTOR-SPEC / architecture-analysis | EXEMPT-SPEC | — |
| vault/me/carry-overs.md:34 | EXEMPT-HISTORY | dated record |

## 5. Global ~/.claude/CLAUDE.md

| File:line | Class | Resolution |
|---|---|---|
| CLAUDE.md:314 (Change Propagation item 2) | FIX | S1.3: standing order moves to "Standing Orders" at top; global file thinned (Case A) |
| CLAUDE.md:332 (Close-Out B "root & global CLAUDE.md") | FIX | S1.3: reword — global file is thin, no Alex orders there |
| PROTOCOL.md:93 | RETIRES-WITH-FILE | — |
| SYSTEM-GUIDE.md:34-35 | RETIRES-WITH-FILE | — |
| vault/identity.md:20, :97 | ORCHESTRATOR | update: global file = graphify pointer only |
| vault/me/build-playbook.md:25 | ORCHESTRATOR | "root/global CLAUDE.md" → root CLAUDE.md Standing Orders |
| vault/research/alex-close-out-gate.md:50 | ORCHESTRATOR | same |
| vault/projects/recovery/github-backup-plan.md:72 | EXEMPT-HISTORY | dated done-item |
| Verbatim pre-edit copy | FIX | saved at refactor/global-claude-md-original-2026-07-08.md before editing |

## 6. work/18-recovery-layer/manifest.json path (→ system/manifest.json per A2)

| File:line | Class | Resolution |
|---|---|---|
| work/18-recovery-layer/check.ps1:31 (`Join-Path $here "manifest.json"`) | FIX | point at `$repo/system/manifest.json` |
| work/18-recovery-layer/CLAUDE.md:25 (+ prose around) | FIX | new path |
| work/16-alex-hq/scripts/build-projects.mjs:2, :12 | FIX | new path (default arg + comment) |
| work/16-alex-hq/CLAUDE.md:66 | FIX | new path |
| .claude/commands/alex-hq.md:16 | FIX | new path |
| .claude/commands/new.md:13 | FIX | new path |
| CLAUDE.md:231, :233 (routing preamble + BEGIN marker) | FIX | S1.4 + regenerated in S3 with new marker text |
| docs/projects/README.md:3, :7 | FIX | S1.4 + regenerated in S3 |
| scripts/generate-surfaces.ps1:2/24/27/67/78 | FIX then RETIRES-WITH-FILE | path updated in S1.4 (script stays functional until absorbed), retired in S4 |
| scheduler/schedule.md:107 | FIX | new path |
| work/voice/README.md:11 | FIX | new path |
| manifest.json meta.purpose (self-reference) | FIX | text updated during the move |
| docs/projects/routing-table-detail-2026-07-06.md:3 | EXEMPT-HISTORY | explicit archive ("history, not truth") |
| PROTOCOL.md:98 | RETIRES-WITH-FILE | — |
| ALEX-REFACTOR-SPEC / architecture-analysis | EXEMPT-SPEC | — |
| vault/identity.md:37/41/46/103/110 | ORCHESTRATOR | new path |
| vault/index.md:163 | ORCHESTRATOR | new path |
| vault/projects/recovery/status.md:21, :43 | ORCHESTRATOR | new path |
| vault/projects/recovery/recovery-layer-plan.md:24 | ORCHESTRATOR | new path |
| vault/projects/{alex-hq,job-pipeline,morning-brief,research-team}/status.md | ORCHESTRATOR | new path where the mention is live prose |
| vault/research/alex-upgrade-scan-2026-07.md:35, alex-full-audit-2026-07.md:18 | EXEMPT-HISTORY | dated research snapshots |
| vault/log.md | EXEMPT-HISTORY | append-only |

## 7. scripts/generate-surfaces.ps1 (absorbed into generator in P1-S3/S4)

| File:line | Class | Resolution |
|---|---|---|
| scripts/generate-surfaces.ps1 (self) | RETIRES-WITH-FILE | git rm in P1-S4 after generator dry-run passes |
| CLAUDE.md:231 (routing preamble) | FIX | regenerate-instruction becomes `node scripts/generate-alex.js` |
| CLAUDE.md:233 marker text | FIX | new marker text written by gen-claude-region.js |
| docs/projects/README.md:3, :7 | FIX | same |
| .claude/commands/new.md:13 | FIX | same |
| work/18-recovery-layer/CLAUDE.md:25 | FIX | same |
| manifest.json meta.purpose | FIX | same |
| docs/projects/routing-table-detail-2026-07-06.md:3 | EXEMPT-HISTORY | archive |
| PROTOCOL.md:98 | RETIRES-WITH-FILE | — |
| vault/identity.md, vault/index.md:163, vault/projects/recovery/status.md:43 | ORCHESTRATOR | new generator name |
| vault/log.md | EXEMPT-HISTORY | — |

## 8. scripts/sync-soul-to-n8n.js (absorbed into generator in P1-S3/S4)

| File:line | Class | Resolution |
|---|---|---|
| scripts/sync-soul-to-n8n.js (self) | RETIRES-WITH-FILE | git rm in P1-S4 |
| CLAUDE.md:201 (model routing, soul.md delivery) | FIX | S1.1 rewrite names the generator |
| CLAUDE.md:332 (Close-Out B re-sync trigger) | FIX | re-sync trigger becomes the generator |
| work/03-application-engine/CLAUDE.md:56 | FIX | new command |
| docs/n8n/writer-voice-eval/README.md:7, :41, :45 | FIX | new command |
| .gitignore:81 (comment) | FIX | comment reworded (n8n-backups dir stays) |
| PROTOCOL.md | RETIRES-WITH-FILE | — |
| vault/projects/self-review/close-out-log.md | EXEMPT-HISTORY | append-only |
| vault/log.md | EXEMPT-HISTORY | — |

## Status (closed 2026-07-08, end of Phase 1)

- [x] All FIX entries resolved (P1-S1 → P1-S4). Grep-proven: remaining tracked-file mentions of
      retired names are either the refactor spec / analysis doc (EXEMPT-SPEC), the explicit
      routing-table archive (EXEMPT-HISTORY), this map, or provenance notes that name the script AS
      retired/absorbed ("replaced generate-surfaces.ps1", "absorbed from the retired
      sync-soul-to-n8n.js") - history, not dangling pointers.
- [x] All RETIRES-WITH-FILE entries gone with their files (P1-S4: PROTOCOL.md, SYSTEM-GUIDE.md,
      SCHEDULING-GUIDE.md, root GETTING-STARTED.md, generate-surfaces.ps1, sync-soul-to-n8n.js)
- [ ] ORCHESTRATOR entries: OPEN, handed to the orchestrator session (vault propagation is its
      scope by explicit instruction). Exact file:line list above; the big ones are
      vault/identity.md, vault/index.md:163, vault/projects/recovery/{status,recovery-layer-plan}.md,
      vault/identity/{alex-explained,installing-alex}.md, vault/me/build-playbook.md:25,
      vault/research/alex-close-out-gate.md:50.
- [x] EXEMPT classes justified inline
