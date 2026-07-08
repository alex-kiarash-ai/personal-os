# /flight-search - Cheapest + Best Flights Across Four Sources

Spec: work/24-flight-search/CLAUDE.md (read it first; it defines the full runtime flow, the hard constraints, and the source lanes). On-demand. Alex is the master agent orchestrating four flight lanes in parallel.

Usage: `/flight-search` (or with the request inline: `/flight-search Stockholm to Istanbul Aug 1, flexible +/-2`), or just say "find me flights ARN to IST first week of August".

## Steps (condensed; spec is authoritative)
1. **Intake, hybrid, two batches.** Batch 1: from / to / outbound date (default-suggest ARN for "from" if omitted). Batch 2: return-or-one-way; flexibility **per leg** (outbound +/- N, return +/- M can differ); direct-only vs one-stop-if-cheaper. Skip a batch the request already answered; always allow "just search". Multi-city -> take legs in order. **Never ask** cabin/party/ceiling/airline: always economy, solo, no ceiling, no preference.
2. **Resolve airports** (city -> IATA; flag multi-airport cities). **Set haul type:** short-haul (<~3h) = direct only; long-haul = direct + one-stop, price weighted over time. An explicit direct-only/one-stop answer overrides.
3. **Fan out to ALL FOUR lanes in parallel, every time, same criteria** (load deferred MCP tools via ToolSearch first): Kiwi `mcp__claude_ai_Kiwi_com__search-flight`; Turkish `mcp__turkish-airlines__search_flights` (+ `search_inbound_flights`, `find_flight_price_calendar`); Google Flights MCP; Skyscanner MCP. adults=1, cabin=economy. Flex dates -> expand the per-leg window, use each source's native calendar/range where it has one, keep the cheapest per option. No smart pruning.
4. **Down lane -> report it, do not hide it, do not block the rest.** "Skyscanner: unavailable" under the table. Never fabricate.
5. **Normalize + dedupe:** capture departure time, route (codes + city names), stops (+ middle airport), price + currency **as returned (no conversion)**, source, booking link. Same flight from >1 source at different prices -> keep only the **cheapest**, no flags. Identical price+route+time -> show once.
6. **Rank** by Shaheen's rules. **Tie-break:** same price + route + different times -> **same rank** (two "Option 1"); same price + route + time -> once.
7. **Display** a clean markdown table, top 3-4: `Rank | Departure | Route | Stops | Price | Source | Book` with **markdown** booking links; list any down lanes below it.
8. **Result memory 30 min** for follow-ups, then expire and start fresh. Memory = conversation context, **NOT a price cache**. Every search hits the sources live.

## Hard constraints
Fresh every search (no cached prices) · all four lanes always · graceful degradation on a down lane · cheapest-only on cross-source duplicates · currency as returned (no FX) · markdown booking links · 30-min memory then expire.

## Post-Run
- Real planned trip? -> Activity Capture: Google Calendar hold and/or vault note (trip context, **never** the price table). New places/people -> vault/people/ or vault/business/, with [[wiki links]].
- Update vault/projects/flight-search/status.md (last run, lanes live, recent route/dates only - no prices) + vault/log.md `## [YYYY-MM-DD HH:MM] flight-search | {route}, {dates}, {n} lanes, {result}`.
