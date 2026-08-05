#!/usr/bin/env bash
# One-shot desktop reminder, fired just after the Anthropic usage cap resets.
# Pure local notification, no Claude usage.
# Ported from reset-reminder.ps1 (bash migration Phase 7, 2026-08-05): the Windows
# System.Windows.Forms.MessageBox has no cross-desktop equivalent, so this degrades through the
# usual Linux notification stack and always falls back to stdout - a reminder that prints is still a
# reminder, whereas one that throws because notify-send is absent is nothing at all.
set -uo pipefail

TITLE='Alex - Portal Scanner reminder'
BODY='Your Anthropic usage limit has reset.

Ready to resume the Portal Scanner (#31) build - parked Sunday at Phase 2 (Phase 0 passed GO: 11 companies, 131 matching roles).

Open Claude Code and say:  continue portal scanner

Full status: Notion (Portal Scanner #31 page) + vault/projects/portal-scanner/status.md'

if command -v notify-send >/dev/null 2>&1; then
    notify-send --urgency=normal "$TITLE" "$BODY"
elif command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"Portal Scanner #31 is ready to resume\" with title \"$TITLE\"" >/dev/null 2>&1
fi
printf '%s\n\n%s\n' "$TITLE" "$BODY"
