<#
  speak-hook.ps1 - Stop hook. Reads Alex's last reply from the transcript,
  cleans it for speech, generates an mp3 via OpenAI TTS, and plays it in the
  background. Text still shows on screen; this just adds the voice on top.

  Wired in .claude/settings.json under hooks.Stop.
#>
[CmdletBinding()]
param()

$here    = $PSScriptRoot
$logFile = Join-Path $here 'hook.log'
function Log($m) { try { Add-Content -LiteralPath $logFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding utf8 } catch {} }

try {
  $raw = [Console]::In.ReadToEnd()
  if (-not $raw) { Log 'no stdin'; exit 0 }

  $hook = $raw | ConvertFrom-Json
  if ($hook.stop_hook_active) { exit 0 }   # safety: never loop

  $transcript = $hook.transcript_path
  if (-not $transcript -or -not (Test-Path -LiteralPath $transcript)) { Log "no transcript: $transcript"; exit 0 }

  # Pull the last assistant message that has real text (skip tool-only turns).
  $lines = Get-Content -LiteralPath $transcript -Tail 80
  $text = $null
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if (-not $lines[$i]) { continue }
    try { $obj = $lines[$i] | ConvertFrom-Json } catch { continue }
    if ($obj.type -ne 'assistant') { continue }
    $content = $obj.message.content
    if (-not $content) { continue }
    $parts = @()
    foreach ($b in $content) { if ($b.type -eq 'text' -and $b.text) { $parts += $b.text } }
    if ($parts.Count -gt 0) { $text = ($parts -join "`n"); break }
  }
  if (-not $text) { Log 'no assistant text found'; exit 0 }

  # --- Clean markdown so it sounds like speech, not a screen reader ---
  $c = $text
  $c = [regex]::Replace($c, '(?s)```.*?```', ' . Code is on screen. ')       # fenced code
  $c = [regex]::Replace($c, '`([^`]*)`', '$1')                                 # inline code
  $c = [regex]::Replace($c, '!?\[([^\]]*)\]\([^\)]*\)', '$1')                  # links/images -> label
  $c = [regex]::Replace($c, '(?m)^\s{0,3}#{1,6}\s*', '')                       # headings
  $c = [regex]::Replace($c, '(?m)^\s*[-*+]\s+', '')                            # bullets
  $c = [regex]::Replace($c, '(?m)^\s*\d+\.\s+', '')                            # numbered lists
  $c = [regex]::Replace($c, '(?m)^\s*>\s?', '')                               # blockquotes
  $c = [regex]::Replace($c, '\*\*([^*]+)\*\*', '$1')                          # bold
  $c = [regex]::Replace($c, '\*([^*]+)\*', '$1')                              # italic
  $c = [regex]::Replace($c, '__([^_]+)__', '$1')                             # bold _
  $c = $c -replace '\|', ' '                                                   # table pipes
  $c = [regex]::Replace($c, '[ \t]+', ' ')
  $c = [regex]::Replace($c, '(\r?\n){2,}', "`n")
  $c = $c.Trim()
  if (-not $c) { Log 'empty after clean'; exit 0 }

  # Keep audio sane on very long replies; the full text is on screen anyway.
  $max = 2400
  if ($c.Length -gt $max) { $c = $c.Substring(0, $max) + ' . The rest is on screen.' }

  # Generate the mp3 (no autoplay from within speak.ps1).
  $mp3 = & (Join-Path $here 'speak.ps1') -NoPlay $c
  if (-not $mp3 -or -not (Test-Path -LiteralPath $mp3)) { Log "speak.ps1 produced no file. out=$mp3"; exit 0 }

  # Play detached + hidden so this hook returns instantly.
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $here 'play.ps1'), '-Path', $mp3
  ) | Out-Null

  Log "spoke ($($c.Length) chars) -> $mp3"
}
catch {
  Log "ERROR: $($_.Exception.Message)"
}
exit 0
