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

# Shared fail-loud handler (BUG-02 fix, 2026-07-16 diagnostic audit). Pushes RED integrity (value_num
# -1) to Alex HQ + logs, so the checker can never sit stale-green while dead. Used by BOTH the
# pre-sweep manifest-load guard below AND the sweep's catch (they were duplicated; now one path).
function Push-CheckerError($err) {
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
}

# BUG-02 fix (2026-07-16 diagnostic audit): this load + the -Init baseline reads were OUTSIDE the
# fail-loud try/catch (which started below at the sweep). A missing/corrupt manifest.json therefore
# killed the checker at parse time - exit 1, NO red push - the exact stale-green-while-dead class this
# whole layer exists to kill (proven by the audit's P2-4 rename probe). Guard it with the shared handler.
try {
    $manifest = Get-Content (Join-Path $repo "system\manifest.json") -Raw | ConvertFrom-Json   # registry moved to system/ 2026-07-08 (refactor A2)
} catch {
    Push-CheckerError "manifest load failed: $($_.Exception.Message)"
    exit 1
}
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
    ForEach-Object { $_.Value } | Where-Object { $_ -notlike 'PersonalOS-retry-*' -and $_ -ne 'PersonalOS-qra-poller' } | Sort-Object -Unique   # retry-* + the transient qra-poller (arm.ps1-created one-shot, OBS-21 fix 2026-07-15) excluded on BOTH sides
# PersonalOS-retry-* are the close-out lib's ephemeral one-shot retry tasks (self-registered on a
# failed run, auto-delete after their window, 2026-07-06). Not documented jobs; never drift.
$liveJobs = Get-ScheduledTask -TaskName "PersonalOS-*" -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -notlike 'PersonalOS-retry-*' -and $_.TaskName -ne 'PersonalOS-qra-poller' } | ForEach-Object { $_.TaskName }
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

# --- C10 uncommitted-spec drift: a work CLAUDE.md differs from its COMMITTED version (git HEAD) ---
# CHANGED 2026-07-21 (audit F-02 / Class B "auto-track committed state"). Was "changed since the last
# -Init baseline", which flagged EVERY committed edit until a human re-ran -Init - chronic noise (13
# stale rows at the audit) that masks the real signal. Now COMMITTED = ACCEPTED: C10 flags ONLY an
# UNCOMMITTED / out-of-band edit (working tree != HEAD), which is the true "changed and not yet moved
# through review + commit" drift. It is stateless (git IS the baseline), so it can never itself go
# stale again. The "re-review the manifest one-liner when a spec changes" nudge moved to the weekly
# /self-review, which diffs work/**/CLAUDE.md over the week. Falls back to the -Init baseline only when
# git is unavailable (e.g. a pre-first-commit restore). C8 (stale-status) deliberately KEEPS the -Init
# baseline: it catches a COMMITTED spec change whose status.md was not propagated, which git HEAD cannot see.
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$gitOk = $false
try { git -C $repo rev-parse --is-inside-work-tree *> $null; $gitOk = ($LASTEXITCODE -eq 0) } catch { $gitOk = $false }
if ($gitOk) {
    foreach ($p in $manifest.projects) {
        $rel = "$($p.work_dir)/CLAUDE.md"
        if (-not (Test-Path (Join-Path $repo $rel))) { continue }
        git -C $repo diff --quiet HEAD -- $rel *> $null
        if ($LASTEXITCODE -ne 0) { Add-Drift 'manifest-stale' "#$($p.num) $($p.name): work CLAUDE.md has UNCOMMITTED changes vs HEAD (commit so the spec + baseline move together, or revert; the manifest-entry review is the weekly /self-review's job)" }
    }
} elseif (Test-Path $baselineFile) {
    $base = (Get-Content $baselineFile -Raw | ConvertFrom-Json).hashes
    foreach ($p in $manifest.projects) {
        $cur = Get-Sha (Join-Path $p.work_dir 'CLAUDE.md')
        $old = $base."$($p.num)"
        if ($old -and $cur -and ($cur -ne $old)) { Add-Drift 'manifest-stale' "#$($p.num) $($p.name): CLAUDE.md changed since last -Init (git unavailable; review the manifest entry, then re-run -Init)" }
    }
} else {
    Add-Drift 'manifest-stale' "no baseline yet and git unavailable - run 'check.ps1 -Init' to seed manifest hashes"
}
$ErrorActionPreference = $prevEAP

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

# --- C13 first-fire aging (upgrade P4, 2026-07-12, design 1.4): a LIVE/EVENT registry row that has
# NEVER fired (first_fire null) may age at most 14 days from its status.md frontmatter `created:`
# date (manifest states_doc rule). Past that = amber until it fires (a documented drill counts,
# first_fire_kind=drill) or is re-stated with a reason. ON-DEMAND/DORMANT/PARKED/RETIRED exempt.
# Detect-only, like everything here; the generator's V9 warns on the same condition.
$ffRows = @($manifest.projects) + @($manifest.meta.unnumbered)
foreach ($p in $ffRows) {
    if (@('LIVE', 'EVENT') -notcontains $p.state) { continue }
    if ($p.first_fire) { continue }
    $ffLabel = if ($p.num) { "#$($p.num) $($p.name)" } else { "$($p.name)" }
    $createdStr = $null
    if ($p.status_md -and (Test-Path $p.status_md)) {
        $mCreated = [regex]::Match((Get-Content $p.status_md -Raw), '(?m)^created:\s*(\d{4}-\d{2}-\d{2})')
        if ($mCreated.Success) { $createdStr = $mCreated.Groups[1].Value }
    }
    if (-not $createdStr) {
        Add-Drift 'first-fire' "$ffLabel : LIVE/EVENT with first_fire null and no status.md created date to age against (fix the frontmatter, or stamp first_fire)"
        continue
    }
    $ageDays = ((Get-Date) - [datetime]::ParseExact($createdStr, 'yyyy-MM-dd', $null)).TotalDays
    if ($ageDays -gt 14) {
        Add-Drift 'first-fire' "$ffLabel : never fired (first_fire null), created $createdStr ($([math]::Floor($ageDays))d ago, past the 14-day window) - fire it (a documented drill counts) or re-state with a reason"
    }
}

# --- C16 cadence-vs-schedule (upgrade P4, 2026-07-12, design 1.3.3): manifest cadence.label vs the
# Frequency text in scheduler/schedule.md, per project that carries schedule_jobs. Deterministic
# label -> frequency-pattern map; a project passes when ANY of its schedule.md entries (matched by
# job name, entries with a real '- Frequency:' line only) matches its label. Labels with no
# frequency expectation (on-demand/event/dormant/parked/retired, expected_hours null) are skipped.
# C14 (passphrase attestation) + C15 (PAT window) are IMPLEMENTED below (upgrade P10); C16 is above; C17 (skills-symlink restore guard) is below; C18 (machine-timezone vs travel-state, P8) is below; C19 (narrative numbers-drift, item 3) is below. 19 checks total (C1-C19).
$freqPatterns = @{
    'daily'     = 'daily|nightly|every day'
    'weekdays'  = 'weekday'
    'weekly'    = 'weekly|monday|tuesday|wednesday|thursday|friday|saturday|sunday'
    'monthly'   = 'monthly|last day|month-end'
    'always-on' = 'daily|always'
}
# parse schedule.md into sections (same '### ' + '- Frequency:' contract as scripts/lib/read-sources.js).
# A section belongs to a project when it names one of its PersonalOS-* jobs OR its '- Command:'
# first token matches one of the project's declared commands (the older entries - Morning Brief,
# Application Engine Watch - carry no job-name token inside their own section).
$schedRaw = Get-Content "scheduler\schedule.md" -Raw
$schedSections = @()
$schedParts = ($schedRaw -split '(?m)^### ') | Select-Object -Skip 1
foreach ($part in $schedParts) {
    $freqM = [regex]::Match($part, '(?m)^- Frequency:\s*(.+)$')
    $cmdM  = [regex]::Match($part, '(?m)^- Command:\s*/?([\w-]+)')
    $jobsIn = [regex]::Matches($part, 'PersonalOS-[\w-]+') | ForEach-Object { $_.Value } |
        Where-Object { $_ -notlike 'PersonalOS-retry-*' } | Sort-Object -Unique
    $schedSections += [pscustomobject]@{
        frequency = if ($freqM.Success) { $freqM.Groups[1].Value.Trim() } else { $null }
        command   = if ($cmdM.Success) { $cmdM.Groups[1].Value } else { $null }
        jobs      = @($jobsIn)
    }
}
foreach ($p in $manifest.projects) {
    if (-not $p.schedule_jobs -or $p.schedule_jobs.Count -eq 0) { continue }
    $cadLabel = if ($p.cadence) { $p.cadence.label } else { $null }
    if (-not $cadLabel -or -not $freqPatterns.ContainsKey($cadLabel)) { continue }   # no frequency expectation for this label
    $candidates = @($schedSections | Where-Object { $_.frequency -and (
        (@($_.jobs | Where-Object { $p.schedule_jobs -contains $_ }).Count -gt 0) -or
        ($_.command -and (@($p.commands) -contains $_.command))
    ) })
    if ($candidates.Count -eq 0) {
        Add-Drift 'cadence-schedule' "#$($p.num) $($p.name): cadence label '$cadLabel' but no schedule.md entry with a Frequency line names its job(s) ($($p.schedule_jobs -join ', '))"
        continue
    }
    $matched = @($candidates | Where-Object { $_.frequency -imatch $freqPatterns[$cadLabel] })
    if ($matched.Count -eq 0) {
        $freqTexts = ($candidates | ForEach-Object { $_.frequency }) -join ' / '
        Add-Drift 'cadence-schedule' "#$($p.num) $($p.name): manifest cadence label '$cadLabel' contradicts scheduler/schedule.md frequency text '$freqTexts'"
    }
}

# --- C14 passphrase attestation (upgrade P10, 2026-07-12, closes audit c14 without ever reading the
# secret): work/18-recovery-layer/state/passphrase-attested.txt carries a yyyy-MM-dd date on its
# first line - Shaheen writes/refreshes it AFTER confirming the vault-backup passphrase is in his
# password manager. Missing file or a date > 90 days old = amber (the 90-day re-check doubles as
# the rotation-review prompt, the c15 fold). The check NEVER touches the passphrase file itself.
$attestFile = Join-Path $stateDir 'passphrase-attested.txt'
if (-not (Test-Path $attestFile)) {
    Add-Drift 'attestation' "vault-backup passphrase NEVER attested: confirm it is in the password manager, then write today's date to work/18-recovery-layer/state/passphrase-attested.txt (queue row 'passphrase-attestation')"
} else {
    $attLine = (Get-Content $attestFile -TotalCount 1).Trim()
    $attDate = [datetime]::MinValue
    # PS 5.1: TryParseExact needs EXPLICIT culture/styles types - a $null culture breaks overload
    # resolution ("argument count 5" crash, caught live by the fail-loud wrapper 2026-07-12).
    $attOk = [datetime]::TryParseExact($attLine.Substring(0, [math]::Min(10, $attLine.Length)), 'yyyy-MM-dd',
        [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$attDate)
    if (-not $attOk) {
        Add-Drift 'attestation' "passphrase-attested.txt first line is not a yyyy-MM-dd date ('$attLine')"
    } elseif (((Get-Date) - $attDate).TotalDays -gt 90) {
        Add-Drift 'attestation' "passphrase attestation is $([math]::Floor(((Get-Date) - $attDate).TotalDays))d old (>90d): re-confirm the password-manager copy (and consider rotation), then refresh the dated file"
    }
}

# --- C15 PAT expiry window (upgrade P10, 2026-07-12, closes audit c17): the GitHub backup PAT in
# Windows Credential Manager expires ~2027-07 (created 2026-07-02, per root CLAUDE.md). Amber inside
# 60 days of expiry so rotation happens before the nightly push dies RED. UPDATE $patExpiry when the
# PAT is rotated (this constant is the check's single input; the credential itself is never read).
$patExpiry = [datetime]'2027-07-01'
$patDaysLeft = ($patExpiry - (Get-Date)).TotalDays
if ($patDaysLeft -le 60) {
    if ($patDaysLeft -le 0) {
        Add-Drift 'pat-expiry' "GitHub backup PAT expiry date ($($patExpiry.ToString('yyyy-MM-dd'))) has PASSED - rotate it in Windows Credential Manager + update `$patExpiry in check.ps1"
    } else {
        Add-Drift 'pat-expiry' "GitHub backup PAT expires in $([math]::Floor($patDaysLeft))d ($($patExpiry.ToString('yyyy-MM-dd'))): rotate it, then update `$patExpiry in check.ps1"
    }
}

# --- C17 skills symlink layer (BUG-16 fix, 2026-07-15): committed skill CONTENT lives in
# .agents/skills/; the discovery layer .claude/skills/ is gitignored links (junctions on Windows)
# that must be rebuilt on restore. A missing link = that (often MANDATORY) skill silently does not
# load, with nothing failing loud. Detect-only. Rebuild per pair:
#   cmd /c mklink /J .claude\skills\<name> ..\..\.agents\skills\<name>
$agentsSkills = Join-Path $repo '.agents\skills'
$claudeSkills = Join-Path $repo '.claude\skills'
if (Test-Path $agentsSkills) {
    $missingLinks = @()
    foreach ($d in (Get-ChildItem $agentsSkills -Directory -ErrorAction SilentlyContinue)) {
        if (-not (Test-Path (Join-Path $claudeSkills $d.Name))) { $missingLinks += $d.Name }
    }
    if ($missingLinks.Count) {
        Add-Drift 'skills-link' "$($missingLinks.Count) skill(s) in .agents/skills/ have no resolving .claude/skills/ link (rebuild per pair: cmd /c mklink /J .claude\skills\<name> ..\..\.agents\skills\<name>): $($missingLinks -join ', ')"
    }
}

# --- C18 machine timezone vs travel-state expectation (P8 scheduler TZ audit, 2026-07-17). Detect-only.
# The local Task Scheduler triggers fire at the machine's wall clock (see the Timezone Policy in
# scheduler/schedule.md). If the machine tz drifts from where Alex expects Shaheen to be, follows-Shaheen
# jobs (brief/triage) OR must-anchor jobs (server-coordinated) fire at the wrong hour. Expectation = the
# home tz, UNLESS system/travel-state.json (P7 trip-ops 1b) declares an active trip with a current_win_tz.
$homeWinTz = 'W. Europe Standard Time'   # Stockholm/Sweden in Windows tz ids
$expectedTz = $homeWinTz
$tripCtx = "no active trip -> expected home '$homeWinTz'"
$travelState = Join-Path $repo 'system\travel-state.json'
if (Test-Path $travelState) {
    try {
        $ts = Get-Content $travelState -Raw | ConvertFrom-Json
        if ($ts.home_win_tz) { $homeWinTz = $ts.home_win_tz; $expectedTz = $ts.home_win_tz }
        if ($ts.trip_id -and $ts.current_win_tz) {
            $expectedTz = $ts.current_win_tz
            $tripCtx = "travel-state trip '$($ts.trip_id)' -> expected '$expectedTz'"
        }
    } catch {
        Add-Drift 'timezone' "system/travel-state.json is not valid JSON - cannot verify the machine timezone expectation"
    }
}
$actualTz = (Get-TimeZone).Id
if ($actualTz -ne $expectedTz) {
    Add-Drift 'timezone' "machine timezone is '$actualTz' but $tripCtx (scheduler TZ policy, schedule.md). Set the machine tz or update system/travel-state.json so scheduled jobs fire at the right wall clock."
}

# --- C19 narrative numbers-drift (item 3, 2026-07-20): the identity-carrying master reference must not
# claim a recovery-check count the code disproves. A doc lying about the system IS structural drift, and
# the same-session-update standing order for the narrative docs was the last place Alex trusted a habit
# over a mechanism. Shells to the zero-token python checker (ONE source for the claim-set), like C12.
# MVP scope = the master reference .md's check-count claims; the plain-English guide .docx is phase 2.
try {
    $nd = python "scripts\narrative-drift-check.py" 2>&1
    if ($LASTEXITCODE -eq 2) { foreach ($ln in @($nd)) { if ("$ln".Trim()) { Add-Drift 'narrative-drift' ("$ln".Trim()) } } }
    elseif ($LASTEXITCODE -ne 0) { Add-Drift 'narrative-drift' "narrative-drift-check errored (exit $LASTEXITCODE): $(($nd | Select-Object -First 1))" }
} catch { Add-Drift 'narrative-drift' "narrative-drift-check could not run: $($_.Exception.Message)" }

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

# Vault-read health (item 2, 2026-07-20): INFORMATIONAL only, NEVER a drift item - a soft usage signal
# must not touch the checker's 0/2/1 drift semantics. Appends the analyzer's one line to the report the
# Monday brief reads. Zero-token; its exit code is deliberately IGNORED (it never affects $n or exit).
$report.Add("")
$vrLine = ''
try { $vrLine = (python "scripts\vault-reads-report.py" --days 60 2>&1 | Select-Object -First 1) } catch { $vrLine = "vault-read report unavailable: $($_.Exception.Message)" }
$report.Add("**Vault-read health (informational, not drift):** $vrLine")

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
    # layer was built to kill (design piece 5), now guarded inside the layer itself. Shared with the
    # pre-sweep manifest-load guard via Push-CheckerError (BUG-02 fix, 2026-07-16).
    Push-CheckerError $_.Exception.Message
    exit 1
}
