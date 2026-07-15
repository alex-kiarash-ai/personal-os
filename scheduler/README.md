# Scheduler Registry

This folder tracks all scheduled tasks for your Personal Ops System.

When you tell your agent to schedule something (e.g., "schedule morning brief for 8 AM every day"), it creates an entry here instead of trying to set up a cron job directly.

## How It Works

1. You build automations in Claude Code
2. When you want one to run on a schedule, tell the agent
3. The agent adds it to scheduler/schedule.md
4. When you're ready, open Cowork (Claude Code Desktop)
5. Go to Schedule sidebar and create local tasks matching what's in schedule.md
6. Cowork runs them locally with full access to soul.md, vault, and everything

## Why This Way

Claude Code CLI can't schedule local recurring tasks. Cowork can. This folder bridges the two. You build in the CLI, schedule in Cowork.
