# Brand Configuration - ALEX (Shaheen Kiarash)

**APPLICATION — on conflict, `color-system.md` wins.** (Hierarchy formalized 2026-07-08: `brand/config/color-system.md` is the single source of color law — palette, hexes, tokens, ratios, contrast pairings, usage rules. This page holds only how to APPLY the brand in Excel, decks, PDFs, web, plus logo, fonts, and tone. Rules stated in both files were deleted from this one.)

**Rebrand 2026-07-03:** the STEMPLICITY identity (navy #0C1651 / cyan #12CCDD / coral #F09063 + wordmark) is retired. Everything that carried it now uses the ALEX brand below. Old assets: `brand/archive/stemplicity/`.

## Color tokens (lookup only)
Names + hexes for quick reference while building. Semantics, ratios (60-30-10), contrast pairings, and every do/don't live in `color-system.md` — read it, don't work from this list alone.
Ink Black `#001219` · Dark Teal `#005f73` · Dark Cyan `#0a9396` · Pearl Aqua `#94d2bd` · Vanilla Custard `#e9d8a6` · Golden Orange `#ee9b00` · Burnt Caramel `#ca6702` · Rusty Spice `#bb3e03` · Oxidized Iron `#ae2012` · Brown Red `#9b2226` · elevated dark `#00232e` · light elevated `#fff5e1`

## Fonts (Type System v1.1, adopted by Shaheen 2026-07-06)
**Generated documents (Word/Excel/PDF/HTML reports): Calibri.**
- Title/cover: 26pt bold · H1: 20pt bold `#005f73` · H2: 16pt bold `#005f73` · H3: 13pt bold `#005f73` · Body: 11pt `#001219` · Captions/footnotes: 9pt `#4a5a5e`. Line height ~1.45.
- Emphasis = bold, never color alone. Headings never in Golden Orange or any red (those are accent/alarm, not structure).

**Web/UI (Alex HQ, web apps): `"Segoe UI", system-ui, -apple-system, sans-serif`.**
- Calibri is not web-safe cross-device; Segoe UI is its closest system sibling and needs no font download.
- Scale (px): display 32 · h1 24 · h2 18 · body 16 · secondary 14 · caption 12. Same color rules as documents (dark mode: white primary, Pearl Aqua secondary, Vanilla Custard tertiary).

- The ALEX display lettering exists only inside the logo file. Never retype the wordmark.

## Logo
- **Primary: `brand/images/alex-logo-transparent.png`** - ALEX wordmark + circuit-trace mark on a transparent background (extracted from the JPG 2026-07-03, glow removed). Works on dark AND light surfaces; verified on #001219, white, and #005f73.
- **Full-bleed variant: `brand/images/alex-logo.jpg`** - the original on the dark teal gradient with soft glow. Use as a self-contained block (hero, cover, dark card). Never float the JPG on white.
- Placement: top-left or bottom-left.
- The mark's ring cores are opaque white by design (connection nodes); keep them.
- Nice-to-have someday: vector SVG from the original design file.

## Charts / Data Visualization
Follow `color-system.md` §4.5 (series order, reds for data alarms only, gridline opacities) and §4.6 (allowed gradients). No local copy here — the duplicate was deleted 2026-07-08 (D9); the law file is the only place these rules live.

## Presentations
- Build decks with **Claude Design (DesignSync)** on claude.ai/design, then export PDF (standing rule 2026-06-15). NOT .pptx / python-pptx.
- Brand the components from THIS file + color-system.md: `#001219` canvas, teal structure, one Golden Orange accent, Calibri, ALEX logo block on dark.
- **"Building Alex" series diagrams keep their LOCKED design system** (`work/12-linkedin-series/screenshots/DIAGRAM-DESIGN-SYSTEM.md`, EP2 palette). Out of the 2026-07-03 rebrand scope by Shaheen's instruction (STEMPLICITY surfaces only).
- The pre-rebrand deep-space personal deck aesthetic (#070A1C, cyan→violet gradients, outputs/building-alex/2026-06-15/) is historical; new non-series decks default to the ALEX brand above.
- No live templates: the STEMPLICITY .pptx/.xlsx templates are archived. Rebuild in the ALEX brand on first real need.

## Excel Formatting
- Headers: `#005F73` background, white bold Calibri
- Titles / labels: `#005F73` bold; body text `#001219`
- Data rows: alternating `#FFFFFF` and `#FFF5E1` (warm cream tint)
- KPI highlight: `#EE9B00` (one per sheet); links/positive `#0A9396`; negative or alert values: `#AE2012`
- KPI tiles on dark teal fill: labels Pearl Aqua `#94D2BD`, values white
- Currency: SEK format with 2 decimals (kr) unless the doc is USD-specific
- ALWAYS real formulas (=SUM, =SUMIFS, =IF), never hardcoded values

## PDF / Report Formatting
- Header: dark bar (`#001219` or `#001219→#005f73` gradient) carrying the ALEX logo block
- Body font: 11pt Calibri, text `#001219`
- Section headings: Bold 14pt, `#005f73`
- Accent rule lines: `#0a9396`; at most one `#ee9b00` highlight per page
- Callout boxes: `#e9d8a6` soft tint on light pages

## Tone
- Match soul.md voice rules (Alex). Calm, technical, deep water. Orange is the single spark. Red means "pay attention now."
