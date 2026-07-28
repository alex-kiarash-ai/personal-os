# One-shot desktop reminder: fired by the Windows scheduled task
# "Alex-PortalScanner-ResetReminder" at ~10:30 Mon 2026-07-27, just after the
# Anthropic usage cap resets. Pure local notification, no Claude usage.
Add-Type -AssemblyName System.Windows.Forms | Out-Null
[System.Windows.Forms.MessageBox]::Show(
  "Your Anthropic usage limit has reset.`n`nReady to resume the Portal Scanner (#31) build - parked Sunday at Phase 2 (Phase 0 passed GO: 11 companies, 131 matching roles).`n`nOpen Claude Code and say:  continue portal scanner`n`nFull status: Notion (Portal Scanner #31 page) + vault\projects\portal-scanner\status.md",
  "Alex - Portal Scanner reminder",
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
