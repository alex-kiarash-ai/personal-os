<#
  play.ps1 - Play an mp3 to the end, windowless. Meant to be launched detached
  so the caller (the Stop hook) returns immediately.
#>
param([Parameter(Mandatory = $true)][string]$Path)

if (-not (Test-Path -LiteralPath $Path)) { exit 0 }

Add-Type -AssemblyName PresentationCore
$p = New-Object System.Windows.Media.MediaPlayer
$p.Open([System.Uri]::new((Resolve-Path -LiteralPath $Path).Path))

# Wait for the duration metadata to load.
$i = 0
while (-not $p.NaturalDuration.HasTimeSpan -and $i -lt 30) { Start-Sleep -Milliseconds 100; $i++ }
$dur = 10
if ($p.NaturalDuration.HasTimeSpan) { $dur = [int][math]::Ceiling($p.NaturalDuration.TimeSpan.TotalSeconds) }

$p.Volume = 1.0
$p.Play()
Start-Sleep -Seconds ($dur + 1)
$p.Stop()
$p.Close()
