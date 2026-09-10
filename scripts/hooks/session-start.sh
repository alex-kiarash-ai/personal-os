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
# A01-T10 (2026-09-10): EXISTENCE was the whole test, so a 0-byte or truncated card booted as
# "SOUL-PATH: card" and the session ran with no identity while every surface said the card path was
# taken. The card carries its own integrity marker (a SOUL-CORE-STAMP tail written by the builder)
# and nothing read it. Three conditions now: the file exists, it is bigger than a floor no real card
# is under, and it ends in its stamp. A card that fails any of them falls back LOUDLY and says so in
# different words from a missing one, because "truncated" and "absent" have different causes.
if [ -f "$PD/soul-core.md" ]    && [ "$(wc -c < "$PD/soul-core.md" 2>/dev/null || echo 0)" -gt 4000 ]    && tail -c 400 "$PD/soul-core.md" 2>/dev/null | grep -q "SOUL-CORE-STAMP: source-sha256="; then
  echo "SOUL-PATH: card"
else
  echo "SOUL-PATH: fallback-bounded"
  if [ -f "$PD/soul-core.md" ]; then
    echo "SOUL-FALLBACK: soul-core.md EXISTS but is INVALID (empty, truncated, or missing its SOUL-CORE-STAMP tail), so it was NOT used. Rebuild it with: node -e \"require('./scripts/lib/build-soul-core').build({force:true})\""
  fi
  echo "SOUL-FALLBACK: the compiled card was not usable, so only the first 8000 bytes of soul.md are injected below. This is a PARTIAL identity. Read soul.md in full before writing anything in Shaheen's voice, and rebuild the card with: node -e \"require('./scripts/lib/build-soul-core').build({force:true})\""
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
