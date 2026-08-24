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
$soulHwFile   = Join-Path $stateDir "soul-highwater.json"

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
    # C28 (2026-08-23): record the ACCEPTED user-scope skill set. Deliberately a name inventory, not
    # hashes: the point is "what is installed outside every gate", and a name arriving or vanishing is
    # the signal. Hashing user-scope content would imply this repo governs it, which it does not.
    $usDir = Join-Path $env:USERPROFILE '.claude\skills'
    $usList = @()
    if (Test-Path $usDir) { $usList = @(Get-ChildItem $usDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } | Sort-Object) }
    @{ skills = $usList; updated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } |
        ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $stateDir 'user-skills-baseline.json')

    Write-Output "Baselined: $($manifest.projects.Count) CLAUDE.md hashes + log high-water $logLines lines + $($usList.Count) user-scope skill(s) -> $stateDir"
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

# --- C7 scheduler <-> live Task Scheduler (names AND trigger times) ---
$docJobs = [regex]::Matches((Get-Content "scheduler\schedule.md" -Raw), 'PersonalOS-[\w-]+') |
    ForEach-Object { $_.Value } | Where-Object { $_ -notlike 'PersonalOS-retry-*' -and $_ -ne 'PersonalOS-qra-poller' } | Sort-Object -Unique   # retry-* + the transient qra-poller (arm.ps1-created one-shot, OBS-21 fix 2026-07-15) excluded on BOTH sides
# PersonalOS-retry-* are the close-out lib's ephemeral one-shot retry tasks (self-registered on a
# failed run, auto-delete after their window, 2026-07-06). Not documented jobs; never drift.
$liveTasks = @(Get-ScheduledTask -TaskName "PersonalOS-*" -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -notlike 'PersonalOS-retry-*' -and $_.TaskName -ne 'PersonalOS-qra-poller' })
$liveJobs = $liveTasks | ForEach-Object { $_.TaskName }
foreach ($j in $docJobs) { if ($liveJobs -notcontains $j) { Add-Drift 'scheduler' "documented job '$j' is NOT registered in Task Scheduler" } }
foreach ($j in $liveJobs) { if ($docJobs -notcontains $j) { Add-Drift 'scheduler' "registered job '$j' is NOT documented in scheduler/schedule.md" } }

# C7b TRIGGER TIMES (added 2026-07-25, stress-test fix F-05). Until now every scheduler check compared
# NAMES: C7 (doc <-> live), validator V2's live half (doc <-> live), and C16 (manifest cadence label <->
# schedule.md frequency TEXT, i.e. doc <-> doc). So a job whose trigger TIME was hand-edited, or mangled
# by a task re-creation, fired at the wrong hour forever while every surface read green. This closes the
# last unguarded half of the scheduler contract: the documented hour must equal the LIVE hour.
#
# Deliberately soft where it cannot be certain, so it can never cry wolf:
#   - the expected time is parsed from the section's '- Frequency:' line ONLY (never body prose, which
#     legitimately mentions other times, e.g. the n8n engine note inside the Application Engine section);
#   - a Frequency line with no parseable clock time is SKIPPED (on-demand/event/phone-side entries);
#   - a task whose trigger carries no StartBoundary (logon/event triggers) is SKIPPED;
#   - a task with several triggers passes if ANY trigger matches the documented time.
function Get-DocTimeFromFrequency([string]$freq) {
    if (-not $freq) { return $null }
    if ($freq -imatch 'on-?demand|event-driven|^\s*none\b') { return $null }   # no clock promise
    # "8:00 AM" / "4:00 PM" / "05:00" / "at 9" - first clock-looking token wins
    $m = [regex]::Match($freq, '(?<h>\d{1,2}):(?<m>\d{2})\s*(?<ap>AM|PM)?', 'IgnoreCase')
    if (-not $m.Success) { return $null }
    $h = [int]$m.Groups['h'].Value; $mi = [int]$m.Groups['m'].Value
    $ap = $m.Groups['ap'].Value
    if ($ap) {
        if ($ap -imatch 'PM' -and $h -lt 12) { $h += 12 }
        elseif ($ap -imatch 'AM' -and $h -eq 12) { $h = 0 }
    }
    if ($h -gt 23 -or $mi -gt 59) { return $null }
    return ('{0:00}:{1:00}' -f $h, $mi)
}
# Map each documented job -> the time on its own section's Frequency line. Sections are the same
# '### ' blocks C16 parses; a section owns a job when it names it, or when its '- Command:' matches the
# job's name suffix (the older entries carry no job token inside their own section).
$jobDocTime = @{}
foreach ($part in (($schedRawC7 = Get-Content "scheduler\schedule.md" -Raw) -split '(?m)^### ' | Select-Object -Skip 1)) {
    $freqM = [regex]::Match($part, '(?m)^- Frequency:\s*(.+)$')
    if (-not $freqM.Success) { continue }
    $docTime = Get-DocTimeFromFrequency $freqM.Groups[1].Value
    if (-not $docTime) { continue }
    $named = [regex]::Matches($part, 'PersonalOS-[\w-]+') | ForEach-Object { $_.Value } |
        Where-Object { $_ -notlike 'PersonalOS-retry-*' } | Sort-Object -Unique
    $cmdM = [regex]::Match($part, '(?m)^- Command:\s*/?([\w-]+)')
    if ($named.Count -gt 0) {
        foreach ($n in $named) { if (-not $jobDocTime.ContainsKey($n)) { $jobDocTime[$n] = $docTime } }
    } elseif ($cmdM.Success) {
        $guess = "PersonalOS-$($cmdM.Groups[1].Value)"
        if (($liveJobs -contains $guess) -and -not $jobDocTime.ContainsKey($guess)) { $jobDocTime[$guess] = $docTime }
    }
}
foreach ($t in $liveTasks) {
    if (-not $jobDocTime.ContainsKey($t.TaskName)) { continue }          # no documented clock time
    $want = $jobDocTime[$t.TaskName]
    $liveTimes = @()
    foreach ($trg in @($t.Triggers)) {
        if (-not $trg.StartBoundary) { continue }
        try { $liveTimes += ([datetime]$trg.StartBoundary).ToString('HH:mm') } catch { }
    }
    if ($liveTimes.Count -eq 0) { continue }                             # logon/event trigger: nothing to compare
    if ($liveTimes -notcontains $want) {
        Add-Drift 'scheduler-time' "'$($t.TaskName)' fires at $($liveTimes -join '/') but scheduler/schedule.md documents $want (retime the task, or correct the doc - a wrong hour runs the job at the wrong time silently)"
    }
}

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

# --- RETIRED CHECK: the former C16 cadence-vs-schedule (deleted 2026-07-25, Shaheen: "APPLY") -------
# Deliberately NOT written as a "# --- C16" header: that is the pattern narrative-drift-check.py counts
# to derive the live check total, and a retired check must not inflate it. The NUMBER 16 is retired and
# never reused, so every dated reference to "C16" in the running-changes stays meaningful.
# It compared a project's manifest cadence.label against the '- Frequency:' prose of a
# schedule.md section it ASSOCIATED BY GUESS, and that guess was the defect: for #03 it matched the
# engine's cadence against the local watch job's frequency line and reported permanent false drift,
# because #03 legitimately has TWO cadences (a remote workflow on Tue/Thu 15:00 and a deliberately
# daily 08:30 local watch). A 'scope' opt-out flag was added first and rejected on the permanence bar:
# a flag a human must remember is the same shape as the defect (the next two-cadence project gets no
# flag and the false alarm returns).
#
# It is deleted rather than repaired because its job is now done STRICTLY BETTER by two checks that
# compare against REALITY instead of against another document, each joined on an exact identifier
# present on both sides:
#   C7b (above)            - every live Windows task's trigger hour vs the hour schedule.md documents
#   validator V6 leg (c)   - every project's declared n8n_cron vs the live scheduleTrigger
# So no code compares a project-level cadence to anything any more, and the conflation is not fixed,
# it is unwriteable. cadence.expected_hours/label remain what the 2026-07-25 manifest ruling already
# made them: inputs to the HQ tile age-render, never a detector. A wrong label can mis-colour a tile;
# it can no longer manufacture a weekly false fault. Check count 21 -> 20 (C1-C21, C16 retired).

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
    # PARKED skills (S1 Compiled Surfaces P4, 2026-08-16) are DELIBERATELY link-less: the docket
    # Shaheen approved parks a skill by removing its junction and flagging `parked: true` in
    # skills-lock.json (content stays; wake = node scripts/skills-park.js --wake <name>). A parked
    # row is exempt here; an UNPARKED row with no link is still the restore-gap this check exists for.
    $parkedSet = @{}
    try {
        $lk = Get-Content (Join-Path $repo 'skills-lock.json') -Raw | ConvertFrom-Json
        foreach ($n in ($lk.skills | Get-Member -MemberType NoteProperty).Name) {
            if ($lk.skills.$n.parked) { $parkedSet[$n] = $true }
        }
    } catch {}
    $missingLinks = @()
    foreach ($d in (Get-ChildItem $agentsSkills -Directory -ErrorAction SilentlyContinue)) {
        if ($parkedSet.ContainsKey($d.Name)) { continue }
        if (-not (Test-Path (Join-Path $claudeSkills $d.Name))) { $missingLinks += $d.Name }
    }
    if ($missingLinks.Count) {
        Add-Drift 'skills-link' "$($missingLinks.Count) UNPARKED skill(s) in .agents/skills/ have no resolving .claude/skills/ link (rebuild per pair: cmd /c mklink /J .claude\skills\<name> ..\..\.agents\skills\<name>; parked skills are exempt by design): $($missingLinks -join ', ')"
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

# --- C20 backup destinations (F1, 2026-07-25): >=2 INDEPENDENT off-machine destinations must each have
# verified a copy this cycle. The SPOF this kills: the sole off-machine backup home was the PRODUCTION
# n8n box, so a box+laptop loss (or box loss + a laptop-passphrase problem) was unrecoverable. This is
# the invariant that makes "add a 2nd destination" permanent: a silently-rotted 2nd leg (expired key,
# deleted bucket) can no longer hide behind a green primary. Declared destinations live in manifest
# meta.paths.backup_destinations; vault-backup.ps1 stamps state/backup-destinations.json per verified
# ship. Detect-only. Ambers (never reds) until >=2 are live - so the B2 provisioning stays visible.
$destDecl = @()
if ($manifest.meta.paths -and $manifest.meta.paths.backup_destinations) { $destDecl = @($manifest.meta.paths.backup_destinations) }
if ($destDecl.Count -ge 1) {
    $windowH = 72   # daily backup + slack; a destination not verified within this window does not count
    $verFile = "work\18-recovery-layer\state\backup-destinations.json"
    $verified = @{}
    if (Test-Path $verFile) {
        try { (Get-Content $verFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $verified[$_.Name] = $_.Value } } catch {}
    }
    # F-14 (2026-07-25): distinguish "the stamp mechanism has not run yet" from "a backup is dead".
    # On 07-25 C20 read "hetzner-n8n (no verified copy in 72h)" while the truth was that F1 shipped that
    # morning and the first stamped run had not happened yet - the primary backup log was fine. Reporting
    # a healthy-but-unstamped destination in the same words as a rotted one is how an amber teaches
    # people to ignore it.
    $stampMissing = -not (Test-Path $verFile)
    $freshCount = 0; $missing = @()
    foreach ($d in $destDecl) {
        $ts = $verified[$d.name]; $ok = $false
        if ($ts) { try { if (((Get-Date) - [datetime]$ts).TotalHours -le $windowH) { $ok = $true } } catch {} }
        if ($ok) { $freshCount++ }
        elseif ("$($d.note)" -match 'INERT|pending') { $missing += "$($d.name) (pending provisioning)" }
        elseif ($stampMissing) { $missing += "$($d.name) (never stamped: the destination-verification file does not exist yet, so this is UNPROVEN, not failed - the next vault-backup run writes it)" }
        else { $missing += "$($d.name) (no verified copy in ${windowH}h)" }
    }
    if ($freshCount -lt 2) {
        $lead = if ($stampMissing) { "backup destinations UNPROVEN: $verFile has never been written (F1 stamping is new), so 0 of $($destDecl.Count) destinations can be confirmed this cycle" }
                else { "only $freshCount of $($destDecl.Count) independent backup destination(s) verified a copy in the last ${windowH}h" }
        Add-Drift 'backup-spof' "$lead - a correlated single-point loss risks the backups until >=2 are live: $($missing -join '; ') (provision: human-actions f1-b2-backup)"
    }
}

# --- C21 facts-ledger doc drift (Recall Spine Phase 1, 2026-07-25): standing IN-REPO docs tested
# against the bi-temporal fact ledger system/recall/facts.db. The DOC is the test subject; facts.db
# (derived from manifest/validate-alex.js/check.ps1/schtasks/skills-lock/attestation) is the
# expectation - so this does NOT reintroduce the V6 anti-pattern (deriving expectation FROM prose).
# Pays the ST-20/FR-04 "a doc lying about the system" debt for the machine-checkable claim class.
# Complements C19 (narrative-drift, the OUT-OF-REPO master doc): C21 owns the in-repo prose surface,
# no overlap. Shells to the node checker (self-harvests to stay fresh), the C12/C19 shell-out pattern.
try {
    $fc = node "scripts\facts-check.js" 2>&1
    if ($LASTEXITCODE -eq 2) { foreach ($ln in @($fc)) { if ("$ln".Trim()) { Add-Drift 'facts-drift' ("$ln".Trim()) } } }
    elseif ($LASTEXITCODE -ne 0) { Add-Drift 'facts-drift' "facts-check errored (exit $LASTEXITCODE): $(($fc | Select-Object -First 1))" }
} catch { Add-Drift 'facts-drift' "facts-check could not run: $($_.Exception.Message)" }

# --- C22 soul-corpus monotonicity (2026-07-28, command-layer review F-1): the soul.md "My Words"
# corpus must never SHRINK. Same shape as C9 (log monotonicity), applied to the highest-value file in
# the repo. Why it exists: /setup step 4B said "OVERWRITE the template ... Under 2.5KB" with no
# fresh-install branch, so any agent running /setup on a live install would truncate a 115KB corpus
# built over months. That failure is SILENT - every prose surface keeps working, it just stops
# sounding like Shaheen - and the Close-Out V check cannot catch it, because V only asks whether My
# Words gained AN entry today, which a freshly overwritten file satisfies. soul.md is gitignored, so
# no git-based guard (V10, V11, C10) can ever see it; the only copy is the nightly encrypted vault
# backup, last 14 kept. A weekly sweep detects well inside that window. Prose guards now live in
# setup.md too, but this is the half that does not depend on an agent reading carefully.
# Counts dated corpus entries ("### Harvested YYYY-MM-DD ..." and the bare "### YYYY-MM-DD ..." form).
$soulPath = Join-Path $repo 'soul.md'
if (-not (Test-Path $soulPath)) {
    Add-Drift 'soul-shrink' "soul.md is MISSING at $soulPath - Alex has no identity file (restore from the encrypted vault backup)"
} else {
    $soulText    = Get-Content $soulPath -Raw
    $soulLines   = (Get-Content $soulPath).Count
    $soulEntries = ([regex]::Matches($soulText, '(?m)^###\s+(Harvested\s+)?\d{4}-\d{2}-\d{2}')).Count
    $prevSoul    = if (Test-Path $soulHwFile) { Get-Content $soulHwFile -Raw | ConvertFrom-Json } else { $null }
    $prevEntries = if ($prevSoul) { [int]$prevSoul.entries } else { 0 }
    $prevSoulLn  = if ($prevSoul) { [int]$prevSoul.lines }   else { 0 }
    if ($soulEntries -lt $prevEntries) {
        Add-Drift 'soul-shrink' "soul.md My Words corpus SHRANK from $prevEntries to $soulEntries dated entries - the voice corpus is the input to every prose surface; restore from the 21:45 encrypted vault backup (last 14 kept) before it ages out"
    }
    if ($soulLines -lt $prevSoulLn) {
        Add-Drift 'soul-shrink' "soul.md shrank from $prevSoulLn to $soulLines lines (entries $prevEntries -> $soulEntries) - check for a truncating write"
    }
    @{ entries = [math]::Max($soulEntries, $prevEntries); lines = [math]::Max($soulLines, $prevSoulLn);
       updated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } |
        ConvertTo-Json | Set-Content -Encoding utf8 $soulHwFile
}

# --- C23 soul-core freshness (S1 Compiled Surfaces, 2026-08-16): soul-core.md is THE identity
# injection since the @-import swap (harness 2.1.220 truncates hook stdout at ~10KB, so the old
# `cat soul.md` path delivered ~2KB; the card rides a CLAUDE.md memory import and loads whole).
# The card's tail stamp carries source-sha256 = sha256(soul.md BYTES) at build time; this check
# recomputes the live hash (Get-FileHash, same byte primitive the builder uses) and AMBERS on any
# mismatch - a stale card means every session is fed yesterday's identity slice and the nightly
# 21:35 rebuild (run-vault-index.ps1) or the generator missed. A MISSING card also ambers: the
# SessionStart hook falls back to full soul.md (fail-open, by design), but on this harness that
# fallback delivers only the 2KB preview, so a silently deleted card must not hide behind it.
# The FIX half is the hq-heal-map `soul-core-stale` AUTO-SAFE row (rebuild --force + read-back,
# one attempt then escalate). Compute-and-compare; negative-tested at install with a stale stamp.
$corePath = Join-Path $repo 'soul-core.md'
if (Test-Path $soulPath) {
    if (-not (Test-Path $corePath)) {
        Add-Drift 'soul-core' "soul-core.md MISSING - sessions run on the truncated full-soul fallback (~2KB reaches the model). Rebuild: node scripts/lib/build-soul-core.js --force"
    } else {
        $coreText = Get-Content $corePath -Raw
        $stamp = [regex]::Match($coreText.Substring([math]::Max(0, $coreText.Length - 400)), 'source-sha256=([0-9a-f]{64})')
        if (-not $stamp.Success) {
            Add-Drift 'soul-core' "soul-core.md has no parseable SOUL-CORE-STAMP source-sha256 - hand-edited or truncated; rebuild: node scripts/lib/build-soul-core.js --force"
        } else {
            $liveSha = (Get-FileHash $soulPath -Algorithm SHA256).Hash.ToLower()
            if ($liveSha -ne $stamp.Groups[1].Value) {
                Add-Drift 'soul-core' "soul-core.md STALE: card built from sha $($stamp.Groups[1].Value.Substring(0,12)).. but soul.md is now $($liveSha.Substring(0,12)).. - the nightly rebuild missed; node scripts/lib/build-soul-core.js --force"
            }
        }
    }
}

# --- C24 status byte budget (S1 Compiled Surfaces P2, 2026-08-16): Tier-1 status.md files are
# SUMMARIES by contract and had grown to 87-180KB. scripts/status-rotate.js (nightly, before the
# 21:35 index build) moves whole dated H2 blocks to history/; this check reads LIVE byte counts
# against manifest meta.vault.status_byte_budget so a dead rotator cannot hide behind a green
# chain. Fires at budget + 10% (deliberate grace: the keep-the-newest-dated-block rule can land a
# file a few hundred bytes over, and an amber that cries over 4 bytes teaches amber-blindness,
# the F-14 lesson). The message distinguishes "movable blocks present = the rotator missed" from
# "undated standing weight = needs a human restructure / the monthly /lint" - different remedies.
# Negative-tested at install with a temp-inflated file.
$sbBudget = 0
try { $sbBudget = [int]$manifest.meta.vault.status_byte_budget } catch { $sbBudget = 0 }
if ($sbBudget -gt 0) {
    $sbRows = @($manifest.projects) + @($manifest.meta.unnumbered)
    $sbSeen = @{}
    foreach ($p in $sbRows) {
        if (-not $p.status_md) { continue }
        $sp = Join-Path $repo ($p.status_md -replace '/', '\')
        if ($sbSeen.ContainsKey($sp) -or -not (Test-Path $sp)) { continue }
        $sbSeen[$sp] = $true
        $len = (Get-Item $sp).Length
        if ($len -le [math]::Round($sbBudget * 1.1)) { continue }
        $txt = Get-Content $sp -Raw
        $movable = ([regex]::Matches($txt, '(?m)^##\s.*\b20\d{2}-\d{2}-\d{2}\b')).Count
        $why = if ($movable -gt 1) { "has $movable dated block(s) the rotator should have moved - is the nightly status-rotate step dead? (run: node scripts/status-rotate.js)" }
               else { "weight is UNDATED standing content - rotation cannot help; needs a human restructure (a /lint-class judgment pass)" }
        Add-Drift 'status-budget' "$($p.status_md) is $len B against the $sbBudget B Tier-1 budget - $why"
    }
}

# --- C25 inbound mail channels (2026-08-23): every custom address on the zone that forwards into
# Gmail is asserted to still have an enabled Cloudflare routing rule, and to have actually received
# mail inside its declared window. Born from a real 2.5-month silent outage: shaheen@shaheenkiarash.com,
# the ONLY contact address on the live portfolio site, stopped delivering around 2026-06-08 and
# nothing anywhere went red. What a MISSING rule does depends on the catch-all: enabled+drop means
# accepted-then-binned with nobody told; DISABLED means REJECTED at SMTP and the SENDER gets a bounce.
# CORRECTED 2026-08-23 from a live API read: this zone has it DISABLED, so the first version of this
# comment had the mechanism backwards, and its evidence was misread (two probe mails produced no bounce
# because they were DELIVERED and Gmail deduped Shaheen's own copies). Either way HE hears nothing, and
# he is the only observer the system can act for. Every component was green
# because the system only ever checked that its own JOBS ran, never that expected mail ARRIVED.
# Shelled out C12-style because the probe needs the network, and check.ps1's "no network except the
# one HQ push" contract must hold. Registry: system/mail-channels.json (add a channel = one row).
try {
    $mc = node "scripts\mail-channel-check.js" --dry 2>&1
    if ($LASTEXITCODE -eq 2) {
        foreach ($line in @($mc | Where-Object { $_ -match '^DRIFT: ' })) {
            Add-Drift 'mail-channels' ($line -replace '^DRIFT: ', '')
        }
    }
    elseif ($LASTEXITCODE -ne 0) { Add-Drift 'mail-channels' "mail-channel-check errored (exit $LASTEXITCODE): $(($mc | Select-Object -First 1) -join '')" }
} catch { Add-Drift 'mail-channels' "mail-channel-check could not run: $($_.Exception.Message)" }

# ---------------------------------------------------------------- report
# --- C30 code-map freshness (P7.1, run-47 merged plan, 2026-08-23): `scripts/code-index.js` builds a
# deterministic map of this repo's own code (what requires/dot-sources/invokes what) that /deep-audit
# and #27 migrations read instead of fanning out agents to re-read everything. A map is only useful
# while it is true, and a STALE map is worse than none: it answers confidently about code that has
# since moved, which is precisely the failure mode that disqualified graphify's query-first design.
# N/A when the map has never been built (an absent optional index is not drift); AMBER when it exists
# and the newest source file is more than 7 days newer than it. Shells out C12-style so this file's
# "no network except the one HQ push" contract holds and the freshness logic has ONE home.
if (Test-Path (Join-Path $repo 'system\code-graph.json')) {
    $cg = & node "scripts\code-index.js" --stale 2>&1 | Out-String
    if ($LASTEXITCODE -eq 2) {
        Add-Drift 'code-map' ("code-graph.json is stale - " + ($cg.Trim() -replace '\s+', ' ') + ". Rebuild: node scripts/code-index.js")
    }
}

# --- C29 hook liveness (P3.7, run-47 merged plan, 2026-08-23): every wired hook leaves a breadcrumb,
# and until now NOTHING asserted that the breadcrumbs keep arriving. A hook that silently stops
# firing is invisible for weeks: the voice hook already died quietly once (its own header records
# it), and the recall/capture hooks would fail exactly as quietly because both are fail-OPEN by
# design - which is correct for a prompt path and is precisely why their silence needs a separate
# watcher. Asserts each hook produced evidence inside its own window, sized to how often that hook
# can legitimately fire. NEVER-FIRED is reported in different words from WENT-QUIET (the C20/F-14
# rule): a hook wired today has no history yet, and saying "stale" would be a lie.
$hookProbes = @(
    @{ name = 'UserPromptSubmit/recall-inject';   path = 'system\recall\recall-metrics.jsonl';        days = 3 },
    @{ name = 'UserPromptSubmit/capture-typed';   path = "outputs\typed\transcripts\$(Get-Date -Format 'yyyy-MM-dd').md"; days = 3; todayOnly = $true },
    @{ name = 'PreCompact|SessionEnd|ToolFail';   path = 'system\lifecycle.jsonl';                    days = 14 }
)
foreach ($hp in $hookProbes) {
    $hpFull = Join-Path $repo $hp.path
    if (-not (Test-Path $hpFull)) {
        # Never-fired: state it as such. For the per-day transcript this is normal on a quiet day.
        if (-not $hp.todayOnly) {
            Add-Drift 'hook-liveness' "$($hp.name): no evidence file yet at $($hp.path) - NEVER FIRED (not stale). Expected once the hook runs for the first time; if it stays empty past a few sessions the wiring in .claude/settings.json is dead."
        }
        continue
    }
    $ageDays = ((Get-Date) - (Get-Item $hpFull).LastWriteTime).TotalDays
    if ($ageDays -gt $hp.days) {
        Add-Drift 'hook-liveness' "$($hp.name): last evidence $([math]::Round($ageDays,1))d ago in $($hp.path), window is $($hp.days)d - the hook went QUIET. Check .claude/settings.json wiring and the script's own log."
    }
}

# --- C28 user-scope skill inventory (P2.1, run-47 merged plan, 2026-08-23): `~/.claude/skills/` is
# entirely OUTSIDE skills-lock.json, the S7 hash sweep and every audit gate this repo owns. Those
# guard `.agents/skills/` (project scope) only. The run-47 assessment found the consequence live:
# graphify has sat at user scope since 2026-06-09, unpinned, unaudited, 113 releases stale, wired
# into every session by the global CLAUDE.md, self-installing a PyPI package from prose - and it was
# found by a human reading it in August, not by any mechanism. This inventory is the mechanism that
# would have surfaced it in June. AMBER + names the skill: appearing here is not an accusation, it
# is "this exists outside every baseline you have, decide about it".
$c28Baseline = Join-Path $stateDir 'user-skills-baseline.json'
$userSkillsDir = Join-Path $env:USERPROFILE '.claude\skills'
if (Test-Path $userSkillsDir) {
    $liveUser = @(Get-ChildItem $userSkillsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } | Sort-Object)
    if (Test-Path $c28Baseline) {
        $known = @()
        try { $known = @((Get-Content $c28Baseline -Raw | ConvertFrom-Json).skills) } catch { $known = @() }
        $newOnes = @($liveUser | Where-Object { $known -notcontains $_ })
        $goneOnes = @($known | Where-Object { $liveUser -notcontains $_ })
        if ($newOnes.Count) {
            Add-Drift 'user-skills' "user-scope skill(s) present but NOT baselined: $($newOnes -join ', ') - these live outside skills-lock.json, the S7 hash sweep and every audit gate; review, then re-run check.ps1 -Init to accept"
        }
        if ($goneOnes.Count) {
            Add-Drift 'user-skills' "baselined user-scope skill(s) now MISSING: $($goneOnes -join ', ') - a skill disappearing is as much a change as one arriving; re-run check.ps1 -Init if the removal was deliberate"
        }
    } else {
        Add-Drift 'user-skills' "no user-scope skill baseline yet ($($liveUser.Count) skill(s) in $userSkillsDir) - run check.ps1 -Init to record the accepted set"
    }
}

# --- C27 soul-core byte budget (P1.6, run-47 merged plan, 2026-08-23): the identity card is the one
# surface EVERY session and every scheduled run pays for, and its size was guarded by a builder WARN
# that shipped the oversized card anyway - the same dead-check-green shape as the backup's identity
# warning. The builder now trims the recency slice to manifest meta.vault.soul_core_byte_budget;
# this is the level-triggered proof that it worked. Over budget here means the trim hit the
# MIN_ENTRIES floor and could not get under, which is a real signal (his recent entries are long)
# and wants a human decision: raise the budget deliberately, or prune the corpus.
$scBudget = 0
try { $scBudget = [int]$manifest.meta.vault.soul_core_byte_budget } catch { $scBudget = 0 }
if ($scBudget -gt 0) {
    $scPath = Join-Path $repo 'soul-core.md'
    if (Test-Path $scPath) {
        $scLen = (Get-Item $scPath).Length
        if ($scLen -gt $scBudget) {
            Add-Drift 'soul-core-budget' "soul-core.md is $scLen B against the $scBudget B budget - the builder's trim hit its MIN_ENTRIES floor, so this needs a human call: raise meta.vault.soul_core_byte_budget deliberately, or prune the My Words corpus"
        }
    }
}

# --- C26 vault/log.md tail ordering (P1.5, run-47 merged plan, 2026-08-23): the activity log is
# described everywhere as append-only and time-ordered, and measured on 2026-08-23 it was neither -
# 276 of 1,107 adjacent heading pairs ran BACKWARDS, one entry was stamped in the future, and no
# script owned the file (run-46 finding N3). scripts/log-append.js is now the mechanical writer and
# refuses an out-of-order stamp; this check is the level-triggered backstop for anything written by
# hand or by a model. HISTORY IS BASELINED, NOT REPAIRED: the 276 existing inversions are what
# actually happened and rewriting them would be a lie, so only entries at or after the baseline date
# are asserted. AMBER, never RED: an ordering wobble is a hygiene problem, not a data-loss one.
$c26Baseline = ''
try { $c26Baseline = [string]$manifest.meta.vault.log_order_baseline } catch { $c26Baseline = '' }
if ($c26Baseline) {
    $logPath = Join-Path $repo 'vault\log.md'
    if (Test-Path $logPath) {
        $stamps = @([regex]::Matches((Get-Content $logPath -Raw), '(?m)^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]') |
                    ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ge $c26Baseline })
        $inversions = 0
        for ($i = 1; $i -lt $stamps.Count; $i++) { if ($stamps[$i] -lt $stamps[$i - 1]) { $inversions++ } }
        if ($inversions -gt 0) {
            Add-Drift 'log-order' "vault/log.md has $inversions out-of-order entry pair(s) at or after the $c26Baseline baseline - append through scripts/log-append.js (it refuses an older-than-tail stamp) instead of writing the file by hand"
        }
        # A stamp in the FUTURE is its own defect: it makes every later entry look out of order and
        # poisons any temporal join. Checked against local now + 5 min of clock slack.
        $future = @($stamps | Where-Object { $_ -gt (Get-Date).AddMinutes(5).ToString('yyyy-MM-dd HH:mm') })
        if ($future.Count) {
            Add-Drift 'log-order' "vault/log.md carries $($future.Count) future-stamped entr(ies) (newest: $($future[-1])) - a timestamp ahead of now cannot be trusted for ordering"
        }
    }
}

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
