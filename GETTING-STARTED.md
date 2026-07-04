# Getting Started with Your Personal OS

Do these steps BEFORE you run /setup. Takes about 5-10 minutes.

## Step 1: Install Prerequisites

**Claude Code** (if not already installed):
```bash
npm install -g @anthropic-ai/claude-code
```

**Obsidian** (free): Download from https://obsidian.md

## Step 2: Connect Your Tools

Open Claude Code anywhere and type `/mcp` to open the connection manager. Authenticate these:

- **claude.ai Gmail** - Click it, sign in with your Google account
- **claude.ai Google Calendar** - Click it, same Google account
- **claude.ai Notion** - Enable it, sign in with your Notion workspace
- **claude.ai GitHub** - If you use GitHub, authenticate here too

These are one-time authentications. They persist across all sessions.

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

Start building automations by pasting prompts from the prompts/ folder into your session.
