<#
  talk.ps1 - launcher for Alex Voice v2 (hands-free).
  Put the Jabra headset ON so Alex's voice doesn't leak into the mic (barge-in needs it).
  Say "hey jarvis" to start a turn; just talk over her to cut in; Ctrl-C or "goodbye Alex" to quit.
#>
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }   # fall back to global if the venv is gone
Write-Host 'Starting Alex Voice v2... (say "hey jarvis", talk over her to interrupt, Ctrl-C to quit)' -ForegroundColor Cyan
& $py "$PSScriptRoot\alex_voice.py" @args
