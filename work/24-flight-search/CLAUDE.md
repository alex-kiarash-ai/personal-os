# Flight Search (24)

## Type
Automation (on-demand, multi-source parallel orchestration). Not scheduled.

## Purpose
Ask Alex for flights between two (or more) cities and get back the cheapest and best real options, pulled live from four sources at once. Alex is the master agent: it takes the criteria in a short hybrid Q&A, fans the exact same search out to four flight lanes in parallel (Kiwi, Turkish Airlines, Google Flights, Skyscanner), aggregates everything, deduplicates to the single cheapest instance of each flight, ranks by Shaheen's rules (short-haul direct-only; long-haul direct + one-stop, price weighted over time), and returns a clean table of the top 3-4 with clickable booking links. Every search is fresh (prices change daily, so nothing is ever cached), all four lanes always run (no smart pruning), and a lane that is down is reported cleanly while the others still answer. The search context is kept for 30 minutes so Shaheen can ask follow-ups, then it expires and the next search starts clean.

## Entry Points
- On-demand only. `/flight-search` (optionally with the request inline: `/flight-search ARN to IST Aug 1`), or spoken/typed natural language: "find me flights Stockholm to Istanbul", "cheapest ARN-IST first week of August, flexible". NOT scheduled. NOT auto-triggered.

## What Alex already knows (never ask these)
Baked in from Shaheen's brief + [[me/role]] - do not re-ask:
- **Cabin:** always economy.
- **Party:** always solo (1 adult).
- **Price ceiling:** none.
- **Airline preference:** none.
- **Home base:** Stockholm. If "from" is omitted, propose **ARN (Stockholm Arlanda)** and confirm, don't assume silently.

## The intake (hybrid, two batches)
Ask via AskUserQuestion where options help; keep it tight. Skip a batch if the opening request already answered it. Always let him short-circuit with "just search".

**Batch 1 - the core (ask first, always):**
1. Where flying **from**? (city or IATA; default-suggest ARN if omitted)
2. Where **to**?
3. **Outbound date**?

**Batch 2 - the follow-ups (ask after batch 1 lands):**
4. **Return date, or one-way?**
5. **Flexible on dates, and by how many days?** Flexibility is **per leg** - outbound and return can differ (e.g. "Aug 1 +/- 2 days out, Aug 10 exact back").
6. **Direct only, or open to one-stop if it is cheaper?** (This is the manual override of the haul-type default below.)

**Multi-city:** if Shaheen asks for a multi-city trip, take the legs in order (leg 1 A->B on date X, leg 2 B->C on date Y, ...). Each leg is its own fan-out to all four lanes. Present per-leg tables, or one combined itinerary when the legs chain into a single trip.

## Haul-type default (before asking Q6, and as the fallback if he does not specify)
Resolve the route to IATA codes, estimate the nonstop flight time:
- **Short-haul (under ~3 hours nonstop):** direct only. Do not surface one-stops.
- **Long-haul (~3 hours or more):** show **direct and one-stop** options, and rank with **price weighted heavier than time**.
Q6 (direct-only vs one-stop-if-cheaper) always overrides this default when Shaheen answers it.

## The runtime flow (executed by Alex per search)
1. **Intake** - run the two batches above. Fill known constants (economy, solo, no ceiling, no airline pref) without asking.
2. **Resolve airports** - city -> IATA. If a city has multiple airports (LON: LHR/LGW/STN..., STO: ARN/BMA/NYO/VST), say so and either search the metro group or confirm which.
3. **Set haul type** - compute nonstop duration, apply the short/long-haul rule, honor any explicit Q6 override.
4. **Fan out - ALL FOUR LANES, IN PARALLEL, EVERY TIME.** Same criteria to each. No smart pruning, no "this source is probably best" shortcut. The four lanes:
   - **Kiwi** -> `mcp__claude_ai_Kiwi_com__search-flight` (one-way, return, date ranges; deep booking link in the result).
   - **Turkish Airlines** -> `mcp__turkish-airlines__search_flights` (outbound) + `mcp__turkish-airlines__search_inbound_flights` (return leg) + `mcp__turkish-airlines__find_flight_price_calendar` (flex-date grid).
   - **Google Flights** -> `mcp__google-flights__*` (wired 2026-07-08; loads next session start - see Sources below).
   - **Skyscanner** -> not wired by decision (pluggable slot; see Sources below). Reports "unavailable" until a legit MCP exists.
   Load any deferred MCP tools via ToolSearch first. Pass: from IATA, to IATA, date(s), adults=1, cabin=economy.
   - **Flex dates:** expand the per-leg +/- window into the date grid, query each date, keep the cheapest per option. Use each source's native calendar/range feature where it has one (Kiwi date ranges, Turkish price calendar) instead of N separate calls where possible.
5. **Handle a down lane cleanly** - a lane that errors, is unavailable, or is not installed is **reported, not hidden**: "Skyscanner: unavailable" under the table. Never fabricate a result for it, never block the other three. A down lane is a note, not a failure of the search.
6. **Normalize + dedupe** - for every returned option capture: departure time, route (IATA codes **and** city names), stops (direct, or 1-stop + the middle airport), price + currency **exactly as the source returned it (no conversion)**, source, booking link. If the **same flight** (same operating flight/route + times) comes back from more than one source at different prices, **keep only the cheapest instance** - no flags, no "cheaper on X" comparison. If price, route, and time are all identical across sources, show it **once**.
7. **Rank** - by Shaheen's rules:
   - Short-haul: direct only, order by price.
   - Long-haul: direct + one-stop, **price weighted heavier than time**.
   - **Tie-break:** same price **and** same route but **different times** -> both get the **same rank** (e.g. two "Option 1" rows). Same price **and** route **and** time -> shown once (dedup).
8. **Display** - a clean markdown table, top **3-4** options (see format below).
9. **Result memory (30 min)** - keep this search's criteria + results in conversational context for **30 minutes** so follow-ups land ("what about coming back the 12th?", "show me the one-stops"). After 30 minutes the memory **expires** and the next request is treated as a brand-new search. This is conversation memory only - it is **NOT a price cache**. If a follow-up after expiry needs prices, re-run the lanes live.

## Result table format
Top 3-4 options, markdown:

| Rank | Departure | Route | Stops | Price | Source | Book |
|------|-----------|-------|-------|-------|--------|------|
| Option 1 | Aug 1, 09:15 | ARN Stockholm -> IST Istanbul | Direct | 2 465 SEK | Turkish | [Book](https://...) |
| Option 2 | Aug 1, 14:40 | ARN Stockholm -> IST Istanbul | 1 stop (VIE Vienna) | 1 980 SEK | Kiwi | [Book](https://...) |

- **Departure:** date + local time.
- **Route:** IATA + city both, `ARN Stockholm -> IST Istanbul`. For a stop, name the middle airport in the Stops cell.
- **Stops:** `Direct` or `1 stop (XXX City)`.
- **Price:** number + the source's own currency. **No conversion, ever.** If two sources gave different currencies, each row shows its own.
- **Source:** which lane found it (Kiwi / Turkish / Google Flights / Skyscanner).
- **Book:** a **markdown** link so it is right-click/copy-paste-able in Claude Code.
- Below the table, one line listing any lanes that were down.

## Hard constraints (do not violate)
1. **Fresh every search.** Never cache or reuse a price from a previous search. Prices change daily.
2. **All four lanes, always.** No smart pruning, no "skip the slow one".
3. **Graceful degradation.** A down/unavailable lane is reported; the search continues on the rest.
4. **Cheapest-only on cross-source duplicates.** Same flight at different prices -> show only the cheapest. No flags, no comparisons.
5. **Currency as returned.** No FX conversion.
6. **Booking links as markdown.**
7. **30-minute result memory, then expire.** Memory is conversation context, not a price store.

## Sources (as built 2026-07-07)
- **Kiwi.com** - LIVE. `mcp__claude_ai_Kiwi_com__search-flight`. Connected via the claude.ai connector. Returns deep booking links. Seeded the original one-off flight lookup ([[research/flight-stockholm-istanbul-aug2026]], research-team run 2) and the `other-flight-search` pattern (flex-date tiling, parse locally, nonstop handling, rank by price).
- **Turkish Airlines** - LIVE. `mcp__turkish-airlines__*` (HTTP MCP). `search_flights` + `search_inbound_flights` + `find_flight_price_calendar`.
- **Google Flights** - **WIRED 2026-07-08** (Shaheen's go). MCP server `google-flights` = `uvx --from flights[mcp] fli-mcp` (PyPI `flights` 0.9.0 = punitarani/fli, FastMCP stdio, **no key**), added at local/project scope, verified `✔ Connected` via `claude mcp list`. Its tools appear as `mcp__google-flights__*` from the **next session start** (MCP servers load at startup, so a search in the very session it was installed still sees it "unavailable"). It scrapes public Google Flights data: no key, but it can break on Google's changes -> then it just reports "unavailable" and the other lanes answer. Reversible: `claude mcp remove google-flights`. Requires `uvx` (present). Gotcha for a re-install: the server needs the `[mcp]` extra (`flights[mcp]`), bare `flights` fails the handshake.
- **Skyscanner** - **NOT WIRED, by decision** (Shaheen 2026-07-08): skip until a clean/official MCP exists. No official MCP today; the only paths are an Apify actor (needs an Apify token, metered/paid) or a reverse-engineered client (may violate Skyscanner ToS, fragile) - both rejected. It stays a first-class pluggable slot: reports "unavailable", and the moment a legit MCP lands it wires with one `claude mcp add`, zero spec change. Revisit trigger: an official or non-ToS-grey Skyscanner MCP appears.
- **Design intent:** graceful degradation is the whole point - a fresh session runs on **three live lanes** (Kiwi + Turkish + Google Flights), and Skyscanner activates the moment a legit MCP connects, with zero spec change.

## Notion Integration
None by design. This is a live lookup tool - the table IS the deliverable, and prices go stale, so nothing is persisted to a database. (If a search maps to a **real trip Shaheen is planning**, capture the trip context - not the price table - per Activity Capture: a Google Calendar hold and/or a vault/research or vault/projects/modeling note. The fetched prices are never treated as durable.)

## Vault Structure
- **Tier 1:** `vault/projects/flight-search/status.md` - last run, run count, which lanes are live, recent searches (routes + dates only, **never prices**).
- **Tier 2:** none by default. Only when a search is for a real planned trip: the trip note lives where it belongs ([[projects/modeling/status]] for the Istanbul runs, vault/research/ for one-offs), linked, price-free.

## Vault Reads
- soul.md (voice).
- [[me/role]] / vault/me/ - home base Stockholm/ARN; the economy/solo/no-ceiling/no-airline-pref constants.
- [[projects/modeling/status]] + vault/research/ + Google Calendar - trips already in motion, so a search can attach to real context.

## Vault Writes
- `vault/projects/flight-search/status.md` (last run, lanes live, recent routes/dates - no prices).
- `vault/log.md` append.
- Only if a real planned trip: the trip capture (calendar/vault) + [[wiki links]] + `vault/index.md` if a new page was created.

## Connections
- **Seeded by:** research-team's `other-flight-search` pattern + [[research/flight-stockholm-istanbul-aug2026]] (the 2026-06-14 one-off this automation generalizes).
- **Feeds:** [[projects/modeling/status]] (Istanbul travel), Activity Capture (real trips -> calendar/vault), the Runway picture only indirectly (travel is a planned spend, not auto-booked).
- **Home base:** [[me/role]] - Stockholm / ARN.

## Post-Run (mandatory)
1. If the search was for a **real planned trip** -> Activity Capture: capture the trip (Google Calendar hold and/or vault note), new places/people if any, [[wiki links]]. Never persist the price table as truth.
2. `vault/projects/flight-search/status.md` - last_run, run count, lanes live, recent search (route + dates only).
3. `vault/index.md` (only if a new page was created) + `vault/log.md` append.
4. New person/company (rare here) -> vault/people/ or vault/business/ per protocol.

## Close-Out Extras
Beyond the universal Close-Out list, a flight-search run verifies:
- **All four lanes attempted** this run (or every down lane explicitly reported under the table - no silent drop).
- **Fresh-fetch invariant:** no price was reused from a prior search; the memory served conversation context only.
- **Currency as returned** (no conversion crept in); **booking links are markdown**; **dedupe kept cheapest-only** on cross-source duplicates.
- **Result-memory timestamp set** (so the 30-min expiry is real).
- If a real trip: Activity Capture ran and captured context (not prices).

## Implementation Notes (as built 2026-07-07)
- Built as spec + `/flight-search` command + registry entry (project 24) + status page. On-demand, so the first real search is the first live run.
- Verified `✔ Connected` via `claude mcp list`: **Kiwi, Turkish, and Google Flights** (the last wired 2026-07-08). Google Flights' tools load at the **next session start**, so a fresh session runs on **three live lanes**. **Skyscanner** is deliberately unwired (decision below) - a pluggable slot awaiting a legit MCP, one `claude mcp add` away.
- Guardrails carried from soul.md: never fabricate a result or a price; a down lane and an empty result are both honest findings; unknown stays unknown; no FX guessing; no cross-search price memory.
