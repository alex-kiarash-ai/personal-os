#!/bin/sh
# scripts/hooks/session-start.sh - the SessionStart hook body. (P3.1 + P3.2, run-47 merged plan.)
#
# WHY THIS IS A FILE. This was a ~1.4KB one-liner inside .claude/settings.json: unversionable as
# code, untestable in isolation, and carrying `!`, nested quotes and && chains inside a JSON string.
# ECC retired exactly this shape after it broke on shells where `!` triggers history expansion, and
# their fix was the same one - move it to a named file the hook calls in one line. Behaviour here is
# preserved exactly, with the soul fallback bounded (below).
#
# CONTRACT: stdout becomes session context. Never exit nonzero (a failing SessionStart hook is worse
# than a missing one), so every branch is guarded and the script always ends `exit 0`.

PD="${CLAUDE_PROJECT_DIR:-.}"

# --- Identity (P3.2) --------------------------------------------------------------------------
# The card is delivered by CLAUDE.md's `@soul-core.md` import, NOT here; this is only the fallback
# for when the card is missing. That fallback used to `cat soul.md` - 229KB into a pipe the harness
# truncates at ~10KB, which delivered a silently corrupt ~2.3KB slice of identity and presented it
# as if it were the whole thing. That is the measured D5 defect (run-46), and it is the LAST live
# instance of it. Bounded to 8000 bytes and ANNOUNCED, so a degraded boot is loud instead of silent.
#
# SOUL-PATH is machine-greppable on purpose: the canary proves identity was injected, this proves
# WHICH path delivered it. Every headless log now answers that question for free.
if [ -f "$PD/soul-core.md" ]; then
  echo "SOUL-PATH: card"
else
  echo "SOUL-PATH: fallback-bounded"
  echo "SOUL-FALLBACK: soul-core.md is MISSING, so only the first 8000 bytes of soul.md are injected below. This is a PARTIAL identity. Read soul.md in full before writing anything in Shaheen's voice, and rebuild the card with: node -e \"require('./scripts/lib/build-soul-core').build({force:true})\""
  if [ -f "$PD/soul.md" ]; then
    head -c 8000 "$PD/soul.md" 2>/dev/null
    echo ""
    echo "[soul.md truncated at 8000 bytes by the SessionStart fallback]"
  else
    echo "SOUL-FALLBACK: soul.md is ALSO missing - this session has NO identity. Restore from the encrypted vault backup before doing voice work."
  fi
fi

# --- Dispatch context -------------------------------------------------------------------------
echo '---DISPATCH-CONTEXT---'
echo 'MCP tools are deferred. Before using Notion/Gmail/Calendar tools, load them via ToolSearch first.'
echo 'Notion date format: date:FieldName:start not flat string. Checkbox: __YES__/__NO__ not true/false.'
echo 'Gmail drafts: use gmail_create_draft MCP, not Chrome.'
echo 'Calendar: use timeMin/timeMax in ISO 8601.'
echo 'Check vault/projects/error-log.md for past MCP fixes before retrying.'

# --- Inbox notice ------------------------------------------------------------------------------
NEW_FILES=$(find "$PD/inbox" -type f ! -name '.gitkeep' ! -name '_ingested.md' ! -name '.DS_Store' 2>/dev/null | wc -l | tr -d ' ')
if [ "$NEW_FILES" != "0" ] && [ -n "$NEW_FILES" ]; then
  echo "---INBOX-NOTICE---"
  echo "You have $NEW_FILES file(s) in inbox/ that may need ingesting. If new, suggest running /ingest."
fi

# --- Waiting-on-you queue ----------------------------------------------------------------------
node "$PD/scripts/human-actions.js" sessionline 2>/dev/null

# --- Voice ---------------------------------------------------------------------------------------
if [ -f "$PD/outputs/voice/voice-on.flag" ]; then
  echo '---VOICE---'
  echo 'voice ON: hold Space on an EMPTY prompt to speak (EN/SV); Ctrl+Alt+D dictates any language (types, never submits); the transcript needs YOUR Enter; say "voice off" to stop. Cheatsheet: work/voice/CHEATSHEET.md'
  if [ "$TERM_PROGRAM" = "vscode" ]; then
    echo 'heads-up: Space-HOLD is swallowed by the VS Code integrated terminal - use a standalone terminal (Windows Terminal) or /voice tap.'
  fi
fi

exit 0
