<!-- CUSTOM_START -->
# Personal Ops System docs

This folder explains the system to a human. The repo runs Alex, Shaheen's personal AI agent: a
Claude Code setup with memory, guardrails, and a pile of automations that work while he sleeps.

Two things to know before you read anything else:

1. **Sources are written by hand, views are generated.** The files people actually read (this
   folder, the routing tables) are built from a few hand-edited sources by one script,
   `scripts/generate-alex.js`, and validated after every run. If a doc here disagrees with a
   source, the doc is stale: regenerate it, don't edit it.
2. **The personal half is not here.** The vault, soul.md, and anything private are local-only and
   never reach this repo's remote. What you can read here is the machinery, not the life.

Start with GETTING-STARTED if you want to run it, ARCHITECTURE if you want to understand it.

**If you just downloaded this and nothing works, read this paragraph first.** Alex is not a file you
open, it is a folder you *work inside*. Claude Code only becomes Alex when the `personal-os` folder
itself is the session's folder. Dragging files into the chat, attaching `CLAUDE.md`, or pasting a
path gets you plain Claude with none of the commands. Open the folder (desktop app: pick it as the
session folder; command line: `cd` into it, then run `claude`), type `/status` to confirm it loaded,
then type `/setup`. Full walkthrough in section 2 of GETTING-STARTED.md.
<!-- CUSTOM_END -->

<!-- GENERATED below this line - do not hand-edit. Source: templates/readme.template.md + system/manifest.json. Regenerate: node scripts/generate-alex.js. Generated 2026-09-04. The welcome block above (between CUSTOM_START/CUSTOM_END) is the ONE hand-written zone and is preserved verbatim on every regeneration. -->

## Quick start

- **Set it up / run it:** [GETTING-STARTED.md](GETTING-STARTED.md) - prereqs, first boot, the automations, scheduling.
- **Understand it:** [ARCHITECTURE.md](ARCHITECTURE.md) - the full constitution with a human preamble.
- **The projects, in plain language:** [projects/README.md](projects/README.md) - one page per automation.
- **The live n8n workflows:** [n8n/](n8n/) - node-by-node explanations of what runs on the server.

Right now the registry holds **32 non-retired automations** (18 LIVE). The source of truth is `system/manifest.json`; every table and count in these docs is generated from it by `scripts/generate-alex.js`, then validated. Edit sources, not views.

## License

[MIT](../LICENSE) (since 2026-08-06). The vendored third-party agent skills in `.agents/skills/` keep their own authors' licenses - see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md); per-skill provenance is machine-recorded in `skills-lock.json`.
