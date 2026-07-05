# Brand Assets

Drop your brand materials here. The agent uses these when generating reports, decks, Excel files, and any branded output.

**Current brand: ALEX (since 2026-07-03).** The old STEMPLICITY identity (logo, palette, templates) is retired and archived in `archive/stemplicity/`.

## images/
- **alex-logo-transparent.png** - the ALEX wordmark + circuit-trace mark, transparent background (extracted 2026-07-03). The default logo asset: works on dark and light surfaces.
- **alex-logo.jpg** - the original on the dark teal gradient with soft glow. Full-bleed block variant (hero, cover, dark card); never floated on white.

## templates/
Empty since the 2026-07-03 rebrand (STEMPLICITY .pptx/.xlsx templates archived). Excel/PDF styling now comes straight from `config/brand-config.md`; decks are built with Claude Design. New templates get rebuilt in the ALEX brand on first real need.

## config/
- **color-system.md** - the Brand File v1.0 (July 2026), Shaheen's color specification. The source of law: exact hexes, usage rules, contrast pairings, 60-30-10. Follow it as a specification, not inspiration.
- **brand-config.md** - the operational layer the agent reads every time (Pre-Flight Gate): colors, fonts, logo rules, Excel/PDF/deck/chart formatting.

## archive/stemplicity/
The retired STEMPLICITY brand (Picture_4.png, Picture_5.png, meta.json, template.pptx, template.xlsx). Kept for history, never used for new output.

## How to use
1. Drop new files in the right folders
2. Tell the agent: "update my brand config" or "refresh brand config"
3. Every automation that generates output (reports, decks, Excel, PDF) reads from here
