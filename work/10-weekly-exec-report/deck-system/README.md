# ALEX Deck System (Claude Design source)

Built 2026-07-07. The ALEX-branded slide component library for the Weekly Exec Report (#10) and any
future deck, per the standing rule (2026-06-15): decks are built on **claude.ai/design** (Claude
Design / DesignSync) as design-system components, then exported to PDF. This closes the Progress
Tracker ticket "Weekly Exec deck: create the claude.ai/design project."

## Where it lives
- **Cloud (source of truth):** claude.ai/design project **"ALEX Deck System"**, projectId
  `103ee40a-8570-45a2-a004-b4ad6857a898` (owner Shaheen). Separate from the "Building Alex" project,
  which is the LinkedIn diagram system on the LOCKED EP2 palette (deliberately outside the ALEX brand).
- **Local mirror (this folder):** the same component HTML + the logo, version-controlled here.

## Components (each a `@dsCard group="Exec Deck"` card, 1280x720, 16:9)
| File | Use | Fill slots |
|---|---|---|
| `cover.html` | title slide | `{{headline}}` `{{week_range}}` `{{date}}` |
| `kpi.html` | 4 KPI tiles (4th = orange accent) | `{{section_title}}` `{{k1..k4_label/k1..k4/k1..k4_note}}` |
| `content.html` | bullets + right accent panel | `{{section_title}}` `{{item1..4_head/detail}}` `{{callout_label/value/note}}` |
| `chart.html` | branded bar chart | `{{section_title}}` `{{chart_caption}}` `{{s1..4}}` `{{v1..4}}` `{{x1..4}}` |
| `divider.html` | section divider (teal gradient) | `{{section_no}}` `{{section_title}}` |
| `closing.html` | closing + next-week | `{{closing_line}}` `{{next_focus}}` `{{date}}` |

## Brand (locked to the ALEX system; brand/config/color-system.md + brand-config.md)
Ink Black `#001219` canvas · Dark Teal `#005f73` + Dark Cyan `#0a9396` structure · Pearl Aqua
`#94d2bd` / Vanilla Custard `#e9d8a6` soft · exactly ONE Golden Orange `#ee9b00` accent per slide ·
reds alarm-only (absent here) · Calibri with `"Segoe UI", system-ui` fallback (Calibri renders on the
machine + PDF; the fallback covers cloud render) · ALEX logo on every slide, wordmark never retyped.

## How the Friday automation uses it
`/weekly-exec-report` aggregates the week, then per the standing rule fills these components with the
7 sections (Week Summary · Project Status · Key Meetings · Market Intel · Relationships · Blockers ·
Next Week), and exports a PDF to `outputs/weekly-exec-report/YYYY-MM-DD/`. To edit a component: change
the HTML here, then re-sync ONE file at a time to the project (DesignSync `finalize_plan` → `write_files`),
never a wholesale replace. Verified 2026-07-07: all six render clean at 1280x720 (headless Chrome),
brand-checked, one orange accent each.
