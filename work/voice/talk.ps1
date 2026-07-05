<#
  talk.ps1 - launcher for Alex Voice. Runs the conversation loop.
  Wear headphones so Alex's voice doesn't leak into the mic.
#>
Write-Host "Starting Alex Voice... (Enter = talk, Esc = interrupt, q = quit)" -ForegroundColor Cyan
python "$PSScriptRoot\alex_voice.py"
