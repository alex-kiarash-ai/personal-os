# SYSTEM GUIDE: What Alex Is and How to Run It

The single human-readable reference for the Personal OS: what Alex is, how to set it up, how it runs,
and where everything lives. Distilled 2026-07-05 from GETTING-STARTED, SCHEDULING-GUIDE, the identity
files (installing-alex, alex-explained), soul.md, and CLAUDE.md, with the stale bits corrected and a
3-agent QA pass applied. For how Alex *behaves*, see the companion `PROTOCOL.md`. For the authoritative
per-automation detail, see the Routing Table in `CLAUDE.md`. (This guide refers to the product as "it";
Alex's own voice pronoun is set in soul.md.)

---

## 1. What Alex is
Alex is Shaheen's personal AI agent, not a chatbot. Three things make it more than a chat window:
1. **It remembers.** A persistent Obsidian vault of everything: people, projects, business, decisions,
   your own words.
2. **It acts.** Reads and drafts email, reads the calendar, builds docs and Excel, runs job pipelines,
   with guardrails. **Alex drafts, you decide; it never sends, posts, or publishes on its own** (email,
   LinkedIn, guest replies all wait for you).
3. **It runs on a schedule.** An 8:00 morning brief, a 9:00 standup, a Friday report, the laptop wakes
   and runs them, nobody presses a button.

Under the hood it is Claude, running inside Claude Code, wrapped in a folder of files, rules, and
schedules. That wrapper is the Personal OS. In soul.md's own words, kept verbatim: *"a personal AI
operating system that continuously learns from my feedback, remembers my context, and adapts its
behavior to become a more accurate digital representation of how I think and work."* (Context on the
owner: Shaheen is a Senior Power BI developer at UC AB in Stockholm, being laid off Oct 2026 and
pivoting to AI automation, which is why the job pipelines and the STEMPLICITY side venture exist.)

## 2. The two brain files
- **soul.md = who Alex is** (identity, personality, voice, and the "My Words" corpus). Loaded every
  session via a startup hook. If the first reply has personality, the hook worked.
- **CLAUDE.md = how Alex works** (the constitution: standing orders, the three gates, the routing table,
  the MCP reference, the rules). There are two: the project `CLAUDE.md` (this system) and a small global
  `~/.claude/CLAUDE.md` (graphify pointer + the Change Propagation standing order). Global config is
  split: `~/.claude/CLAUDE.md` plus `~/.claude/rules/` (e.g. `rules/context7.md`, the live-docs rule).
- The distilled operating law is `PROTOCOL.md`; the one-page system compendium for disaster recovery is
  `vault/identity.md` (local-only).

## 3. Requirements
- **A paid Claude account** (Max recommended; Pro burns out fast). Alex *is* Claude, no subscription is
  no brain.
- **Claude Code** (desktop app / Cowork, or the CLI). Windows 10/11 (Mac works too).
- **A Google account** (Gmail, Calendar, Drive). **Notion** (free), optional for the base brain but
  required for the CRM, expenses, content, and meeting-intel databases (without it Alex degrades to
  local files, per the Bootstrap rule). **Obsidian** (free, to read the vault). Base install is about an
  hour.

## 4. Install and first boot
1. **Install Claude Code:** desktop app from claude.com/claude-code, or the CLI installer
   (`irm https://claude.ai/install.ps1 | iex` on Windows, `curl -fsSL https://claude.ai/install.sh | bash`
   on Mac; `npm install -g @anthropic-ai/claude-code` also works).
2. **Get the files:** a direct copy (USB/zip) from Shaheen, OR `git clone -c core.longpaths=true` the
   private repo (the long-paths flag is mandatory on Windows). **Important:** the repo is scrubbed, so a
   git clone gives you a **vault-less skeleton** (the entire `vault/`, `soul.md`, and `work/*/config`
   are gitignored and local-only). Only a direct copy from Shaheen carries personal data.
3. **First boot:** open Claude Code *inside* the personal-os folder, then run `/status`. **If you cloned
   the repo there is no soul.md yet, so the first reply is plain Claude, that is expected**; personality
   appears after `/setup` writes soul.md (§5). Only a direct copy from Shaheen boots with personality
   already. If you *have* soul.md and still get plain Claude, the hook needs `cat` (ships with Git for
   Windows).
4. **Connect services** at **claude.ai, Settings, Connectors**: Gmail, Calendar, Drive (one Google
   sign-in), Notion (optional). The in-app `/mcp` manager inside Claude Code is an alternative path to
   the same connectors. Install the "Claude in Chrome" extension for browser control. (GitHub is used
   only for backup via git + a token, not a connector.)
5. **Optional phone control:** pair the Claude Code Desktop app (Cowork) with the mobile app so you can
   send Alex tasks from your phone (Dispatch). The Alex HQ dashboard (§6) is a separate phone surface for
   reading metrics.

## 5. Make it yours (a new owner building their own)
- **Run `/setup` first.** It interviews you and generates `soul.md` and the vault (a cloned repo has no
  vault to inherit or clear; only a direct copy from Shaheen would carry a previous owner's data to
  delete). Then run `/brand` for the brand config.
- **Then hand-refine `soul.md`** (the biggest lever, that is your identity and voice).
- Start building automations with **`/new`** and the per-project `work/{n}/CLAUDE.md` prompts (there is
  no `prompts/` folder).

## 6. The automations
There are **19 numbered automations** (`work/01…19`), each with a command and a `work/{n}/CLAUDE.md`
spec. The authoritative index (command, folder, type, and "feeds into" for each) is the **Routing Table
in `CLAUDE.md`**, treat that as the single source of truth (this guide does not duplicate it, to avoid a
second stale surface). In brief they cover: daily brief + standup, two job-application pipelines (BI and
AI, on a rented server), email triage, personal CRM, meeting intel, expense tracking, content, an
on-demand research team, a LinkedIn series, an Airbnb tracker, the Alex AI Radar, the Alex HQ metrics
dashboard, a health tracker (Apple Health, iPhone Shortcut, n8n), and the recovery layer (a zero-token
consistency checker). Plus #19 venture-sync (dormant).

**Utility commands:** `/setup`, `/ingest`, `/status`, `/lint`, `/new`, `/cron-setup`, `/brand`, and the
global `/graphify`. Which automations run essentially out of the box (Google + Notion): morning brief,
email triage, personal CRM, meeting intel, expense wrangler, content machine, research team, sprint
tracker (the sprint tracker also pushes to the Alex HQ n8n endpoint, so it's fullest once HQ is up). The
first Notion run auto-creates the databases under one "Personal OS" parent page (`/setup` must have set
`vault/projects/notion-parent-id.md` first). The infra-bound automations (the server pipelines, the
dashboard, Airbnb, the health tracker) are blueprints that need their own setup (an n8n server, an
iPhone Shortcut, etc.).

## 7. MCP reference (the tools Alex reaches)
- **MCP tools are deferred:** load them with `ToolSearch("select:<tool>")` before calling. Prefer an MCP
  tool if one exists; use Chrome only for sites with no connector; **never Chrome for Gmail, Calendar, or
  Notion.**
- **Gmail:** `query` uses Gmail search syntax; `gmail_create_draft` to stage (drafts wait for a human).
- **Google Calendar:** `timeMin` / `timeMax` in ISO 8601.
- **Notion:** all databases live under one "Personal OS" parent page. Property formats: Date
  `date:Field:start`, Checkbox `__YES__`/`__NO__`, Select the exact option string, Number raw. Creation
  is a fixed sequence (create, move under the parent, alter-column for select options, create views,
  create pages, replace content). `collection_id` and `data_source_id` are the same thing.
- **n8n (the Hetzner box, ~10 EUR/mo, always-on):** REST API base `https://n8n.shaheenkiarash.com/api/v1`,
  key at `work/03-application-engine/config/n8n-api-key.txt` sent as header `X-N8N-API-KEY`. Build n8n
  work via the API, not Chrome. The Application Engine also exposes its own MCP server (streamable HTTP
  at `…/mcp/app-engine`, v2, bearer-gated).
- **context7** is the default for any library/framework/SDK/API/CLI/cloud-service documentation question.
- **Claude Design (DesignSync)** for decks (export PDF, not `.pptx`); local **Whisper** transcribes voice
  on-laptop (nothing sent out).

## 8. Scheduling (Windows Task Scheduler)
Nothing runs until you schedule it. On this machine the scheduler is **Windows Task Scheduler**;
`/cron-setup` builds the jobs from `scheduler/schedule.md` (the Cowork Schedule sidebar also works). The
best first schedule is the morning brief, daily 8:00.
- **How a scheduled `claude -p` job works:** the scheduler fires at a time, runs
  `claude -p "Run /{command}" --dangerously-skip-permissions`, the work happens, the process exits, each
  run is a fresh session. `--dangerously-skip-permissions` is required because a headless run has no TTY
  to approve prompts (do not carry it into interactive use). **On this machine the Task Scheduler jobs
  run as the logged-in user and reuse existing credentials, so no OAuth token is needed**; a
  `claude setup-token` OAuth token is only for a truly detached cron (e.g. a headless Linux/macOS
  server).
- **The real jobs are hardened, not naive one-shots:** the scheduled wrappers are `.ps1` scripts that
  detect failure, push a RED/GREEN `run_status` to Alex HQ so a dead run is never silent, and retry past
  the quota reset (the sprint tracker uses a 4x90-min ladder). Some scheduled jobs are **zero-token
  scripts or remote n8n**, not `claude -p`: the recovery checker (`check.ps1`, Monday 07:30), the git
  and vault backups (21:30 / 21:45), and the health ingest (n8n, phone-triggered). Check any job's log
  in `outputs/logs/{name}.log`. On macOS/Linux the equivalent is `crontab`, that is the non-Windows
  variant only. (Note: alex-radar and the recovery checker both fire Monday 07:30 and both feed the 8:00
  brief; fine as-is, just don't stack more heavy jobs at that instant.)

## 9. Backup and recovery (Recovery layer, build #18)
- **Git backup (Phase 0):** the repo is under git (branch main), a daily **21:30** job
  (`PersonalOS-git-backup`) pushes to the private GitHub repo `alex-kiarash-ai/personal-os`.
- **Privacy scrub (2026-07-04):** GitHub now backs up **only the functional system** (code + how-it-works
  docs) plus Shaheen's name. The **entire `vault/`, `soul.md`, CV/contact/financial data, and workflow
  exports are gitignored and kept local-only** (they are NOT on GitHub). What may go to GitHub is
  governed by the `.gitignore` PRIVACY SCRUB section; when in doubt, keep personal data local.
- **Encrypted vault backup (Phase 1, 2026-07-04):** since the scrub left the personal half unbacked, a
  daily **21:45** job (`PersonalOS-vault-backup`) gpg-AES256-encrypts everything git ignores (minus
  regenerable junk) and ships the single blob to `n8n:/opt/alex-backups/` (last 14 kept). The passphrase
  is at `C:\Users\Thinkpad\.alex-secrets\vault-backup.pass` and **must also live in Shaheen's password
  manager**, or the off-machine blob is unrecoverable if the laptop dies.
- **Recovery checker (Phase 2):** a zero-token `check.ps1` sweep (Monday 07:30) validates the whole
  system against a manifest (11 checks) and pushes a `recovery/integrity` metric to Alex HQ.
- **Restore:** on Windows, `git clone -c core.longpaths=true`. Recreate credential files by hand (the
  backup holds no secrets): `n8n-api-key.txt`, `alex-hq-token.txt`, `hq-basic-auth.txt`, the Bright Data
  key `brightdata-api-key.dpapi`, `.claude/settings.local.json` (re-approve), the GitHub PAT (Windows
  Credential Manager), the Hetzner SSH key, `npm install` in `work/16-alex-hq/app`. Full credential map:
  `vault/identity.md` §5. **Never commit credential files or `**/.browser-profile/`.**

## 10. How Alex stays current
- **Alex AI Radar** (Monday 07:30): free feeds + a taste profile surface tool/model upgrades and
  build-and-sell ideas; the permission gate is that Alex only marks items "Interesting," Shaheen
  promotes them. A **friction list** keeps upgrades chasing real pains, not novelty. A **self-watch
  lane** does a monthly capability diff on Alex's own stack.
- **context7** fetches live library docs so Alex is not stuck on stale training data.
- **The error-log flywheel:** every failure and its fix is logged to `vault/projects/error-log.md`, and
  checked before any retry, so the system gets more reliable over time.

## 11. Success checklist
- `/status` runs and reports.
- After `/setup`, the folder opens with personality (soul.md hook fired; a fresh clone is plain Claude
  until `/setup` writes soul.md).
- Services are connected (a real `/morning-brief` produces a real brief).
- A scheduled job has fired (check `outputs/logs/`).
- Backups are green (git 21:30, vault 21:45) and the vault passphrase is in your password manager.
