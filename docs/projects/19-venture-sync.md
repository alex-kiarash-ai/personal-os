# 19 - Venture Sync (dormant)

## What it actually does
On demand (`/venture-sync`): mirrors business-venture documents - plans, notes, decks living in separate repos - into the vault under vault/ventures/, converts them into wiki pages with links, generates a synthesis brief per venture, and scaffolds project pages so a venture's knowledge joins the same graph as everything else. Read-only toward the source repos; they stay the source of truth.

## Why it exists
STEMPLICITY and the other venture ideas generate documents in scattered places; knowledge that is not in the vault is invisible to every automation (the brief cannot mention it, research cannot cite it, the CRM cannot connect people to it). This is the on-ramp that brings venture material into the system's memory.

## Current state: DORMANT (revisit 2026-10-01)
Built and configured for five ventures (brandmodal, alphastar, insightai, finance-us, stemplicity), but none of those repos exist on this machine yet, so a run produces nothing. It earned its number the honest way: the recovery checker's first sweep flagged it as an unregistered orphan, and it was registered as #19 on 2026-07-04. The quarterly revisit asks one question: are the repos here yet? Two unchanged revisits force activate-or-retire.

## Works together with
- **The vault** - its entire output surface (vault/ventures/ + cross-links).
- **[Research Team](04-research-team.md)** - downstream consumer of synced venture knowledge.
- **[Recovery Layer](18-recovery-layer.md)** - the layer that caught it undocumented and forced this registration.
