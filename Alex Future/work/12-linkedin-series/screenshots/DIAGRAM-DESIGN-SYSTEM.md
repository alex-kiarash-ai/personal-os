# Building Alex - Diagram Design System (LOCKED 2026-06-17, Shaheen approved)

Reusable spec for every "Building Alex" diagram/picture. Shaheen approved this on EP3.
**STANDING RULE:** every time Shaheen asks to generate a picture, FIRST invoke the `frontend-design` (UX design) skill, then build with this system.
**Canonical template:** `episode-03-brain.html` (copy it, relabel the nodes). EP2's `episode-02-architecture.html` shares the exact palette.

## Palette (EXACT, EP2 = EP3)
- **Background base** (radial): `#18234f 0%, #0c1232 40%, #070a1d 72%, #04050f 100%`
- **Mesh glows** (layered radials over the base): cyan `rgba(15,111,184,0.22)`, violet `rgba(106,61,240,0.22)`, coral `rgba(242,160,122,0.09)`
- **Cyan accent:** `#3ce1f1` (lines/icons), `#15d6e8` (title-gradient start + glow flood), `#43e6f4` (arrowheads + synapse dots)
- **Violet accent:** `#9a8bff` (icons + title-gradient end), `#b0a2ff` (orb name end)
- **Coral / Claude mark:** `#F2A07A` (sunburst), warm core glow `rgba(242,160,122,...)`
- **Ink:** body `#EAF0FF`, card title `#F4F7FF`. **Muted:** title sub `#8e99bf`, card sub `#aab4d6`
- **Core orb base:** `#28335f -> #0b1030`; orb shadow `rgba(18,204,221,0.40)` + `rgba(124,92,255,0.26)`
- **Aura rings:** `rgba(120,160,255,0.16 / 0.08 / 0.05)`

## Typography
- Display + node titles: **Sora** (600 / 700 / 800). Body/subtitles: **Hanken Grotesk** (400/500).
- Loaded via Google Fonts `<link>`. Render MUST allow font fetch: pass `--virtual-time-budget=3500` (and the box needs internet). Fallback stack: `'Segoe UI',sans-serif`.
- Node title: 23px Sora 600, `white-space:nowrap` (keeps multi-word names like "Skills & Plugins" on one line; widen the card instead of shrinking the font). Subtitle: 16.5px. Title: 27px / letter-spacing 13px / cyan->violet gradient.

## Components
- **Glass cards, uniform size** (width ~308px, min-height 116px): gradient border via the padding-box/border-box trick (`linear-gradient(navy) padding-box, linear-gradient(cyan->violet) border-box`), `backdrop-filter:blur(9px)`, deep shadow + inner top highlight. Each has a luminous **icon badge** (rounded gradient square, cyan/violet glow).
- **Plasma core:** a big blurred `.bloom` (coral->cyan->violet radial) behind a `.orb` (layered radial-gradients: coral top, violet lower, navy base) + coral **sunburst** mark + "Alex / THE BRAIN", wrapped in 3 SVG **aura rings** (one dashed). This is the brightest, "alive" element.
- **Connections = curved light filaments**, NOT straight arrows: cubic-bezier paths with a `gradientUnits="userSpaceOnUse"` cyan->violet stroke (CRITICAL: userSpaceOnUse so perfectly-vertical lines still render, objectBoundingBox draws nothing on a zero-width bbox), a soft glow filter, small flow **particles** along the path, **synapse dot** where it meets the core, and a small elegant arrowhead.
- **Atmosphere:** gradient-mesh background + SVG `feTurbulence` **grain** (opacity .06, soft-light) + radial **vignette**. Never a flat background.

## Render
`"<chrome>" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --virtual-time-budget=3500 --window-size=1200,H --screenshot="out.png" file.html`
- Portrait for the LinkedIn feed (e.g. 1200x1320). Scale-factor 2 = crisp 2x PNG.
- After render, READ the PNG and review as a UX designer before delivering.

## History
- EP2 = dark palette, hub layout (episode-02-architecture.html).
- EP3 = this premium system (Sora, plasma core, curved filaments) in the SAME EP2 palette (episode-03-brain.html). Shaheen: "save the design and the colors for the next pictures."
- MERGE (2026-06-18): `episode-merge-inside-the-brain.html` fuses EP2 + EP3 into one portrait (1200x1500) on the same system. Single Alex core; 8 cards radial (3 EP2 top arc + 5 EP3 sides/bottom). Title "INSIDE ALEX'S BRAIN", core tag "CLAUDE CODE". Confirms the system scales past 4 nodes.
