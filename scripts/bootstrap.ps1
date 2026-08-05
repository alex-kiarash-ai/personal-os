# bootstrap.ps1 - the machine-rebuild doctor (2026-08-05, enterprise-assessment idea 6,
# vault/research/enterprise-assessment-ideas.md).
#
# WHY: the restore story covered the DATA (git clone + the encrypted vault tar, both drilled) but a
# new machine's ENVIRONMENT was archaeology across identity.md, recovery docs and memory. This makes
# it a checklist a machine runs: every outside-repo dependency is declared in
# system/environment-schema.json (tracked, no secret paths) and this script proves each one present.
#
# DOCTOR, NOT INSTALLER. It reports and it repairs exactly ONE thing (-RepairJunctions, safe +
# idempotent). It never installs tools, never creates scheduler jobs (/cron-setup owns those), never
# reads a secret VALUE (existence of the ledger's file-type entries only).
#
# Usage:  powershell -File scripts/bootstrap.ps1                 # doctor: report PASS/MISS/OPT
#         powershell -File scripts/bootstrap.ps1 -RepairJunctions # + recreate missing skill junctions
# Exit:   0 = every REQUIRED item present · 2 = something required is missing · 1 = script error
# Log:    outputs/logs/bootstrap-check.log (gitignored)

param([switch]$RepairJunctions)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$logFile = "outputs\logs\bootstrap-check.log"
"=== bootstrap check $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $logFile

$script:missRequired = 0
function Report($state, $section, $name, $detail) {
    $line = "[{0}] {1,-14} {2,-28} {3}" -f $state, $section, $name, $detail
    Write-Output $line
    $line | Out-File -Append -Encoding utf8 $logFile
    if ($state -eq 'MISS') { $script:missRequired++ }
}

try {
    $schema = Get-Content "system\environment-schema.json" -Raw | ConvertFrom-Json

    # --- 1. tools -------------------------------------------------------------------------------
    foreach ($t in $schema.tools) {
        $cmd = Get-Command $t.id -ErrorAction SilentlyContinue
        $exe = if ($cmd) { $cmd.Source } else { $null }
        if (-not $exe -and $t.fallback_paths) {
            # some tools live off-PATH by design (gpg rides Git's bundle; vault-backup.ps1 resolves
            # the same list in the same order) - probe exactly what production probes.
            $exe = @($t.fallback_paths) | Where-Object { Test-Path $_ } | Select-Object -First 1
        }
        if (-not $exe) {
            Report ($(if ($t.required) { 'MISS' } else { 'OPT ' })) 'tool' $t.id "absent - restore: $($t.restore)"
            continue
        }
        $ver = ''
        if ($t.version_args) { try { $ver = ((& $exe $t.version_args.Split(' ') 2>$null) | Select-Object -First 1) } catch {} }
        if ($t.id -eq 'node' -and $t.min_major -and $ver -match 'v(\d+)') {
            if ([int]$Matches[1] -lt $t.min_major) { Report 'MISS' 'tool' $t.id "$ver but need >= v$($t.min_major) (node:sqlite)"; continue }
        }
        Report 'PASS' 'tool' $t.id ($(if ($ver) { $ver } else { $exe }))
    }

    # --- 2. npm globals + python packages -------------------------------------------------------
    foreach ($g in $schema.npm_globals) {
        $ok = $false
        try { $null = npm ls -g --depth=0 $g.id 2>$null; $ok = ($LASTEXITCODE -eq 0) } catch {}
        Report ($(if ($ok) { 'PASS' } elseif ($g.required) { 'MISS' } else { 'OPT ' })) 'npm-global' $g.id ($(if ($ok) { 'installed' } else { "absent - npm install -g $($g.id)" }))
    }
    foreach ($p in $schema.python_packages) {
        $ok = $false
        try { python -c "import $($p.id)" 2>$null; $ok = ($LASTEXITCODE -eq 0) } catch {}
        Report ($(if ($ok) { 'PASS' } elseif ($p.required) { 'MISS' } else { 'OPT ' })) 'py-package' $p.pip_name ($(if ($ok) { 'imports' } else { "absent - pip install $($p.pip_name)" }))
    }

    # --- 3. secret files (existence only, from the gitignored ledger) ---------------------------
    $ledgerPath = "system\credentials-ledger.json"
    if (-not (Test-Path $ledgerPath)) {
        Report 'MISS' 'secrets' 'credentials-ledger' 'system/credentials-ledger.json ABSENT - restore the encrypted vault backup FIRST (vault-backup-plan)'
    } else {
        $ledger = Get-Content $ledgerPath -Raw | ConvertFrom-Json
        foreach ($c in $ledger.credentials) {
            $p = $null
            if ($c.local_path) { $p = [Environment]::ExpandEnvironmentVariables($c.local_path) }
            elseif ($c.where -match '^([\w./\\-]+\.(txt|json|pass))\b') { $p = $Matches[1] }
            if ($null -eq $p) { Report 'INFO' 'secrets' $c.id 'not file-backed (password manager / n8n credential / OS keyring) - nothing to check here'; continue }
            if (Test-Path $p) { Report 'PASS' 'secrets' $c.id 'file present (value not read)' }
            else { Report 'MISS' 'secrets' $c.id "expected file absent: $p" }
        }
    }

    # --- 4. scheduler jobs (manifest = source of truth; /cron-setup recreates) ------------------
    $manifest = Get-Content "system\manifest.json" -Raw | ConvertFrom-Json
    $declared = @(foreach ($proj in $manifest.projects) { $proj.schedule_jobs }) | Where-Object { $_ }
    $live = @(Get-ScheduledTask -TaskName 'PersonalOS-*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName)
    $missingJobs = @($declared | Where-Object { $live -notcontains $_ })
    if ($missingJobs.Count -eq 0) { Report 'PASS' 'scheduler' 'PersonalOS-* jobs' "$($declared.Count) declared, all registered" }
    else { Report 'MISS' 'scheduler' 'PersonalOS-* jobs' "$($missingJobs.Count) of $($declared.Count) missing (recreate via /cron-setup): $($missingJobs -join ', ')" }

    # --- 5. skill junctions (.agents/skills -> .claude/skills) ----------------------------------
    $jr = $schema.junction_rule
    $targets = @(Get-ChildItem $jr.target_dir -Directory -ErrorAction SilentlyContinue)
    $broken = @()
    foreach ($d in $targets) {
        $link = Join-Path $jr.link_dir $d.Name
        if (-not (Test-Path $link)) { $broken += $d }
    }
    if ($broken.Count -eq 0) {
        Report 'PASS' 'junctions' 'skill store' "$($targets.Count) skills, all linked"
    } elseif ($RepairJunctions) {
        $fixed = 0
        foreach ($d in $broken) {
            $link = Join-Path $jr.link_dir $d.Name
            cmd /c mklink /J "$link" "$($d.FullName)" | Out-Null
            if (Test-Path $link) { $fixed++ }
        }
        $stillBroken = $broken.Count - $fixed
        if ($stillBroken -eq 0) { Report 'PASS' 'junctions' 'skill store' "repaired $fixed missing junction(s), all $($targets.Count) linked now" }
        else { Report 'MISS' 'junctions' 'skill store' "repair left $stillBroken of $($broken.Count) still missing" }
    } else {
        Report 'MISS' 'junctions' 'skill store' "$($broken.Count) of $($targets.Count) junctions missing - run bootstrap.ps1 -RepairJunctions"
    }

    # --- 6. ssh alias ---------------------------------------------------------------------------
    $sshCfg = Join-Path $env:USERPROFILE ".ssh\config"
    foreach ($s in $schema.ssh) {
        $ok = (Test-Path $sshCfg) -and ((Get-Content $sshCfg -Raw) -match "(?im)^\s*Host\s+.*\b$([regex]::Escape($s.alias))\b")
        Report ($(if ($ok) { 'PASS' } else { 'MISS' })) 'ssh' "alias '$($s.alias)'" ($(if ($ok) { 'in ~/.ssh/config' } else { "absent from ~/.ssh/config - $($s.note)" }))
    }

    # --- 7. claude settings (identity.md section 4: re-apply after restore) ---------------------
    $cs = $schema.claude_settings
    $csPath = Join-Path $env:USERPROFILE ".claude\settings.json"
    if (-not (Test-Path $csPath)) {
        Report 'MISS' 'claude-cfg' 'settings.json' "~/.claude/settings.json absent"
    } else {
        $cfg = Get-Content $csPath -Raw | ConvertFrom-Json
        foreach ($k in $cs.expect_keys) {
            $has = $null -ne $cfg.PSObject.Properties[$k]
            Report ($(if ($has) { 'PASS' } else { 'MISS' })) 'claude-cfg' $k ($(if ($has) { 'set' } else { 'missing (identity.md section 4)' }))
        }
        foreach ($e in $cs.expect_env.PSObject.Properties) {
            $val = if ($cfg.env) { $cfg.env.PSObject.Properties[$e.Name] } else { $null }
            $ok = $val -and ($val.Value -eq $e.Value)
            Report ($(if ($ok) { 'PASS' } else { 'MISS' })) 'claude-cfg' $e.Name ($(if ($ok) { "= $($e.Value)" } else { "expected $($e.Value) (identity.md section 4)" }))
        }
    }

    # --- 8. git expectations --------------------------------------------------------------------
    $ge = $schema.git_expectations
    $remoteOk = $false
    try { $null = git remote get-url $ge.remote 2>$null; $remoteOk = ($LASTEXITCODE -eq 0) } catch {}
    Report ($(if ($remoteOk) { 'PASS' } else { 'MISS' })) 'git' "remote '$($ge.remote)'" ($(if ($remoteOk) { 'configured' } else { 'absent (clone from GitHub or re-add)' }))
    $lp = ''
    try { $lp = (git config --get core.longpaths 2>$null) } catch {}
    Report ($(if ($lp -eq 'true') { 'PASS' } else { 'MISS' })) 'git' 'core.longpaths' ($(if ($lp -eq 'true') { 'true' } else { "not 'true' - restore doc requires it on Windows" }))

    # --- verdict --------------------------------------------------------------------------------
    Write-Output ''
    if ($script:missRequired -eq 0) {
        $msg = "bootstrap: environment COMPLETE (0 required items missing)"
        Write-Output $msg; $msg | Out-File -Append -Encoding utf8 $logFile
        exit 0
    } else {
        $msg = "bootstrap: $($script:missRequired) required item(s) MISSING - see MISS lines above"
        Write-Output $msg; $msg | Out-File -Append -Encoding utf8 $logFile
        exit 2
    }
} catch {
    $msg = "BOOTSTRAP SCRIPT ERROR: $($_.Exception.Message) at $($_.InvocationInfo.PositionMessage)"
    Write-Output $msg; $msg | Out-File -Append -Encoding utf8 $logFile
    exit 1
}
