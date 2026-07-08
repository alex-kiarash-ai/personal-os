# 24 - Flight Search

## What it actually does
On demand: ask Alex for flights between two cities and it returns the cheapest and best real options in a clean table. It runs a short two-round Q&A first - where from, where to, when, then return-or-one-way, how flexible the dates are (each leg separately), and whether to allow a one-stop if it is cheaper - while already knowing the constants (economy, solo, no price ceiling, no airline preference, home base Stockholm). Then it searches four sources at the same time (Kiwi, Turkish Airlines, Google Flights, Skyscanner), merges the results, drops any duplicate flight down to its cheapest price, ranks by Shaheen's rules (short trips: direct only; long trips: direct and one-stop, price mattering more than time), and shows the top three or four with right-click-able booking links. Multi-city trips work too.

## Why it exists
Booking a trip means opening five tabs and comparing the same flight priced differently on each. This collapses that into one ask. Every search is fresh - prices change daily, so nothing is ever remembered from a past search - and it keeps the current search in mind for thirty minutes so follow-up questions ("what about coming back a day later?") just work. If one source is down, it says so and still answers from the others, so the tool never fully breaks.

## Works together with
- **Kiwi + Turkish Airlines** - live sources today, connected through Claude.
- **Google Flights + Skyscanner** - plug-in lanes that switch on the moment their connector is added; until then they simply report "unavailable" and the other two answer.
- **Modeling project + the calendar** - when a search is for a real planned trip (like the Istanbul runs), Alex captures the trip context to the calendar or vault, never the prices.
