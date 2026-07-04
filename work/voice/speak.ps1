<#
  speak.ps1 - Alex's voice. Turns text into a spoken .mp3 via OpenAI TTS.

  Usage:
    .\speak.ps1 "Hey Shaheen, morning brief is ready."
    .\speak.ps1 -Voice coral -NoPlay "Saved but don't autoplay."
    "piped text" | .\speak.ps1

  Requires: $env:OPENAI_API_KEY set (persistent user env var).
  Model: gpt-4o-mini-tts (supports delivery steering via -instructions).
  Voice default: sage (calm, wise - fits Alex). Swap with -Voice.
  Output: outputs/voice/YYYY-MM-DD/alex-HHmmss.mp3
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Text,
  [string]$Voice = "sage",
  [string]$OutDir,
  [switch]$NoPlay
)

$apiKey = $env:OPENAI_API_KEY
if (-not $apiKey) { $apiKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User') }
if (-not $apiKey) {
  Write-Error "OPENAI_API_KEY is not set. Set it once with: [Environment]::SetEnvironmentVariable('OPENAI_API_KEY','sk-...','User')"
  exit 1
}

$content = ($Text -join " ").Trim()
if (-not $content) { Write-Error "No text to speak."; exit 1 }

# How Alex should sound, not just what she says.
$instructions = "Speak as Alex: calm, incisive, warm but direct, with dry wit. Unhurried, natural human pacing. A wise mentor who cuts through noise. Never robotic or announcer-like."

$payload = @{
  model           = "gpt-4o-mini-tts"
  voice           = $Voice
  input           = $content
  instructions    = $instructions
  response_format = "mp3"
} | ConvertTo-Json -Depth 4

# Force UTF-8 so apostrophes / accents survive.
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

if (-not $OutDir) {
  $date = Get-Date -Format "yyyy-MM-dd"
  $OutDir = Join-Path $PSScriptRoot "..\..\outputs\voice\$date"
}
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$stamp   = Get-Date -Format "HHmmssfff"
$outFile = Join-Path $OutDir "alex-$Voice-$stamp.mp3"

try {
  Invoke-RestMethod -Uri "https://api.openai.com/v1/audio/speech" `
    -Method Post `
    -Headers @{ "Authorization" = "Bearer $apiKey" } `
    -ContentType "application/json" `
    -Body $bodyBytes `
    -OutFile $outFile -ErrorAction Stop
}
catch {
  Write-Error "TTS request failed: $($_.Exception.Message)"
  exit 1
}

Write-Output $outFile
if (-not $NoPlay) { Start-Process $outFile }
