# Fit rubric - scoring every parsed brief 0-100

Reasoning call, no voice block. Score = sum of the parts below; the digest orders by score. Ledger threshold: **score >= 40 gets a ledger row** (below 40 = digest-only line, no row - noise stays out of the CRM). Draft threshold: **top 0-2 fits of the day AND score >= 65**.

## The profile these scores serve (locked facts, from vault/projects/modeling/status.md)
Male, Stockholm-based, **searching worldwide** (Shaheen 2026-07-22: location is not a gate, travel-cost is the only discount). Lanes: **hair** (the #1 bio word and the arbitrage lane), **fitness**, **commercial**. Booking address: shaheen@shaheenkiarash.com. IG @shaheen.kiarash (~100 followers, so briefs requiring big reach score honestly low on that leg).

**Active radar sources (Shaheen 2026-07-22): Statist, ModelManagement, ACasting ONLY.** StagePool / Jooble / StarNow are deactivated as sources (see parsers.md); their mail is ignored, not scored. **Criteria the radar applies: worldwide (in scope), male-only, no nude/erotic briefs (dropped).**

## Scoring
| Dimension | Points | Rule |
|---|---|---|
| Gender requirement | 0 or 25 | male/any/unstated = 25; female-only = 0 AND the brief is dropped from the digest entirely (not a fit question, a fact) |
| Category | 0-25 | hair = 25 · fitness = 20 · commercial = 20 · editorial/other modeling = 10 · statist/extra work = 5 · non-modeling = 0 |
| Location | 0-20 | remote/submit-from-anywhere = 20 · travel + lodging covered (anywhere worldwide) = 18 · Stockholm = 16 · rest of Sweden = 14 · EU no travel comp = 10 · elsewhere no travel comp = 6 (worldwide is IN SCOPE since 2026-07-22; location is a mild travel-cost discount, never a drop) |
| Compensation | 0-20 | paid, rate stated = 20 · paid, rate unstated = 14 · TFP with a strong portfolio angle = 8 · unpaid/exposure = 2 |
| Deadline feasibility | 0-10 | >=3 days out = 10 · 1-2 days = 6 · same-day = 3 · passed = 0 (and mark dead) |

## Hard exclusions (dropped from the digest entirely - a fact, not a fit question)
- **Female-only casting** (also enforced in the Gender row): dropped.
- **Nude / implied-nude / erotic / boudoir / fetish / adult content required** (Shaheen's hard no, 2026-07-22): dropped, with a one-line `declined: nude brief` note in the digest so nothing is silently swallowed. **Shirtless / swimwear / underwear commercial or fitness work is NOT nude and stays fully in scope** - the exclusion targets nude/erotic REQUIREMENTS, not skin.
- **Deactivated source** (StagePool / Jooble / StarNow mail, 2026-07-22): ignored, not scored, not counted as unparsed (see parsers.md).

## Modifiers (applied after the sum, floor 0 / cap 100)
- **SCAM-SUSPECT flag set:** score forced to 0, brief stays visible in its own band.
- **Hair-lane exact match** (hair model / harmodell / grooming / hair-loss brief): +10 (the B2 arbitrage: his #1 bio word, everyone else's blind spot).
- **Repeat client/platform we've booked with before** (ledger shows a booked/delivered row, same source): +5.
- **Brief demands follower minimums we don't meet:** -15, and say so in the digest line (honest, not hidden).
- **Usage rights red flag in the brief text** (perpetual/all-media buyout language at a flat low rate): -10 + a rights note in the digest line (the rights register discipline starts at the brief, not the contract).

## Floor mode (`-Floor` on the wrapper)
Ledger threshold rises to 60, draft threshold to 80, digest caps at the top 3 lines. Everything else unchanged.
