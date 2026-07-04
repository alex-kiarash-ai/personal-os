# work/18-recovery-layer/check.ps1  —  Recovery Phase 2: the deterministic checker.
#
# ZERO LLM tokens. Level-triggered reconciliation (Kubernetes/Terraform style): re-checks the
# WHOLE system against the desired state in manifest.json, forgiving of missed Change-Propagation
# events (the standing order is edge-triggered and forgets when a session dies mid-propagation;
# this sweep is the layer that can't forget). It DETECTS, never auto-repairs (IaC warning).
#
# Exit 0 = clean · 2 = drift found (Terraform `-detailed-exitcode` convention) · 1 = checker error.
# Pushes recovery/integrity to Alex HQ (green clean / amber drift). Writes a human drift report to
# vault/projects/recovery/last-sweep.md for the Monday morning brief. Log: outputs/logs/recovery-check.log.
#
#   check.ps1 -Init     baseline the manifest CLAUDE.md hashes + log high-water (run after real changes)
#   check.ps1           run the sweep (scheduled Monday 07:30 as PersonalOS-recovery-check)
#   check.ps1 -DryRun   run the sweep, print, but do NOT push to HQ (testing)
#
# Design: vault/research/alex-recovery-layer.md (pieces 1-2). Runbook: vault/projects/recovery/recovery-layer-plan.md.
param([switch]$Init, [switch]$DryRun)

$ErrorActionPreference = 'Stop'
$repo = "C:\Users\Thinkpad\Desktop\personal-os"
Set-Location $repo
$here     = "work\18-recovery-layer"
$stateDir = Join-Path $here "state"
New-Item -ItemType Directory -Force $stateDir | Out-Null
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\recovery-check.log"
function Say($m) { "$m" | Out-File -Append -Encoding utf8 $log }

$manifest = Get-Content (Join-Path $here "manifest.json") -Raw | ConvertFrom-Json
$baselineFile = Join-Path $stateDir "baseline.json"
$hwFile       = Join-Path $stateDir "log-highwater.json"

function Get-Sha($path) { if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash } else { $null } }

# ---------------------------------------------------------------- -Init: baseline desired state
if ($Init) {
    $hashes = @{}
    foreach ($p in $manifest.projects) {
        $cm = Join-Path $p.work_dir "CLAUDE.md"
        $hashes["$($p.num)"] = Get-Sha $cm
    }
    @{ hashes = $hashes; last_init = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $baselineFile
    $logLines = (Get-Content "vault\log.md" | Measure-Object -Line).Lines
    @{ lines = $logLines; updated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } |
        ConvertTo-Json | Set-Content -Encoding utf8 $hwFile
    Write-Output "Baselined: $($manifest.projects.Count) CLAUDE.md hashes + log high-water $logLines lines -> $stateDir"
    exit 0
}

# ---------------------------------------------------------------- sweep
$drift = New-Object System.Collections.Generic.List[object]
function Add-Drift($cat, $msg) { $drift.Add([pscustomobject]@{ cat = $cat; msg = $msg }) }

$claudeMd = Get-Content "CLAUDE.md" -Raw
$utility  = @($manifest.meta.utility_commands)
$knownExtra = @($manifest.meta.known_extra_projects_no_work_folder)

# Every command declared by a manifest project (for orphan-command reverse check).
$declaredCmds = New-Object System.Collections.Generic.HashSet[string]
foreach ($p in $manifest.projects) { foreach ($c in $p.commands) { [void]$declaredCmds.Add($c) } }
foreach ($u in $utility) { [void]$declaredCmds.Add($u) }

# --- C1 quad completeness: each project has work dir, status.md, and each declared command file ---
foreach ($p in $manifest.projects) {
    if (-not (Test-Path $p.work_dir))     { Add-Drift 'quad' "#$($p.num) $($p.name): work dir missing ($($p.work_dir))" }
    if (-not (Test-Path (Join-Path $p.work_dir 'CLAUDE.md'))) { Add-Drift 'quad' "#$($p.num) $($p.name): work CLAUDE.md missing" }
    if (-not (Test-Path $p.status_md))    { Add-Drift 'quad' "#$($p.num) $($p.name): status.md missing ($($p.status_md))" }
    foreach ($c in $p.commands) {
        if (-not (Test-Path ".claude\commands\$c.md")) { Add-Drift 'quad' "#$($p.num) $($p.name): command file .claude/commands/$c.md missing" }
    }
    # --- C5 routing row: project's work_dir referenced in the routing table ---
    if ($claudeMd -notmatch [regex]::Escape($p.work_dir)) { Add-Drift 'routing' "#$($p.num) $($p.name): no routing-table row (work_dir not in CLAUDE.md)" }
}

# --- C2 orphan commands: a command file that no project or utility claims (catches venture-sync) ---
foreach ($f in Get-ChildItem ".claude\commands" -Filter *.md) {
    $name = $f.BaseName
    if (-not $declaredCmds.Contains($name)) { Add-Drift 'orphan-cmd' "command '/$name' is not owned by any project or utility (register it in the routing table + manifest)" }
}

# --- C3 orphan work folders: a work/NN-* dir with no manifest entry ---
$manifestDirs = $manifest.projects | ForEach-Object { $_.work_dir.Replace('/', '\') }
foreach ($d in Get-ChildItem "work" -Directory | Where-Object { $_.Name -match '^\d{2}-' }) {
    $rel = "work\$($d.Name)"
    if ($manifestDirs -notcontains $rel) { Add-Drift 'orphan-work' "work folder '$rel' has no manifest entry" }
}

# --- C4 orphan vault projects: a vault/projects/* not registered (catches modeling + stale pages) ---
$registeredStatus = @($manifest.projects | ForEach-Object { $_.status_md.Replace('/', '\') })
$registeredStatus += @($knownExtra | ForEach-Object { $_.status_md.Replace('/', '\') })
foreach ($d in Get-ChildItem "vault\projects" -Directory) {
    $st = "vault\projects\$($d.Name)\status.md"
    if ($registeredStatus -notcontains $st) {
        if (Test-Path $st) { Add-Drift 'orphan-project' "vault project '$($d.Name)' has a status.md but is not in the manifest (retire -> archive, or register it)" }
        else               { Add-Drift 'orphan-project' "vault project dir '$($d.Name)' has no status.md and is unregistered (likely stale -> GC candidate)" }
    }
}

# --- C6 wiki-link resolution: every [[link]] resolves to a vault page (Obsidian basename/path style) ---
$vaultMd = Get-ChildItem "vault" -Recurse -Filter *.md |
    Where-Object { $_.FullName -notmatch '\\\.obsidian\\|\\sources\\|\\archive\\' }
$relpaths  = New-Object System.Collections.Generic.HashSet[string]
$basenames = New-Object System.Collections.Generic.HashSet[string]
foreach ($m in $vaultMd) {
    $rel = $m.FullName.Substring((Resolve-Path "vault").Path.Length + 1).Replace('\', '/').ToLower()
    [void]$relpaths.Add(($rel -replace '\.md$', ''))
    [void]$basenames.Add($m.BaseName.ToLower())
}
[void]$basenames.Add('soul')  # soul.md lives at the repo root (outside the Obsidian vault) but is a real target
# Placeholder targets that appear in prose/instructions, not real links.
$ignoreTargets = @('wiki links', 'wiki link', 'link', 'links', 'name', 'people/name', 'projects/name', 'business/company', 'wiki-links')
$unresolved = New-Object System.Collections.Generic.List[string]
# index.md + log.md are navigation/append-only history (graph-builder convention): skip as link SOURCES.
foreach ($m in ($vaultMd | Where-Object { $_.Name -ne 'index.md' -and $_.Name -ne 'log.md' })) {
    $src = $m.Name
    $content = Get-Content $m.FullName -Raw
    if (-not $content) { continue }
    foreach ($mt in [regex]::Matches($content, '\[\[([^\]|#]+)')) {
        $t = $mt.Groups[1].Value.Trim().ToLower()
        if ($t -eq '' -or $ignoreTargets -contains $t) { continue }
        $seg = ($t -split '/')[-1]
        $ok = $relpaths.Contains($t) -or ($basenames.Contains($seg))
        if (-not $ok) { foreach ($r in $relpaths) { if ($r.EndsWith("/$t")) { $ok = $true; break } } }
        if (-not $ok) { $unresolved.Add("[[$t]] in $src") }
    }
}
# ONE drift item for links (often one root cause repeated); samples go to the report, not the count.
$linkSamples = @()
if ($unresolved.Count -gt 0) {
    Add-Drift 'links' "$($unresolved.Count) unresolved [[wiki links]] (samples below)"
    $linkSamples = $unresolved | Select-Object -Unique -First 12
}

# --- C7 scheduler <-> live Task Scheduler ---
$docJobs = [regex]::Matches((Get-Content "scheduler\schedule.md" -Raw), 'PersonalOS-[\w-]+') |
    ForEach-Object { $_.Value } | Sort-Object -Unique
$liveJobs = Get-ScheduledTask -TaskName "PersonalOS-*" -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskName }
foreach ($j in $docJobs) { if ($liveJobs -notcontains $j) { Add-Drift 'scheduler' "documented job '$j' is NOT registered in Task Scheduler" } }
foreach ($j in $liveJobs) { if ($docJobs -notcontains $j) { Add-Drift 'scheduler' "registered job '$j' is NOT documented in scheduler/schedule.md" } }

# --- C8 dependent staleness: work CLAUDE.md edited well after its status.md (propagation may be stale) ---
foreach ($p in $manifest.projects) {
    $cm = Join-Path $p.work_dir 'CLAUDE.md'
    if ((Test-Path $cm) -and (Test-Path $p.status_md)) {
        $days = ((Get-Item $cm).LastWriteTime - (Get-Item $p.status_md).LastWriteTime).TotalDays
        if ($days -gt 7) { Add-Drift 'stale-status' "#$($p.num) $($p.name): CLAUDE.md is $([math]::Round($days)) days newer than status.md (propagation may be stale)" }
    }
}

# --- C9 log monotonicity: vault/log.md line count must never drop (append-only history) ---
$logLines = (Get-Content "vault\log.md" | Measure-Object -Line).Lines
$prevHw = if (Test-Path $hwFile) { [int](Get-Content $hwFile -Raw | ConvertFrom-Json).lines } else { 0 }
if ($logLines -lt $prevHw) { Add-Drift 'log-shrink' "vault/log.md shrank from $prevHw to $logLines lines (data loss?)" }
$newHw = [math]::Max($logLines, $prevHw)
@{ lines = $newHw; updated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } |
    ConvertTo-Json | Set-Content -Encoding utf8 $hwFile

# --- C10 manifest hash self-check: a work CLAUDE.md changed since the last -Init baseline ---
if (Test-Path $baselineFile) {
    $base = (Get-Content $baselineFile -Raw | ConvertFrom-Json).hashes
    foreach ($p in $manifest.projects) {
        $cur = Get-Sha (Join-Path $p.work_dir 'CLAUDE.md')
        $old = $base."$($p.num)"
        if ($old -and $cur -and ($cur -ne $old)) { Add-Drift 'manifest-stale' "#$($p.num) $($p.name): CLAUDE.md changed since last -Init (review the manifest entry, then re-run -Init)" }
    }
} else {
    Add-Drift 'manifest-stale' "no baseline yet - run 'check.ps1 -Init' to seed manifest hashes"
}

# ---------------------------------------------------------------- report
$n = $drift.Count
$byCat = $drift | Group-Object cat | Sort-Object Count -Descending
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
Say "=== sweep $stamp : $n drift items ==="

$report = New-Object System.Collections.Generic.List[string]
$report.Add("# Recovery Sweep - last-sweep")
$report.Add("")
$report.Add("**$stamp** | result: $(if ($n -eq 0) {'CLEAN'} else {"$n drift items"})")
$report.Add("")
if ($n -eq 0) {
    $report.Add("System consistent: quads complete, links resolve, scheduler matches Task Scheduler, no orphans or shrink.")
} else {
    foreach ($g in $byCat) {
        $report.Add("## $($g.Name) ($($g.Count))")
        foreach ($item in $g.Group) { $report.Add("- $($item.msg)") }
        if ($g.Name -eq 'links' -and $linkSamples.Count -gt 0) { foreach ($s in $linkSamples) { $report.Add("  - $s") } }
        $report.Add("")
    }
    $report.Add("_Detect-only. Nothing was changed. Register/fix or retire-to-archive, then re-run. Content/semantic drift (stale prose) is the monthly /lint's job, not this sweep's._")
}
Set-Content -Encoding utf8 "vault\projects\recovery\last-sweep.md" ($report -join "`n")

# console summary
Write-Output "Recovery sweep: $(if ($n -eq 0) {'CLEAN'} else {"$n drift items"})"
foreach ($g in $byCat) { Write-Output ("  {0,-16} {1}" -f $g.Name, $g.Count) }
Write-Output "Report: vault/projects/recovery/last-sweep.md"

# ---------------------------------------------------------------- Alex HQ push (recovery/integrity)
$tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
if ((Test-Path $tokenFile) -and -not $DryRun) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    $head = if ($n -eq 0) { "consistent, $($manifest.projects.Count) projects" } else { "$n drift: " + (($byCat | Select-Object -First 3 | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ', ') }
    $body = @{ project = 'recovery'; metric_key = 'integrity'; value_num = $n
               headline = $head; status = $(if ($n -eq 0) { 'green' } else { 'amber' }) } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        Say "HQ push sent (integrity=$n)"
    } catch { Say "HQ push failed: $($_.Exception.Message)" }
}

Say "done ($n drift)"
if ($n -eq 0) { exit 0 } else { exit 2 }
