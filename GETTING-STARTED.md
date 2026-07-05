# Getting Started with Your Personal OS

This is the quick pre-flight (prereqs + connect) before you run /setup, about 5-10 minutes. For the full picture (what Alex is, the automations, scheduling, backup/restore), see **SYSTEM-GUIDE.md**.

## Step 1: Install Prerequisites

**Claude Code** (if not already installed):
```bash
npm install -g @anthropic-ai/claude-code
```

**Obsidian** (free): Download from https://obsidian.md

## Step 2: Connect Your Tools

Go to **claude.ai → Settings → Connectors** (the in-app `/mcp` manager inside Claude Code is an alternative path to the same connectors). Authenticate these:

- **Gmail** - sign in with your Google account
- **Google Calendar** - same Google account
- **Google Drive** - same Google account (one Google sign-in covers all three)
- **Notion** - sign in with your Notion workspace (optional; needed for the CRM/expenses/content databases)

These are one-time authentications; they persist across all sessions. (GitHub is NOT a connector here, it's used only for backup via git + a token, set that up later during scheduling/restore.)

## Step 3: Run /setup

Open Claude Code in the personal-os folder:
```bash
cd personal-os
claude
```

Then run:
```
/setup
```

This walks you through:
- Verifying your MCP connections
- Building your identity (soul.md)
- Setting up your brand assets (optional)
- Setting up Obsidian

## Step 4: Optional - Dispatch for Phone Control

If you want to control your agent from your phone, set up Dispatch in Claude Code Desktop (Cowork). Pair your mobile app with the Desktop app. Then you can send tasks from your phone.

## You're Ready

Open Cowork and point it at the personal-os folder. Or run `claude` from the terminal in this directory. Your agent loads your personality automatically from soul.md.

Start building automations with `/new` (the master command that scaffolds any automation), or run an existing one directly (`/morning-brief`, `/email-triage`, and so on). Each automation's spec lives in its own `work/{n}-{name}/CLAUDE.md`.
