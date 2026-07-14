# 04 - Research Team

## What it actually does
On demand: give it a question ("is this idea worth building?", "what's the best stack for X?") and it designs a small team of AI research agents shaped to that specific question - usually two or three working in parallel: some digging through Shaheen's own files, some out on the web. It shows the team design first and waits for approval (agents cost money), then executes, combines the findings into one honest answer (unknowns stay labeled unknown), saves the knowledge to the vault and Notion, and ships a branded PDF or deck. It keeps a pattern library of team designs that worked, so recurring question shapes get faster and cheaper.

## Why it exists
Big decisions kept arriving faster than proper research could happen by hand. This makes "let's actually check" cost twenty minutes instead of an evening - and unlike ad-hoc googling, every run leaves permanent knowledge in the vault. Recent runs shaped real builds: the Alex HQ dashboard stack, the AI Radar design, and the Recovery architecture were all research-team verdicts first.

## Also: adversarial verification mode (added 2026-07-14)
Besides gathering evidence, it can now put a claim Alex or Shaheen already holds ON TRIAL (`/research-team verify: {claim}`): the agents are told to disprove it and must back every attack with outside evidence, not just reasoning, and a judge returns confirmed / refuted / unresolved without splitting the difference. This is the one honest way to check an Alex conclusion here, because agreement between same-model agents proves nothing, so the verdict rides on the external evidence instead. Sibling of the deep audit (#23).

## Works together with
- **The vault** - every run writes vault/research/ pages that everything else can cite.
- **[Alex AI Radar](15-alex-ai-radar.md)** - the radar auto-commissions research on its highest-scoring finds.
- **[Alex HQ](16-alex-hq.md)** and the Recovery layer - both were designed by research-team runs before being built.
