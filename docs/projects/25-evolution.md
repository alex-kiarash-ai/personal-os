# 25 - Evolution

## What it actually does
Keeps Alex itself current as the AI world moves. Every day a small, free, zero-cost check looks at a
handful of public feeds for three things that matter to how Alex is built: new Claude models, new MCP
tools, and new automation patterns. Anything it has not seen before gets written to a running log. Once
a week, Alex reads that log and writes one short digest: for each new thing, what it would add or
replace, and whether it is worth Shaheen's time or not, ending in a plain recommend-or-skip. Alex only
ever proposes. Shaheen reads the digest and decides. Nothing gets installed, changed, or scheduled
without his yes.

## Why it exists
Left alone, a system like this quietly rots: the models it was built on get superseded, better tools
ship, and six months later it is running on last year's assumptions. This is the layer that stops that.
The daily watch costs nothing and runs on its own. The weekly digest turns a firehose of releases into
a few lines Shaheen can skim in a couple of minutes. And when he approves something, it goes in through
the exact same front door as every other change: edit the source, regenerate, let the checks pass,
review the diff, merge. No shortcuts, so nothing ever drifts out of sync. The point is compounding: in
two years this has absorbed dozens of upgrades and everything still fits together.

## Works together with
- **Alex AI Radar (#15)** - the radar watches the whole AI field for Shaheen the professional (what to
  act on, build, or post about). Evolution watches the same field for Alex the system (what changes how
  Alex is built). Same world, different question, kept separate on purpose.
- **The generator + validation** - every approved item is applied by editing the registry or the MCP
  list and running the one generator, so the routing table, docs, and checks all update together.
- **Alex HQ** - each run reports green or red to the dashboard, so a dead check is never silent.
- **GitHub (optional)** - if the `gh` tool is set up, the weekly digest opens as a tagged issue; until
  then it is saved as a local file and pushed to HQ.
