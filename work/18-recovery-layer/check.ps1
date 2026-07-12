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
# Derive the repo root from the script's own location (work/18-recovery-layer/check.ps1 -> ..\..).
# A RECOVERY tool must survive a restore to any path/machine, so never hardcode the root.
$repo = if ($PSScriptRoot) { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } else { (Get-Location).Path }
Set-Location $repo
$here     = "work\18-recovery-layer"
$stateDir = Join-Path $here "state"
New-Item -ItemType Directory -Force $stateDir | Out-Null
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\recovery-check.log"
function Say($m) { "$m" | Out-File -Append -Encoding utf8 $log }

$manifest = Get-Content (Join-Path $repo "system\manifest.json") -Raw | ConvertFrom-Json   # registry moved to system/ 2026-07-08 (refactor A2)
$baselineFile = Join-Path $stateDir "baseline.json"
$hwFile       = Join-Path $stateDir "log-highwater.json"

function Get-Sha($path) { if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash } else { $null } }

# ---------------------------------------------------------------- -Init: baseline desired state
if ($Init) {
    $hashes = @{}
    $statusHashes = @{}
    foreach ($p in $manifest.projects) {
        $hashes["$($p.num)"]       = Get-Sha (Join-Path $p.work_dir "CLAUDE.md")
        $statusHashes["$($p.num)"] = Get-Sha $p.status_md   # baseline the status.md too, for the hash-based C8
    }
    @{ hashes = $hashes; status_hashes = $statusHashes; last_init = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $baselineFile
    $logLines = (Get-Content "vault\log.md").Count   # true line count; Measure-Object -Line drops blank lines
    @{ lines = $logLines; updated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } |
        ConvertTo-Json | Set-Content -Encoding utf8 $hwFile
    Write-Output "Baselined: $($manifest.projects.Count) CLAUDE.md hashes + log high-water $logLines lines -> $stateDir"
    exit 0
}

# ---------------------------------------------------------------- sweep (wrapped: fail LOUD on checker error)
try {
$drift = New-Object System.Collections.Generic.List[object]
function Add-Drift($cat, $msg) { $drift.Add([pscustomobject]@{ cat = $cat; msg = $msg }) }

$claudeMd = Get-Content "CLAUDE.md" -Raw
$claudeMdLines = $claudeMd -split "`r?`n"
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
    # --- C5 routing row: a real '| NN |' TABLE row carrying this work_dir (not just any prose mention) ---
    $routingRow = $claudeMdLines | Where-Object { $_ -match "^\|\s*0*$($p.num)\s*\|" -and $_ -match [regex]::Escape($p.work_dir) }   # 0* tolerates zero-padded row numbers (| 01 |)
    if (-not $routingRow) { Add-Drift 'routing' "#$($p.num) $($p.name): no routing-table row ('| $($p.num) |' row carrying $($p.work_dir))" }
}

# --- C2 orphan commands: a command file that no project or utility claims (catches venture-sync) ---
foreach ($f in Get-ChildItem ".claude\commands" -Filter *.md) {
    $name = $f.BaseName
    if (-not $declaredCmds.Contains($name)) { Add-Drift 'orphan-cmd' "command '/$name' is not owned by any project or utility (register it in the routing table + manifest)" }
}

# --- C3 orphan work folders: ANY work/ dir (not just NN-*) with no manifest entry / allowlist ---
$manifestDirs = $manifest.projects | ForEach-Object { $_.work_dir.Replace('/', '\') }
$knownWork = @($manifest.meta.known_work_folders)   # non-project tooling folders (e.g. voice); allowlisted so a real rogue folder still flags
foreach ($d in Get-ChildItem "work" -Directory) {
    $rel = "work\$($d.Name)"
    if (($manifestDirs -notcontains $rel) -and ($knownWork -notcontains $d.Name)) {
        Add-Drift 'orphan-work' "work folder '$rel' has no manifest entry (register it, or add to meta.known_work_folders if it is non-project tooling)"
    }
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
# TARGET set INCLUDES vault/archive/ (supersede-never-delete GC keeps archived pages valid link targets).
$targetMd = Get-ChildItem "vault" -Recurse -Filter *.md |
    Where-Object { $_.FullName -notmatch '\\\.obsidian\\' }   # include archive/ AND sources/ as valid link TARGETS (real files); they're excluded as SOURCES below
$relpaths  = New-Object System.Collections.Generic.HashSet[string]
$basenames = New-Object System.Collections.Generic.HashSet[string]
$basenameCounts = @{}   # how many files share each basename; a UNIQUE basename may resolve a path-style link, an ambiguous one (status/index) may not
foreach ($m in $targetMd) {
    $rel = $m.FullName.Substring((Resolve-Path "vault").Path.Length + 1).Replace('\', '/').ToLower()
    [void]$relpaths.Add(($rel -replace '\.md$', ''))
    $bn = $m.BaseName.ToLower()
    [void]$basenames.Add($bn)
    $basenameCounts[$bn] = [int]$basenameCounts[$bn] + 1
}
[void]$basenames.Add('soul'); $basenameCounts['soul'] = 1  # soul.md lives at the repo root (outside the Obsidian vault) but is a real, unique target
# Placeholder targets that appear in prose/instructions, not real links.
$ignoreTargets = @('wiki links', 'wiki link', 'link', 'links', 'name', 'people/name', 'projects/name', 'business/company', 'wiki-links')
$unresolved = New-Object System.Collections.Generic.List[string]
# SOURCES exclude archive/ (don't scan retired pages), index.md + log.md (navigation/history),
# and last-sweep.md (the checker's OWN output — scanning it self-pollutes the next run's count).
# Also skip immutable dated records (history/ + standups/): append-only snapshots we never edit, so a
# dangling link in a 3-week-old brief is not actionable (same rationale as log.md/index.md).
$linkSources = $targetMd | Where-Object { $_.FullName -notmatch '\\archive\\|\\sources\\|\\history\\|\\standups\\' -and @('index.md', 'log.md', 'last-sweep.md') -notcontains $_.Name }
foreach ($m in $linkSources) {
    $content = Get-Content $m.FullName -Raw
    if (-not $content) { continue }
    # Strip fenced + inline code so [[links]] shown as EXAMPLES in code (incl. docs about dangling links) don't count.
    $content = $content -replace '(?s)```.*?```', '' -replace '`[^`]*`', ''
    foreach ($mt in [regex]::Matches($content, '\[\[([^\]|#]+)')) {
        $t = $mt.Groups[1].Value.Trim().TrimEnd('\').ToLower()   # TrimEnd('\'): a pipe escaped for a markdown table (\|) leaves a trailing backslash on the captured target
        if ($t -eq '' -or $ignoreTargets -contains $t) { continue }
        # Path-style links (containing /) must resolve to the FULL relpath; basename fallback is ONLY for
        # bare [[name]]. Otherwise [[x/status]] falsely resolves via any status.md (hollow "links resolve").
        if ($t -match '/') {
            $ok = $relpaths.Contains($t)
            if (-not $ok) { foreach ($r in $relpaths) { if ($r.EndsWith("/$t")) { $ok = $true; break } } }
            # A UNIQUE basename resolves (e.g. [[people/name]] -> the one name.md, per the People Protocol);
            # an AMBIGUOUS basename (status/index, ~19 files) does NOT, so [[x/status]] must match the real path.
            $seg = ($t -split '/')[-1]
            if (-not $ok -and $basenameCounts[$seg] -eq 1) { $ok = $true }
        } else {
            $ok = $relpaths.Contains($t) -or $basenames.Contains($t)
        }
        # Cross-tree: a link to a real file OUTSIDE vault/ (work/, sources/, outputs/) resolves if it exists on disk.
        # -LiteralPath so a target with wildcard chars (* ? [) can't glob-false-resolve; try/catch so an illegal-char
        # target degrades to "unresolved" instead of throwing into the fail-loud catch under ErrorActionPreference Stop.
        if (-not $ok) { try { if ((Test-Path -LiteralPath (Join-Path $repo "$t.md")) -or (Test-Path -LiteralPath (Join-Path $repo $t))) { $ok = $true } } catch { } }
        if (-not $ok) { $unresolved.Add($t) }   # store the bare target so we can rank distinct ones
    }
}
# ONE drift item for links; the report lists the TOP DISTINCT targets by count so real missing pages
# (e.g. a page referenced 10x that doesn't exist) don't hide behind one noisy root cause.
$linkSamples = @()
if ($unresolved.Count -gt 0) {
    $distinct = ($unresolved | Select-Object -Unique).Count
    Add-Drift 'links' "$($unresolved.Count) unresolved [[wiki links]] across $distinct distinct targets (top below)"
    $linkSamples = $unresolved | Group-Object | Sort-Object Count -Descending | Select-Object -First 12 |
        ForEach-Object { "[[$($_.Name)]] x$($_.Count)" }
}

# --- C7 scheduler <-> live Task Scheduler ---
$docJobs = [regex]::Matches((Get-Content "scheduler\schedule.md" -Raw), 'PersonalOS-[\w-]+') |
    ForEach-Object { $_.Value } | Where-Object { $_ -notlike 'PersonalOS-retry-*' } | Sort-Object -Unique   # retry-* excluded on BOTH sides (prose describing the retry mechanism is not a documented job; live side already excluded, 2026-07-11)
# PersonalOS-retry-* are the close-out lib's ephemeral one-shot retry tasks (self-registered on a
# failed run, auto-delete after their window, 2026-07-06). Not documented jobs; never drift.
$liveJobs = Get-ScheduledTask -TaskName "PersonalOS-*" -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -notlike 'PersonalOS-retry-*' } | ForEach-Object { $_.TaskName }
foreach ($j in $docJobs) { if ($liveJobs -notcontains $j) { Add-Drift 'scheduler' "documented job '$j' is NOT registered in Task Scheduler" } }
foreach ($j in $liveJobs) { if ($docJobs -notcontains $j) { Add-Drift 'scheduler' "registered job '$j' is NOT documented in scheduler/schedule.md" } }

# --- C8 dependent staleness (HASH-based, mtime-immune): spec changed since -Init but status.md did NOT ---
# Was mtime-based, which a mass write (privacy scrub) or a git clone bumps in BOTH directions -> false
# positives AND negatives. Hashing status.md + CLAUDE.md against the -Init baseline flags only a real
# propagation gap: "the spec moved, the status didn't." Resolution = propagate for real, then re-run -Init.
if (Test-Path $baselineFile) {
    $blC8 = Get-Content $baselineFile -Raw | ConvertFrom-Json
    if ($null -ne $blC8.status_hashes) {
        foreach ($p in $manifest.projects) {
            $curCm = Get-Sha (Join-Path $p.work_dir 'CLAUDE.md')
            $curSt = Get-Sha $p.status_md
            $oldCm = $blC8.hashes."$($p.num)"
            $oldSt = $blC8.status_hashes."$($p.num)"
            if ($oldCm -and $curCm -and ($curCm -ne $oldCm) -and $oldSt -and $curSt -and ($curSt -eq $oldSt)) {
                Add-Drift 'stale-status' "#$($p.num) $($p.name): CLAUDE.md changed since last -Init but status.md did not (propagate into status.md, then re-run -Init)"
            }
        }
    }
}

# --- C9 log monotonicity: vault/log.md line count must never drop (append-only history) ---
$logLines = (Get-Content "vault\log.md").Count   # true line count; Measure-Object -Line drops blank lines
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

# --- C11 index catalog (index.md <-> disk): each manifest project's status page is catalogued in the index ---
# Design piece-2 "index.md <-> disk diff": a registered project missing from the catalog goes undetected.
$indexRaw = Get-Content "vault\index.md" -Raw
foreach ($p in $manifest.projects) {
    $stRef = ($p.status_md -replace '^vault/', '' -replace '\.md$', '')   # e.g. projects/job-pipeline/status
    if ($indexRaw -notmatch [regex]::Escape($stRef)) { Add-Drift 'index' "#$($p.num) $($p.name): status page [[$stRef]] not catalogued in vault/index.md" }
}

# --- C12 outputs naming (2026-07-11, the amended-Ledger build): outputs/ top-level dirs must be
# manifest keys or the declared exemptions in scripts/outputs-ledger.js (ONE source of truth for the
# list, so this calls the validator instead of duplicating it). Detect-only here; the nightly
# vault-backup reconcile is the healing lane. Guards the backup whitelist against silent name drift.
try {
    $lv = node "scripts\outputs-ledger.js" validate 2>&1
    if ($LASTEXITCODE -eq 2) { Add-Drift 'outputs-naming' (($lv | Select-Object -First 1) -join '') }
    elseif ($LASTEXITCODE -ne 0) { Add-Drift 'outputs-naming' "outputs-ledger validate errored (exit $LASTEXITCODE)" }
} catch { Add-Drift 'outputs-naming' "outputs-ledger validate could not run: $($_.Exception.Message)" }

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
    try {   # token read + body build INSIDE the try: a bad/empty token never fails the sweep (report is already written)
        $token = (Get-Content $tokenFile -Raw).Trim()
        $head = if ($n -eq 0) { "consistent, $($manifest.projects.Count) projects" } else { "$n drift: " + (($byCat | Select-Object -First 3 | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ', ') }
        $body = @{ project = 'recovery'; metric_key = 'integrity'; value_num = $n
                   headline = $head; status = $(if ($n -eq 0) { 'green' } else { 'amber' }) } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        Say "HQ push sent (integrity=$n)"
    } catch { Say "HQ push failed: $($_.Exception.Message)" }
}

Say "done ($n drift)"
if ($n -eq 0) { exit 0 } else { exit 2 }
}
catch {
    # Fail LOUD: the checker itself broke. Push RED integrity (value_num -1) so the tile can't sit
    # stale-green while the sweep is dead — the exact "job can't announce its own failure" class this
    # layer was built to kill (design piece 5), now guarded inside the layer itself.
    $err = $_.Exception.Message
    Say "CHECKER ERROR: $err"
    Write-Output "Recovery checker ERROR (exit 1): $err"
    $tf = "work\16-alex-hq\config\alex-hq-token.txt"
    if ((Test-Path $tf) -and -not $DryRun) {
        try {
            $token = (Get-Content $tf -Raw).Trim()
            $body = @{ project = 'recovery'; metric_key = 'integrity'; value_num = -1
                       headline = "checker ERROR: $err"; status = 'red' } | ConvertTo-Json -Compress
            Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        } catch { Say "RED error-push failed: $($_.Exception.Message)" }
    }
    exit 1
}
