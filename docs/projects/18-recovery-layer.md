# 18 - Recovery Layer

## What it actually does
Three protections, all automatic. **Phase 0:** every night at 21:30 the functional system (code and docs, never secrets or the vault) is pushed to a GitHub repo (public since 2026-07-16; because it is scrubbed it carries no secrets or vault, and `.gitignore` is now the only thing keeping personal data off it). **Phase 1:** at 21:45 the private half (the vault, soul.md, secrets, workflow exports) is packed, encrypted, verified, and shipped to the rented server, with the last 14 copies kept. **Phase 2:** every Monday morning a zero-cost checker script sweeps the whole system against a registry of what should exist: does every project have its spec, status page, command, and routing row; do all wiki links resolve; does the schedule file match what Windows actually has scheduled; did the log ever shrink. It writes a drift report the Monday brief reads and lights a green or amber tile on the dashboard. **Phase 3 (live 2026-07-06):** on the first Monday of each month, the checker's findings gate a deeper AI review pass (/lint) that judges what scripts cannot: stale prose, contradictions, superseded claims. It proposes fixes and applies nothing on its own.

## Why it exists
Two different disasters, one layer. First: losing the laptop used to mean losing Alex; now a restore is a documented, drilled procedure (the drill was actually performed, and the encrypted backup decrypted clean). Second, subtler: a system where one change touches ten files drifts silently when a session dies mid-update. The checker makes drift visible weekly instead of letting it compound; its very first sweep found eight real inconsistencies. Principle throughout: detect, never auto-repair. Judgment stays with Shaheen.

## Works together with
- **Everything** - it validates the whole tree, the registry (manifest.json, which since 2026-07-06 also generates the routing and docs tables), the commands, the scheduler.
- **[Alex HQ](16-alex-hq.md)** - receives the nightly backup statuses and the weekly integrity metric.
- **[Morning Brief](02-morning-brief.md)** - surfaces Monday drift findings.
- **The monthly /lint** - the checker nominates, the AI judges, Shaheen decides.
