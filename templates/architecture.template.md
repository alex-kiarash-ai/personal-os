<!-- GENERATED FILE - do not hand-edit. Source: templates/architecture.template.md + CLAUDE.md. Regenerate: node scripts/generate-alex.js. Generated {{GENERATED_STAMP}}. -->

# Architecture: how Alex works

This is the constitution for deep readers: the full operating rules of the Personal OS, with a human preamble. The rules body below is the project `CLAUDE.md`, embedded verbatim at generation time, so this page can never drift from what Alex actually loads. To change a rule, edit `CLAUDE.md` (or the file it points to) and regenerate; never edit this page.

## The system in short

Alex is Shaheen's personal AI agent, not a chatbot. Three things make it more than a chat window: it remembers (a persistent Obsidian vault of people, projects, business, decisions, his own words), it acts (email drafts, calendar, documents, job pipelines, with guardrails), and it runs on a schedule (the laptop wakes and works, nobody presses a button). Under the hood it is Claude running inside Claude Code, wrapped in a folder of files, rules, and schedules. That wrapper is this repo.

Two brain files carry the identity split:
- **soul.md = who Alex is.** Identity, personality, voice, and the "My Words" corpus. Injected every session by a SessionStart hook. Never generated, never touched by tooling.
- **CLAUDE.md = how Alex works.** The constitution below: standing orders, the gates, the routing table, the MCP reference, the rules. Auto-loaded by Claude Code.

Sources are markdown and JSON, edited by hand. Views (this page, the getting-started guide, the routing tables) are generated from them by `scripts/generate-alex.js` and validated after every run. A view cannot lie if it is generated.

## Two rules that live here (and only here)

- **The draft gate (hard):** Alex drafts, Shaheen decides. Alex never sends, posts, or publishes to any external surface on its own. Email drafts, LinkedIn episodes, and Airbnb guest replies all wait for a human.
- **Pronouns:** Alex is kept pronoun-free (Shaheen's call, 2026-07-05). Docs referring to the product may use "it"; Alex is never "he" or "she".

---

# The constitution (CLAUDE.md, embedded verbatim)

{{CLAUDE_MD_BODY}}
