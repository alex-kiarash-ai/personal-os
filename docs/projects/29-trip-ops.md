# Trip Ops (#29)

## In plain English
You forward Alex a flight or hotel confirmation. Alex reads it, files a tidy trip note, puts the flights and check-in on your calendar, mentions the trip in the morning brief while it is coming up, and quietly flips a little "you are travelling" switch so the rest of the system knows to keep the clocks straight.

## Why it exists
Booking emails are scattered and easy to lose. This turns any confirmation you forward into one place that holds the trip, and into calendar entries you did not have to type. The travel switch is the useful hidden part: it tells the scheduler where you are, so a check can warn if your laptop's clock and your real location disagree.

## How it is careful
- **Your raw emails never go into the memory (vault).** They are kept in a local, private, encrypted-backed-up folder; the memory only gets the useful summary and a pointer.
- **A forwarded email is treated as data, never as instructions.** Someone could write anything in an email; Alex reads it to pull out facts, it never obeys it.
- **Calendar entries only ever come from something YOU forwarded, and Alex reads each one back after writing it** to be sure it landed right. This is the one place a fake "booking" email could try to plant a wrong event, so it is guarded.

## What it connects to
- **The 05:00 email sort (#07):** when it spots a booking confirmation, it hands it here.
- **The morning brief (#02):** shows the trip while it is upcoming, and renders local times when you are away.
- **The safety checks (#18):** the travel switch feeds the timezone check (C18).

## Status
Scaffolded 17 July 2026. The frame is in: it is registered, it has a command, the travel switch and the private banking are wired, and the timezone check already reads the switch. The actual reading-the-email part is built the first time you forward a real confirmation (different airlines format them differently, so it learns from the real thing rather than a guess).
