# security-sweep.ps1 - P5 (three-plan validation, 2026-07-17). Alex's monthly, zero-token, detect-never-
# repair SECURITY conscience, a sibling of check.ps1. Eight assertions (S1-S8). Exit 0 clean / 2 findings /
# 1 sweep-error (Terraform -detailed-exitcode convention, same as check.ps1). Own script so check.ps1's
# "no network except the HQ push" contract stays intact. Detect-only: it NEVER rotates, edits or repairs.
#
# Network stance (P5, deliberately LOUDER than the daily n8n watcher): a CONFIGURED live source that is
# unreachable is a sweep FAILURE (exit 1), never a silent green - at monthly cadence a skipped check is a
# month of blindness. A NOT-YET-CONFIGURED assertion (no baseline captured, tool not installed) is a
# SETUP-NEEDED finding (exit 2, amber) so first-run gaps surface without a false hard-fail.
#
# Run: powershell -File work/18-recovery-layer/security-sweep.ps1 [-DryRun]  (-DryRun skips the HQ push)
# Activation (queued for Shaheen): install gitleaks (S1), capture+review the Hetzner ss -tlnp baseline (S5),
# then register PersonalOS-security-sweep (monthly 1st Monday 07:20) + wire manifest/schedule.md. See
# work/18-recovery-layer/SECURITY-PLAYBOOK.md.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\security-sweep.log"
function Say($m) { "$m" | Out-File -Append -Encoding utf8 $log }
Say "=== security sweep $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

$findings = [System.Collections.Generic.List[object]]::new()
function Add-Finding($sev, $s, $msg) { $findings.Add([pscustomobject]@{ sev = $sev; s = $s; msg = $msg }) }  # sev: FINDING | SETUP
$sweepError = $null  # set to force exit 1 (a configured live source unreachable, or a thrown assertion)

function Push-HQ($status, $headline) {
    if ($DryRun) { Say "DryRun: skipping HQ push - $status - $headline"; return }
    $tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
    if (-not (Test-Path $tokenFile)) { return }
    try {
        $token = (Get-Content $tokenFile -Raw).Trim()
        $val = if ($status -eq 'green') { 1 } else { 0 }
        $body = @{ project = 'recovery'; metric_key = 'security_sweep'; value_num = $val; headline = $headline; status = $status } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        Say "HQ $status push sent"
    } catch { Say "HQ push failed: $($_.Exception.Message)" }
}

try {
    # --- S1 gitleaks over full history ------------------------------------------------------------
    # Resolve gitleaks like vault-backup.ps1 resolves gpg: PATH first, then the winget Packages location
    # (this package installs no Links shim, so Get-Command alone misses it under Task Scheduler).
    # gitleaks 8.19+ replaced `detect` with the `git` subcommand (history); the path is positional.
    $gitleaksExe = @(
        (Get-Command gitleaks -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
        (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gitleaks.Gitleaks_*\gitleaks.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
    ) | Where-Object { $_ } | Select-Object -First 1
    if ($gitleaksExe) {
        # gitleaks logs to stderr; under $ErrorActionPreference='Stop' a 2>&1 merge turns those lines into a
        # terminating NativeCommandError (PS 5.1 trap). Localize to Continue + quiet the INFO log so a CLEAN
        # scan does not false-throw. --exit-code 9 = leaks found; 0 = clean; anything else = a real gitleaks error.
        $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $glArgs = @('git', $repo, '--no-banner', '--exit-code', '9', '--log-level', 'error')
        $glCfg = Join-Path $repo '.gitleaks.toml'
        if (Test-Path $glCfg) { $glArgs += @('--config', $glCfg) }   # tuned allowlist for reviewed false positives
        $gl = (& $gitleaksExe @glArgs 2>&1 | Out-String)
        $glExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        if ($glExit -eq 9) { Add-Finding 'FINDING' 'S1' "gitleaks flagged secret(s) in history - see the log; on a PUBLIC repo the rule is ROTATE, do not rewrite (forks/caches remember). Detail:`n$gl" }
        elseif ($glExit -ne 0) { Add-Finding 'FINDING' 'S1' "gitleaks errored (exit $glExit): $gl" }
        else { Say "S1 gitleaks: clean" }
    } else {
        Add-Finding 'SETUP' 'S1' "gitleaks is not installed - install it (winget install Gitleaks.Gitleaks) + tune a committed baseline, then this becomes a live history scan. See SECURITY-PLAYBOOK.md."
    }

    # --- S2 no gitignored path is tracked (the V11 assertion, monthly backstop) --------------------
    $ignoredTracked = (& git ls-files --cached --ignored --exclude-standard 2>&1)
    if ($LASTEXITCODE -ne 0) { $sweepError = "S2: git ls-files failed: $ignoredTracked" }
    elseif ($ignoredTracked) {
        Add-Finding 'FINDING' 'S2' "gitignored path(s) are TRACKED (a forced 'git add -f'): $($ignoredTracked -join ', '). On the PUBLIC repo this PUBLISHES them. Fix: git rm --cached <path>. (Commit-time this is caught by validator V11; this monthly re-check catches a --no-verify window.)"
    } else { Say "S2 tracked-vs-ignored: clean (0 rows)" }

    # --- S3 credential-age ledger ------------------------------------------------------------------
    $ledgerPath = "system\credentials-ledger.json"
    if (-not (Test-Path $ledgerPath)) {
        Add-Finding 'SETUP' 'S3' "system/credentials-ledger.json is missing - the credential-age ledger. Recreate it (gitignored)."
    } else {
        $ledger = Get-Content $ledgerPath -Raw | ConvertFrom-Json
        foreach ($c in $ledger.credentials) {
            if ($c.id -eq 'vault-backup-gpg-passphrase') { Say "S3 $($c.id): defers to recovery check C14 (no date here)"; continue }
            if ($null -eq $c.max_age_days) { Say "S3 $($c.id): no age policy (max_age_days null)"; continue }
            if ($null -eq $c.last_rotated) {
                Add-Finding 'SETUP' 'S3' "credential '$($c.id)' has never recorded a last_rotated date (where: $($c.where)). Set it after confirming/rotating."
            } else {
                $lr = $null
                if ([datetime]::TryParseExact([string]$c.last_rotated, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$lr)) {
                    $age = [math]::Floor(((Get-Date) - $lr).TotalDays)
                    if ($age -gt $c.max_age_days) { Add-Finding 'FINDING' 'S3' "credential '$($c.id)' is ${age}d old (> $($c.max_age_days)d policy) - review/rotate, then update the ledger. Where: $($c.where)" }
                    else { Say "S3 $($c.id): ${age}d old (ok)" }
                } else {
                    Add-Finding 'FINDING' 'S3' "credential '$($c.id)' last_rotated '$($c.last_rotated)' is not a yyyy-MM-dd date."
                }
            }
        }
    }

    # --- S4 n8n version advisory (read the b30 deployed probe, NEVER prose) -------------------------
    $logFile = "system\landscape-log.jsonl"
    if (-not (Test-Path $logFile)) {
        Add-Finding 'SETUP' 'S4' "system/landscape-log.jsonl missing - cannot read the deployed n8n version probe."
    } else {
        # Parse-then-filter (NOT a raw-text regex): a deployed row can be written COMPACT by the node monitor
        # OR SPACE-formatted (Python json.dumps: "category": "deployed"). The old `-match '"category":"deployed"'`
        # silently dropped the spaced row, so S4 read stale 2.21.7 for days (error-log 2026-07-18). ConvertFrom-Json
        # parses both; filter on the .category property, and read UTF8 so the middle-dot rows never mojibake.
        $deployed = Get-Content $logFile -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } |
            Where-Object { $_ -and $_.category -eq 'deployed' -and $_.extra.n8n_version }
        $latest = $deployed | Sort-Object date | Select-Object -Last 1
        if (-not $latest) {
            Add-Finding 'SETUP' 'S4' "no 'deployed' probe row carries an n8n_version - the b30 self-probe has not logged one."
        } else {
            $probeAge = [math]::Floor(((Get-Date) - [datetime]$latest.date).TotalDays)
            Say "S4 deployed n8n version (from probe, $($latest.date)): $($latest.extra.n8n_version)"
            if ($probeAge -gt 45) {
                Add-Finding 'FINDING' 'S4' "the deployed-version probe is ${probeAge}d stale (last row $($latest.date), n8n $($latest.extra.n8n_version)). Either the box was not recreated or the probe's ssh half is failing. Verify the LIVE box version + fix the probe. NOTE: the constitution claims a newer version - do NOT trust prose over the probe."
            }
            # advisory comparison: no machine-readable n8n advisory source is wired yet (AL-2).
            Add-Finding 'SETUP' 'S4' "no machine-readable n8n security-advisory source is wired (AL-2). Version-vs-advisory is manual for now: check github.com/n8n-io/n8n security advisories against deployed $($latest.extra.n8n_version). A hit -> a human-actions row, never an auto-update."
        }
    }

    # --- S5 Hetzner exposed ports ------------------------------------------------------------------
    $portBaseline = "work\18-recovery-layer\baselines\hetzner-ports.json"
    if (-not (Test-Path $portBaseline)) {
        Add-Finding 'SETUP' 'S5' "no committed port baseline ($portBaseline). Capture it: ssh n8n 'ss -tlnp' (expect docker-proxy bindings for n8n/Gotenberg/HQ/Caddy + SSH), Shaheen reviews, then save the reviewed set. SSH is key-only-as-root; the b30 probe proves non-interactive exec daily (F12)."
    } else {
        # Baseline exists: compare against live ss -tlnp. A configured-but-unreachable box is a LOUD failure.
        try {
            $live = (& ssh n8n "ss -tlnp" 2>&1 | Out-String)
            if ($LASTEXITCODE -ne 0) { $sweepError = "S5: ssh to the box failed (exit $LASTEXITCODE) - configured live source unreachable: $live" }
            else {
                $baseline = Get-Content $portBaseline -Raw | ConvertFrom-Json
                # Deterministic compare left to the baseline's declared listener set (built at S5 capture time).
                Say "S5 ports: live ss captured; compare against baseline ($($baseline.listeners.Count) declared)."
                # (Comparison detail is filled at S5 baseline-capture build, per the plan's refuses-to-specify.)
            }
        } catch { $sweepError = "S5: ssh port check threw: $($_.Exception.Message)" }
    }

    # --- S6 instance-MCP connected clients (activates after P2) -------------------------------------
    $mcpBaseline = "work\18-recovery-layer\baselines\mcp-clients.json"
    if (-not (Test-Path $mcpBaseline)) {
        Add-Finding 'SETUP' 'S6' "no MCP connected-clients baseline ($mcpBaseline) - written by the Chat Gateway Phase 2.0 gate test (P2 not built yet). Until then, monthly MCP-client drift is unmonitored (the DAILY n8n-active-check owns same-day toggle flips)."
    } else {
        Say "S6 mcp-clients: baseline present - compare against the instance MCP declaration (P2 build fills the live read)."
    }

    # --- S7 installed skills match skills-lock.json (S7 step-1 re-baseline shipped 2026-07-17) -------
    $lockPath = "skills-lock.json"
    if (-not (Test-Path $lockPath)) {
        Add-Finding 'FINDING' 'S7' "skills-lock.json missing - the reproducibility/tamper baseline is gone."
    } else {
        $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
        $mismatch = 0; $checked = 0
        foreach ($name in ($lock.skills | Get-Member -MemberType NoteProperty).Name) {
            $entry = $lock.skills.$name
            $file = Join-Path $repo ".agents\skills\$name\SKILL.md"
            if (-not (Test-Path $file)) { Add-Finding 'FINDING' 'S7' "skill '$name' in the lock but .agents/skills/$name/SKILL.md is MISSING on disk."; $mismatch++; continue }
            $h = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
            $checked++
            if ($entry.computedHash -and ($h -ne $entry.computedHash.ToLower())) {
                Add-Finding 'FINDING' 'S7' "skill '$name' SKILL.md hash ($($h.Substring(0,12))..) != lock ($($entry.computedHash.Substring(0,12))..) - review the diff (script-free markdown edit vs tamper), then re-baseline."
                $mismatch++
            }
        }
        Say "S7 skills-hash: $checked checked, $mismatch mismatch(es)"
        # skills-sources.json integrity: hash vs a recorded value (recorded on first clean run below).
        $srcCfg = "system\skills-sources.json"
        $srcRecord = "work\18-recovery-layer\state\skills-sources.sha256"
        if (Test-Path $srcCfg) {
            $srcHash = (Get-FileHash $srcCfg -Algorithm SHA256).Hash.ToLower()
            if (Test-Path $srcRecord) {
                $rec = (Get-Content $srcRecord -Raw).Trim().ToLower()
                if ($rec -and $rec -ne $srcHash) { Add-Finding 'FINDING' 'S7' "system/skills-sources.json changed since last record (hash $($srcHash.Substring(0,12)).. != $($rec.Substring(0,12))..). If deliberate, refresh work/18-recovery-layer/state/skills-sources.sha256." }
                else { Say "S7 skills-sources.json: matches recorded hash" }
            } else {
                New-Item -ItemType Directory -Force (Split-Path $srcRecord) | Out-Null
                Set-Content -Path $srcRecord -Value $srcHash -Encoding ascii
                Say "S7 skills-sources.json: first run - recorded baseline hash"
            }
        }
    }

    # --- S8 repo visibility matches declaration ----------------------------------------------------
    $manifest = Get-Content "system\manifest.json" -Raw | ConvertFrom-Json
    $declared = if ($manifest.meta.repo_visibility) { [string]$manifest.meta.repo_visibility } else { 'public' }
    try {
        $api = Invoke-RestMethod -Uri 'https://api.github.com/repos/alex-kiarash-ai/personal-os' -Headers @{ 'User-Agent' = 'alex-security-sweep' } -TimeoutSec 15
        $live = if ($api.visibility) { [string]$api.visibility } else { if ($api.private) { 'private' } else { 'public' } }
        if ($live -ne $declared) { Add-Finding 'FINDING' 'S8' "repo visibility LIVE='$live' but DECLARED='$declared' (manifest.meta.repo_visibility). If the flip was intentional, update the declaration; if not, this is a privacy event - on a public flip, .gitignore is the SOLE barrier (rotate anything ever committed)." }
        else { Say "S8 visibility: live '$live' == declared '$declared'" }
    } catch {
        $sweepError = "S8: GitHub visibility read failed (configured live source unreachable): $($_.Exception.Message)"
    }
}
catch {
    $sweepError = "SWEEP THREW: $($_.Exception.Message)"
}

# ---------------------------------------------------------------- report
$nFind = @($findings | Where-Object { $_.sev -eq 'FINDING' }).Count   # @() so .Count is always an int (0/1/2), never $null - the green/amber/red verdict depends on it
$nSetup = @($findings | Where-Object { $_.sev -eq 'SETUP' }).Count
Say "--- result: $nFind finding(s), $nSetup setup-needed, error=$([bool]$sweepError) ---"
foreach ($f in $findings) { Say ("  [{0} {1}] {2}" -f $f.sev, $f.s, $f.msg) }

New-Item -ItemType Directory -Force "vault\projects\recovery" | Out-Null
$report = "vault\projects\recovery\last-security-sweep.md"
$lines = @("# Last security sweep - $(Get-Date -Format 'yyyy-MM-dd HH:mm')", "", "$nFind finding(s), $nSetup setup-needed, sweep-error=$([bool]$sweepError).", "")
foreach ($f in $findings) { $lines += "- **$($f.s) [$($f.sev)]** $($f.msg)" }
if ($sweepError) { $lines += ""; $lines += "**SWEEP ERROR (exit 1):** $sweepError" }
$lines | Out-File -Encoding utf8 $report

if ($sweepError) {
    Push-HQ 'red' "security sweep FAILED: $sweepError"
    Write-Output "security sweep ERROR (exit 1): $sweepError"
    exit 1
} elseif ($nFind -gt 0 -or $nSetup -gt 0) {
    $head = "$nFind finding(s) + $nSetup setup-needed"
    Push-HQ 'amber' "security sweep: $head"
    Write-Output "security sweep: $head (exit 2)"
    exit 2
} else {
    Push-HQ 'green' "security sweep: clean"
    Write-Output "security sweep: clean (exit 0)"
    exit 0
}
