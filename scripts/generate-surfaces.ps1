# generate-surfaces.ps1 (audit step 3+5, 2026-07-06)
# Reads THE project registry (system/manifest.json; moved from work/18-recovery-layer 2026-07-08) and regenerates the derived surfaces:
#   1. The Routing Table in root CLAUDE.md (slim generated rows between markers)
#   2. The project table in docs/projects/README.md (between markers)
# Direction of truth: edit the registry, run this script. Never hand-edit between the markers.
# First run migrates: replaces the legacy hand-written tables with markers and archives the removed
# CLAUDE.md table verbatim to docs/projects/routing-table-detail-2026-07-06.md (detail also lives in
# vault/identity.md section 3 + each work/{NN}/CLAUDE.md).
# Zero tokens, pure PowerShell. Run after every registry change; the Close-Out Gate item is
# "registry updated + surfaces regenerated".
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$utf8 = New-Object System.Text.UTF8Encoding($false)
function ReadFile($p) { [IO.File]::ReadAllText((Join-Path $repo $p)) }
function WriteFile($p, $t) {
    if ($WhatIf) { Write-Host "WHATIF: would write $p ($($t.Length) chars)"; return }
    [IO.File]::WriteAllText((Join-Path $repo $p), $t, $utf8)
}

$m = (ReadFile 'system/manifest.json') | ConvertFrom-Json

# ---------- 1. CLAUDE.md routing table ----------
$B = '<!-- ROUTING-TABLE:BEGIN (generated from system/manifest.json by scripts/generate-surfaces.ps1 - edit the registry, then regenerate; do NOT hand-edit) -->'
$E = '<!-- ROUTING-TABLE:END -->'

$rows = @()
$rows += '| # | Command | State | Trigger | One line | Spec + status |'
$rows += '|---|---------|-------|---------|----------|---------------|'
foreach ($p in $m.projects) {
    $num = '{0:D2}' -f $p.num
    $cmd = if ($p.commands.Count -gt 0) { ($p.commands | ForEach-Object { "/$_" }) -join ' + ' } else { '(no command)' }
    if ($p.state -eq 'RETIRED') { $cmd = "~~$cmd~~" }
    $state = $p.state
    if ($p.revisit) { $state += " (revisit $($p.revisit))" }
    $rows += "| $num | $cmd | $state | $($p.trigger) | $($p.one_liner) | $($p.work_dir) - $($p.status_md) |"
}
foreach ($u in $m.meta.unnumbered) {
    $state = $u.state
    if ($u.revisit) { $state += " (revisit $($u.revisit))" }
    $specStatus = @($u.spec, $u.status_md) | Where-Object { $_ } | Select-Object -First 1
    $rows += "| - | $($u.title) | $state | $($u.trigger) | $($u.one_liner) | $specStatus |"
}
$table = ($rows -join "`n")
$block = "$B`n$table`n$E"

$claude = ReadFile 'CLAUDE.md'
if ($claude.Contains($B)) {
    $pre = $claude.Substring(0, $claude.IndexOf($B))
    $post = $claude.Substring($claude.IndexOf($E) + $E.Length)
    WriteFile 'CLAUDE.md' ($pre + $block + $post)
    Write-Host 'CLAUDE.md: regenerated between markers'
} else {
    # Migration: replace the legacy table (from its header row to the last | row before ## Utility Commands)
    $lines = $claude -split "`r?`n"
    $start = -1; $end = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($start -lt 0 -and $lines[$i] -match '^\|\s*#\s*\|\s*Command\s*\|') { $start = $i }
        if ($start -ge 0 -and $lines[$i] -match '^\|') { $end = $i }
        if ($start -ge 0 -and $lines[$i] -match '^## Utility Commands') { break }
    }
    if ($start -lt 0) { throw 'CLAUDE.md: neither markers nor a legacy routing table found' }
    $legacy = $lines[$start..$end] -join "`n"
    $archive = "# Routing Table - archived detail (pre-registry, snapshot 2026-07-06)`n`nThis is the last hand-written routing table from root CLAUDE.md, archived verbatim when the table became GENERATED from the project registry (system/manifest.json via scripts/generate-surfaces.ps1). Living detail: vault/identity.md section 3 + each work/{NN}/CLAUDE.md. This file is history, not truth.`n`n" + $legacy + "`n"
    WriteFile 'docs/projects/routing-table-detail-2026-07-06.md' $archive
    $newLines = @()
    if ($start -gt 0) { $newLines += $lines[0..($start-1)] }
    $newLines += $block -split "`n"
    if ($end -lt $lines.Count - 1) { $newLines += $lines[($end+1)..($lines.Count-1)] }
    WriteFile 'CLAUDE.md' (($newLines -join "`n"))
    Write-Host "CLAUDE.md: MIGRATED (legacy rows $start..$end archived to docs/projects/routing-table-detail-2026-07-06.md)"
}

# ---------- 2. docs/projects/README.md table ----------
$B2 = '<!-- PROJECT-TABLE:BEGIN (generated from system/manifest.json by scripts/generate-surfaces.ps1) -->'
$E2 = '<!-- PROJECT-TABLE:END -->'
$rows2 = @()
$rows2 += '| # | Project | State | One line |'
$rows2 += '|---|---------|-------|----------|'
foreach ($p in $m.projects) {
    $num = '{0:D2}' -f $p.num
    $rows2 += "| $num | [$($p.title)]($($p.docs)) | $($p.state) | $($p.one_liner) |"
}
foreach ($u in $m.meta.unnumbered) {
    $rows2 += "| - | [$($u.title)]($($u.docs)) | $($u.state) | $($u.one_liner) |"
}
$block2 = "$B2`n" + ($rows2 -join "`n") + "`n$E2"

$readme = ReadFile 'docs/projects/README.md'
if ($readme.Contains($B2)) {
    $pre = $readme.Substring(0, $readme.IndexOf($B2))
    $post = $readme.Substring($readme.IndexOf($E2) + $E2.Length)
    WriteFile 'docs/projects/README.md' ($pre + $block2 + $post)
    Write-Host 'README.md: regenerated between markers'
} else {
    $rl = $readme -split "`r?`n"
    $s = -1; $e = -1
    for ($i = 0; $i -lt $rl.Count; $i++) {
        if ($s -lt 0 -and $rl[$i] -match '^\|\s*#\s*\|\s*Project\s*\|') { $s = $i }
        elseif ($s -ge 0 -and $rl[$i] -match '^\|') { $e = $i }
        elseif ($s -ge 0 -and $e -ge 0 -and $rl[$i] -notmatch '^\|') { break }
    }
    if ($s -lt 0) { throw 'README.md: neither markers nor a legacy project table found' }
    $newR = @()
    if ($s -gt 0) { $newR += $rl[0..($s-1)] }
    $newR += $block2 -split "`n"
    if ($e -lt $rl.Count - 1) { $newR += $rl[($e+1)..($rl.Count-1)] }
    WriteFile 'docs/projects/README.md' (($newR -join "`n"))
    Write-Host 'README.md: MIGRATED (legacy table replaced with generated block)'
}

Write-Host "done: $($m.projects.Count) projects + $($m.meta.unnumbered.Count) unnumbered"
