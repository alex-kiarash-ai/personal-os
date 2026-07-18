# Fit rubric - scoring every parsed brief 0-100

Reasoning call, no voice block. Score = sum of the parts below; the digest orders by score. Ledger threshold: **score >= 40 gets a ledger row** (below 40 = digest-only line, no row - noise stays out of the CRM). Draft threshold: **top 0-2 fits of the day AND score >= 65**.

## The profile these scores serve (locked facts, from vault/projects/modeling/status.md)
Male, Stockholm-based, available worldwide. Lanes: **hair** (the #1 bio word and the arbitrage lane), **fitness**, **commercial**. Booking address: shaheen@shaheenkiarash.com. IG @shaheen.kiarash (~100 followers, so briefs requiring big reach score honestly low on that leg).

## Scoring
| Dimension | Points | Rule |
|---|---|---|
| Gender requirement | 0 or 25 | male/any/unstated = 25; female-only = 0 AND the brief is dropped from the digest entirely (not a fit question, a fact) |
| Category | 0-25 | hair = 25 · fitness = 20 · commercial = 20 · editorial/other modeling = 10 · statist/extra work = 5 · non-modeling = 0 |
| Location | 0-20 | Stockholm = 20 · remote/submit-from-anywhere = 18 · rest of Sweden = 12 · EU + travel covered = 10 · EU no travel comp = 5 · elsewhere = 2 |
| Compensation | 0-20 | paid, rate stated = 20 · paid, rate unstated = 14 · TFP with a strong portfolio angle = 8 · unpaid/exposure = 2 |
| Deadline feasibility | 0-10 | >=3 days out = 10 · 1-2 days = 6 · same-day = 3 · passed = 0 (and mark dead) |

## Modifiers (applied after the sum, floor 0 / cap 100)
- **SCAM-SUSPECT flag set:** score forced to 0, brief stays visible in its own band.
- **Hair-lane exact match** (hair model / harmodell / grooming / hair-loss brief): +10 (the B2 arbitrage: his #1 bio word, everyone else's blind spot).
- **Repeat client/platform we've booked with before** (ledger shows a booked/delivered row, same source): +5.
- **Brief demands follower minimums we don't meet:** -15, and say so in the digest line (honest, not hidden).
- **Usage rights red flag in the brief text** (perpetual/all-media buyout language at a flat low rate): -10 + a rights note in the digest line (the rights register discipline starts at the brief, not the contract).

## Floor mode (`-Floor` on the wrapper)
Ledger threshold rises to 60, draft threshold to 80, digest caps at the top 3 lines. Everything else unchanged.
