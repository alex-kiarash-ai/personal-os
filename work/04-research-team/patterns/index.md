# Pattern Library — Research Team

Reusable team architectures from past research runs. Check here BEFORE designing a new team. Format spec in work/04-research-team/CLAUDE.md.

| Pattern | Class | Times used | One-liner |
|---------|-------|------------|-----------|
| [science-explainer](science-explainer.md) | other | 1 | "How/why does X work" question that splits into 2 independent science sub-questions; two parallel lanes + synthesizer that separates fact from folklore. |
| [other-flight-search](other-flight-search.md) | other | 1 | "Cheapest flight" live lookup; no team. Kiwi aggregator with flex-date tiling, parse the saved JSON locally, nonstop = 1 layover entry, filter by stay nights, rank by price. |
| [decision-brief-concept-validation](decision-brief-concept-validation.md) | decision-brief | 3 | "Validate this idea/spec, up/downside, worth building?" Verify only the load-bearing claims the author asserted but didn't check — 3 lanes: cost/viability, prior-art/sellability, core-mechanism (does the "it learns/compounds" claim survive ML/stats reality). Correct your own prior in synthesis. |
| [technical-evaluation-internal-audit-stack-scan](technical-evaluation-internal-audit-stack-scan.md) | technical-evaluation | 3 | "Build X on our own system: what of ours feeds it + what infra signals exist + best external tooling?" Two Explore audit lanes (projects, infra) + one web Stack Scout given an explicit hypothesis to falsify. Synthesizer ranks v1 vs bench and resolves flags with documented judgment calls. Also fits designing a missing system layer (reuse 2: Recovery) and hardening a proposed architecture (reuse 3: Health Tracker). |
| [verification-qa-built-artifact](verification-qa-built-artifact.md) | verification | 1 | "Is this thing I just built actually correct + complete?" Post-build QA of code + its outputs. 3 parallel lanes: static auditor (line-by-line correctness/invariants/portability) + dynamic edge-case tester (isolated fixture, inject one fault per feature) + findings verifier (re-derive outputs, hunt false negatives + self-referential bugs). Synthesize MUST/SHOULD/NICE/DEFERRED. |

Rules:
- A pattern earns its file by being used, not imagined. No speculative patterns.
- Update `last_used` and `times_used` on every reuse; append to Lessons when something changed.
- If a pattern fails twice, rewrite it or delete it.
