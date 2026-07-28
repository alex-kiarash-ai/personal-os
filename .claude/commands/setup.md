# /setup - First-Run Onboarding

Guide the user through setting up their Personal Ops System. One step at a time. Wait for input before moving on.

**STOP CONDITION, check this before anything else (added 2026-07-28).** `/setup` is a FIRST-RUN
wizard and every write below assumes a fresh, empty install. Before running a single step, check
whether `soul.md` exists and contains a `## My Words` heading. **If it does, this is not a fresh
install: STOP and say so, naming the file and its size, and require explicit confirmation before
any write.** That corpus is months of harvested phrasing, it is the input to every prose surface
Alex generates (n8n writer nodes, CVs, cover letters, LinkedIn, email drafts), and overwriting it
fails silently: everything keeps working, it just stops sounding like Shaheen. It is gitignored, so
git will not save you; the only copy is the nightly encrypted vault backup, last 14 kept. Recovery
check C22 watches the entry count for exactly this reason. Never treat this as a formality.

Prerequisites (done before running /setup):
- **The session folder IS personal-os.** If the user reached you any other way (files attached to a
  chat, a pasted path, a subfolder opened), /setup cannot work: the commands and hooks are not
  loaded. Tell them plainly: "Close this and open the `personal-os` folder itself in Claude Code -
  desktop app: pick it as the session folder; command line: `cd` into it, then run `claude`. Then
  type `/status`, and once that answers, `/setup`." Do not try to work around it. See the Session
  Root section of the root CLAUDE.md.
- MCP connections (Gmail, Calendar, Notion) authenticated via /mcp
- If something isn't connected, the system still works. Don't ask them to set up missing connections.

## Step 1: Install Skills + Verify Connections

**Do NOT run `npx skills add ... --global` here (corrected 2026-07-28, review F-10).** It was the original
instruction and it is wrong on two counts. A `--global` install lands outside `.agents/skills/`, so it is
invisible to `skills-lock.json`, which means the tamper baseline and recovery check S7 never see it, and
the whole DATA-only posture (trust allowlist, script-free verification, hash-on-install) is routed around
by the very first command a fresh install runs. Separately, `npx skills add` is classifier-blocked on
agent-discovered repos, so this told a new agent to run a command the system had already found reason to
distrust.

**The real posture:** skills live PROJECT-SCOPED in `.agents/skills/<name>/` with junction links in
`.claude/skills/<name>`, each `SKILL.md` hashed into `skills-lock.json`. They are committed, so a fresh
clone already HAS them. The only thing a new install may need is the link layer, which is gitignored:

```bash
# Rebuild any missing .claude/skills junction (recovery check C17 asserts these resolve).
# Windows: junctions need no admin. Git Bash `ln -s` silently COPIES, so use mklink /J.
for d in .agents/skills/*/; do n=$(basename "$d"); \
  [ -e ".claude/skills/$n" ] || cmd //c mklink //J ".claude\\skills\\$n" ".agents\\skills\\$n"; done
```

Then tell the user: "Skills are installed and verified against the lockfile." If a skill is genuinely
missing, add it as DATA (fetch the raw `SKILL.md`, read it, confirm it is script-free, write it to
`.agents/skills/`, junction it, hash it into `skills-lock.json`) and never by executing a third-party
installer.

Test connections:
- Try Gmail MCP: list 1 recent email subject
- Try Calendar MCP: check today's events
- Try Notion MCP: list databases

Report: "I can see your [Gmail/Calendar/Notion]. [Anything not connected] isn't set up but we can work without it."

## Step 2: Build Identity

Tell the user, exactly:

```
Let's build your identity. Two ways to feed me:

1. Drop files into the inbox/ folder - resume, LinkedIn export, writing samples,
   transcripts, bio, decks, anything that helps me know you. PDF, DOCX, MD, TXT
   all work. I'll read everything in there.
2. Paste text directly into the chat.

You can do both. When you're ready, type 'go'. If you want to skip the inbox
and just chat, type 'chat'.
```

**WAIT for the user to type 'go' or 'chat'.** Do not proceed.

### A. Read the inbox (if they typed 'go')

List `inbox/`. Skip dotfiles like `.gitkeep`. For every other file:
- Read it. PDFs use the pdf skill, DOCX uses the docx skill, plain text/markdown via Read.
- Track filenames in a "what I read" list to show the user.

If the inbox has no real files (only `.gitkeep` or empty), tell them: "Inbox is empty. Drop files now and type 'go' again, or paste your info in the chat." Then WAIT.

### B. Extract + smart questions

After reading inbox files (or chat input), extract: role, company, writing style, priorities, people, projects. Then ONLY ask for what's missing:

- If you got their role from the resume, don't ask again.
- If you got their company from LinkedIn, don't ask again.
- Always ask about personality: "If your agent was a character, who would it be? Jarvis? A chill surfer? A sharp colleague? Describe the vibe."
- Always ask about goals if not clear: "What are your current goals? Work, personal, learning?"
- If writing samples weren't in inbox or chat: "Paste 5-10 things you've actually written. Posts, tweets, emails. I need your real voice."

Aim for 3-5 questions total. Skip what you already know.

### C. Sanity check on input quality (do NOT skip)

Before moving to Step 3, verify you have real material. Required:
- At least one of: resume / LinkedIn / bio / detailed self-description.
- A character/personality answer (not one word).
- At least one concrete goal.
- Writing samples: 3+ snippets, or one long piece.

If anything is missing, thin, or looks like filler ("idk", "whatever", single word answers), push back: "I need more on [X] before I can build a real soul.md. Otherwise you'll get a generic agent." Then WAIT for more input. Do NOT proceed with thin material.

## Step 3: Brand Setup

YOU MUST STOP AND ASK THE USER. Do NOT skip this step automatically.

Tell the user and WAIT for their response:
"Before I build your vault, let's set up your brand. Every report, deck, chart and Excel I generate reads
`brand/config/brand-config.md`, so this is the file that decides how all of it looks.

You have two options:
1. **Give me your brand**: drop your logo into brand/images/, and tell me your colors (hex) and fonts. If
   you have an existing deck or Excel template, drop it into brand/templates/ and I will read it.
2. **Use the defaults**: type 'skip' and I'll use what's already here. You can update later with /brand.

Which one?"

WAIT for the user to respond. Do not proceed until they say "done" or "skip" or something equivalent.

If they say "done" or indicate they dropped files:
- Scan brand/images/ for new files. Scan brand/templates/ for anything they dropped.
- **Colors and fonts come from the user, not from a file format (corrected 2026-07-28, review F-10).** Ask
  for hexes and fonts directly and write them to `brand/config/brand-config.md`. The old instruction
  extracted the brand by opening a `.pptx` with python-pptx, which meant a fresh install derived its whole
  visual identity from an artifact type the system no longer generates in: decks are built with Claude
  Design and exported to PDF (standing rule since 2026-06-15), and `/pptx` is only used when someone
  explicitly asks for an editable PowerPoint.
- If they DID drop a .pptx or .xlsx, you may still read it as a REFERENCE for colors and fonts, then
  confirm what you found with the user before writing it into the config. Never let a template file be the
  silent source of truth.
- Exact hex values live ONLY in `brand/config/color-system.md`; write them there and reference, never
  retype them across files.
- Confirm: "Brand updated. Here's what I'm using: [colors], [fonts], [templates]."

If they say "skip":
- "Using default brand. Run /brand anytime to update with your own assets."

## Step 4: Ingest Identity Into the Wiki (Karpathy Pattern)

### A. Run /ingest on the inbox

Run the `/ingest --batch` flow from `.claude/commands/ingest.md` against everything in `inbox/`. That command handles archiving (move to `vault/sources/`), manifest tracking (`inbox/_ingested.md`), wiki page creation, and `[[wiki links]]`. Pasted chat text is saved to `inbox/onboarding-chat.md` first, then ingested too.

After this step, all inbox files have been archived to `vault/sources/`, the manifest is up to date, and entity pages exist for every person/company/project mentioned.

### B. Write soul.md

**Re-check the STOP CONDITION at the top of this file before writing.** If `soul.md` already has a
`## My Words` section, do NOT write: stop and get explicit confirmation naming the file. On a fresh
install (template only, no corpus) proceed.

OVERWRITE the template. Fill in EVERY section from what you collected in Step 2.

Generate the **Agent Personality** section using meta-prompting:
- Core identity (one sentence)
- How you talk (4-5 specific rules)
- Addressing style
- Emotional range
- 5 example responses (calibration examples, the model mimics these)
- Anti-patterns (character-specific things this voice would NEVER do)
- Voice rules (keep defaults + character-specific additions)
- Things I Never Want (inferred from character and writing style)

soul.md MUST be fully filled. No placeholders. Keep the FRESH-INSTALL draft tight, roughly 2 to 3KB,
which is what a first-day soul needs before any corpus exists. **That is a floor for a new file, never
a cap on a grown one.** A mature soul.md is dominated by the My Words corpus and legitimately runs to
100KB+; never trim, summarize, or truncate it to hit a size target.

### C. Top-up wiki pages from soul.md

`/ingest` already created entity pages for everyone/everything mentioned in the sources. Now add the user-specific pages that didn't have an obvious source mention:
- `vault/me/role.md`, `vault/me/goals.md`, `vault/me/preferences.md` - from soul.md and chat answers.
- Cross-reference these to the entity pages already created (`[[business/company]]`, `[[people/name]]`).

### D. Index and log

`/ingest` already updated `vault/index.md` and `vault/log.md`. Verify the user-specific pages from step C are also listed in the index. Append a final `## [YYYY-MM-DD HH:MM] /setup | onboarding complete` entry to `vault/log.md`.

### E. Verify (no-dummy gate - do NOT skip)

Before declaring Step 4 done, run this check on what you just wrote. If ANY check fails, fix it before continuing.

1. **soul.md placeholder scan.** Read soul.md. Fail if it contains any of: `TODO`, `TBD`, `FIXME`, `[your `, `[name]`, `<placeholder`, `lorem ipsum`, `Jane Doe`, `John Doe`, `example.com`, empty headed sections like `## Goals\n\n## ` (heading followed immediately by another heading).
2. **Real names.** Every `vault/people/*.md` filename must be a real name from the inbox or chat. No `person-1.md`, `placeholder.md`, `example.md`.
3. **Non-empty pages.** Every wiki page has > 50 chars of actual body (not just frontmatter + a heading).
4. **Cross-references.** Every page has at least one `[[wiki link]]` to another page (except `vault/index.md` and `vault/log.md`).
5. **Source provenance.** soul.md and the vault pages cite or reflect content from `vault/sources/`. If you couldn't extract a fact, leave the field absent - do NOT invent.
6. **Voice match.** soul.md's example responses use the user's actual writing style from samples, not generic Claude phrasing.

If any check fails: report exactly which one, fix it (re-read sources, ask a targeted question, rewrite the offending file), then re-run the check. Do not move to Step 5 until all six pass.

### F. Show the user

Read soul.md back. Then list the vault pages you created with their cross-references. Ask: "Does this sound like you? Anything to fix?" WAIT for confirmation or edits before Step 5.

## Step 5: Initialize Notion Workspace + Project Tracker

Create a "Personal Ops System" parent page in Notion. ALL future databases live under this page.
Store parent page ID in vault/projects/notion-parent-id.md.

Under the parent page, create "Progress Tracker" database: Task (title), Status (select: To Do/In Progress/Done), Order (number), Notes (text).
Views: "Board" (grouped by Status), "Build Order" (table sorted by Order).

**Seed the board FROM `system/manifest.json`, never from a list typed here (corrected 2026-07-28, review
F-10).** Read the registry, take every project whose `state` is not RETIRED, and create one row per
project using its `title`, ordered by `num`, Status = To Do.

The hardcoded list this replaced seeded **Market Pulse** (never built) and **Content Machine** (RETIRED
2026-07-06, folded into #12). Those became permanent To Do rows for automations that do not exist, on a
board that feeds `/sprint-tracker` velocity, so a brand-new install started with a skewed count and two
rows that could never be completed. A seed list is a copy of the registry, and copies drift; deriving it
means a fresh install matches reality on day one and keeps matching.

Store database ID in vault/projects/sprint-tracker/status.md.

Share the Notion link with the user: "Here's your progress tracker: [link]. {N} projects on the board."
Use the real count from the registry, do not state a fixed number.

## Step 6: Set Up Obsidian

"Open Obsidian. Open folder as vault. Navigate to the vault/ folder. You'll see your pages and the graph."

## Step 7: Done

Summary:
- Connections: [list]
- soul.md: filled in with [personality name] personality
- Brand: [set up with custom / using defaults]
- Project tracker: [Notion link], 10 automations seeded
- Vault: [X pages] created
- Obsidian: ready

### Final message - branch on what's in work/

Run `ls work/` and check what's there:

**If `work/` has folders like `01-sprint-tracker/`, `02-morning-brief/`, etc. (this is `personal-os-prebuilt` or `personal-os-prebuilt-free`):**

Tell the user, exactly:
```
Your Personal Ops System is ready. The automations are pre-built - no prompts to run.

Try any of these commands. Each one runs Step 0 (Bootstrap) on first invocation
to create its Notion DB lazily, then does its job:

  /morning-brief       - today's emails + calendar digest
  /research-team       - multi-agent research on a topic
  /meeting-intel       - pre-meeting dossier or post-meeting extraction
  /personal-crm        - sync contacts and stage follow-up drafts
  /email-triage        - classify Gmail and draft replies
  /expense-wrangler    - process receipts, generate Excel report
  /post-episode        - draft a Building Alex episode
  /weekly-exec-report  - Friday capstone deck across the whole system

Optional admin: /brand, /ingest, /lint, /status, /cron-setup, /venture-sync.
```

**If `work/` is empty or doesn't exist (this is the bare `personal-os` template):**

Find the prompts folder. Try these candidate paths in order, stop at the first that contains `01-sprint-tracker/prompt_1_build.md`:
1. `../prompts/`
2. `../../prompts/`
3. `~/Desktop/prompts/`
4. `~/Downloads/prompts/`

Use Bash to test: `[ -f <candidate>/01-sprint-tracker/prompt_1_build.md ] && echo FOUND <candidate>`. If found, capture the absolute path. If none match, set PROMPTS_PATH to "(not found)".

Tell the user, substituting `{PROMPTS_PATH}`:

```
Your Personal Ops System skeleton is ready. No automations are built yet.

Build path: paste prompts one at a time, in order.

Found prompts folder: {PROMPTS_PATH}

Start here:
   open {PROMPTS_PATH}/01-sprint-tracker/prompt_1_build.md
   copy the contents, paste into chat.

The agent will build Sprint Tracker via /new (creates work/01-sprint-tracker/,
the command spec, and the Notion DB). When it marks itself Done on the board,
move to the next numbered folder in {PROMPTS_PATH} and work through them in order.

By the end your install will match personal-os-prebuilt.
```

If PROMPTS_PATH is "(not found)", say instead:

```
Your Personal Ops System skeleton is ready. No automations are built yet.

I couldn't find the prompts/ folder. It usually ships alongside personal-os/
as a sibling directory. Where did you save it? Paste the path or drop the
folder next to personal-os/ and tell me when ready.

If you don't have prompts/, you can still build free-form: run /new and
describe what you want. Sprint Tracker is a good first build:
  /new sprint tracker
```

Either way, end with: "Welcome aboard."
