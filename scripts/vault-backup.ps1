# Encrypted local-only backup (Recovery Phase 1, built 2026-07-04)
# The git backup only covers the FUNCTIONAL system (code + how-it-works docs).
# The PRIVACY SCRUB (2026-07-04) keeps the vault, soul.md, CV/financial data,
# secrets and workflow exports LOCAL-ONLY -> they had no off-machine copy.
# This job fills that gap: tar everything git IGNORES (minus regenerable junk),
# gpg-symmetric-encrypt it (AES256), and ship the single .gpg blob to the
# Hetzner box. On any failure: log + RED run_status to Alex HQ (never silent).
# The include set is DERIVED FROM .gitignore, so it can't drift from what's local.
# Passphrase file: its path is read from the gitignored credentials ledger
#   (system/credentials-ledger.json, id=vault-backup-gpg-passphrase, local_path) - NOT hardcoded here,
#   so this tracked/public script never names the local secret path (F-04, 2026-07-21).
#   >>> The SAME passphrase must also live in Shaheen's password manager, or an
#       off-machine .gpg is unrecoverable if this ThinkPad dies. <<<
# Runbook: vault/projects/recovery/vault-backup-plan.md
param([switch]$DryRun)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = "C:\Users\Thinkpad\Desktop\personal-os"
Set-Location $repo
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\vault-backup.log"
function Say($m) { "$m" | Out-File -Append -Encoding utf8 $log }
Say "=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')$(if($DryRun){' (DRYRUN)'}) ==="

# Resolve gpg (Git-bundled on this box; not on the PowerShell PATH)
$gpg = @("C:\Program Files\Git\usr\bin\gpg.exe","C:\Program Files (x86)\GnuPG\bin\gpg.exe") |
       Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $gpg) { $c = Get-Command gpg -ErrorAction SilentlyContinue; if ($c) { $gpg = $c.Source } }

# F-04 (2026-07-21): the concrete passphrase-file path lives ONLY in the gitignored credentials
# ledger (id=vault-backup-gpg-passphrase, local_path), never hardcoded in this tracked/public script.
# Resolved here to $null if unavailable; the try-block below throws + RED-pushes if it stays unresolved.
$passFile = $null
$__ledger = Join-Path $repo 'system\credentials-ledger.json'
if (Test-Path $__ledger) {
    try {
        $__pe = (Get-Content $__ledger -Raw | ConvertFrom-Json).credentials | Where-Object { $_.id -eq 'vault-backup-gpg-passphrase' } | Select-Object -First 1
        if ($__pe -and $__pe.local_path) { $passFile = [Environment]::ExpandEnvironmentVariables($__pe.local_path) }
    } catch { }
}
$stamp   = Get-Date -Format 'yyyyMMdd-HHmm'
$tmp     = Join-Path $env:TEMP "alex-vault-$stamp-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$tarFile = "$tmp.tar"
$gpgFile = "$tmp.tar.gpg"
$vrfFile = "$tmp.verify.tar"
$remoteName = "vault-$stamp.tar.gpg"
$KEEP = 14

$reason = $null
$sizeMB = 0

# 0. Outputs-ledger nightly self-heal (2026-07-11, the amended-Ledger build): append skeleton
#    rows for any deliverable that missed its Close-Out A6 append, re-render INDEX. Best-effort:
#    a ledger failure must NEVER block the backup (the ledger is regenerable, the backup is not).
try {
    $lg = node "scripts\outputs-ledger.js" reconcile 2>&1
    Say "ledger: $($lg | Select-Object -First 1)"
} catch { Say "ledger reconcile failed (non-fatal): $($_.Exception.Message)" }

# 0b. Outcome loop nightly aggregate (2026-07-20, agent-architecture decision run item 6.3):
#     re-tally the application outcome table -> winners.json + report-section.md + the built-ready
#     writer block. DETERMINISTIC, zero Claude calls, degrades to "accumulating" on an empty table.
#     Best-effort like the ledger: it must NEVER block the backup (both are regenerable).
try {
    $ol = node "scripts\alex-outcome-loop.js" 2>&1
    Say "outcome-loop: $($ol | Select-Object -First 1)"
} catch { Say "outcome-loop aggregate failed (non-fatal): $($_.Exception.Message)" }

# 0c. Content outcome loop nightly aggregate (2026-07-20, Content Agent build): the content twin of
#     0b - re-tally the Building Alex posts table -> winners.json + report-section.md + the drafter
#     block. DETERMINISTIC, zero Claude calls, degrades to "accumulating" on an empty table. Same
#     best-effort contract: it must NEVER block the backup.
try {
    $cl = node "scripts\alex-content-loop.js" 2>&1
    Say "content-loop: $($cl | Select-Object -First 1)"
} catch { Say "content-loop aggregate failed (non-fatal): $($_.Exception.Message)" }

# BUG-11 fix (2026-07-15): on a month-end night the expense (20:00, 2h limit) + runway (21:15) jobs can
# still be writing their Excel workbooks to outputs/ when this 21:45 tar runs, so the backup could capture
# a half-written .xlsx. Wait (bounded) for those month-end producers to finish before taring; proceed
# anyway after a 12-min cap so the backup window is never blown.
if (-not $DryRun) {
    $waited = 0
    while ($waited -lt 720) {
        $busy = Get-ScheduledTask -TaskName 'PersonalOS-expense-wrangler', 'PersonalOS-runway' -ErrorAction SilentlyContinue |
                Where-Object { $_.State -eq 'Running' }
        if (-not $busy) { break }
        Say "waiting for month-end producer(s) before taring: $(($busy | ForEach-Object { $_.TaskName }) -join ', ') (${waited}s)"
        Start-Sleep -Seconds 60; $waited += 60
    }
    if ($waited -ge 720) { Say "proceeded after the 12-min wait cap (a month-end producer was still running); backup may catch a mid-write file this once" }
}

try {
    if (-not $gpg)               { throw "gpg not found (install Gpg4win or use the Git-bundled gpg)" }
    if (-not $passFile)          { throw "passphrase path not configured in system/credentials-ledger.json (id=vault-backup-gpg-passphrase, field local_path)" }
    if (-not (Test-Path $passFile)) { throw "passphrase file missing at the ledger-configured path" }

    # 1. Build the include set from .gitignore (ignored files/dirs, dirs collapsed),
    #    minus regenerable build/runtime junk. This IS the local-only surface.
    $ignored = git ls-files --others --ignored --exclude-standard --directory 2>$null
    $junk = '(^|/)(node_modules|\.next|venv|__pycache__|outputs|\.browser-profile|\.obsidian)/|\.(pyc|log|tmp|lock)$|/\.pbi/|(^|/)\.DS_Store$|next-env\.d\.ts$'
    # TrimEnd('/'): bsdtar's -T rejects directory entries that carry a trailing slash.
    $list = $ignored | Where-Object { $_ -and ($_ -notmatch $junk) -and (Test-Path $_) } | ForEach-Object { $_.TrimEnd('/') }
    # Irreplaceable outputs (audit step 7, 2026-07-06): deliverables that exist nowhere else
    # (PBIP dashboard, monthly workbooks, final reports). outputs/ stays excluded as a class;
    # only these named folders ride along.
    # weekly-exec-report added 2026-07-11: #10 writes there going forward (reports/ frozen as legacy).
    # ledger.jsonl added same day: hand-written desc rows are not regenerable (skeleton rows are).
    $keepOutputs = @('outputs/alex-costs','outputs/reports','outputs/runway','outputs/expense-wrangler',
                     'outputs/weekly-exec-report','outputs/ledger.jsonl') |
                   Where-Object { Test-Path $_ }
    $list = @($list) + @($keepOutputs)
    $n = ($list | Measure-Object).Count
    if ($n -lt 5) { throw "include list too small ($n paths) - refusing to ship a thin backup" }
    Say "include: $n paths"
    $listFile = "$tmp.list"
    # UTF-8 no BOM, LF endings: bsdtar -T treats a trailing \r as part of the path.
    [IO.File]::WriteAllText($listFile, (($list -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))

    if ($DryRun) {
        Say "DRYRUN: would tar $n paths -> gpg -> scp $remoteName to n8n:/opt/alex-backups (keep $KEEP)"
        "DRYRUN ok: $n paths staged" | Out-File -Append -Encoding utf8 $log
    } else {
        # 2. tar (relative to repo root) then encrypt. Plaintext tar is deleted in finally.
        tar -cf $tarFile --exclude='*/.obsidian' --exclude='*/node_modules' --exclude='*/.browser-profile' --exclude='*/.git' -T $listFile 2>&1 | Out-File -Append -Encoding utf8 $log
        if (-not (Test-Path $tarFile)) { throw "tar produced no archive" }

        & $gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --compress-algo 2 `
               --passphrase-file $passFile -o $gpgFile $tarFile 2>&1 | Out-File -Append -Encoding utf8 $log
        if (-not (Test-Path $gpgFile)) { throw "gpg produced no output" }
        $sizeMB = [math]::Round((Get-Item $gpgFile).Length / 1MB, 1)
        if ((Get-Item $gpgFile).Length -lt 100KB) { throw "encrypted blob suspiciously small ($sizeMB MB)" }

        # 3. Round-trip verify BEFORE shipping: decrypt + list entries. Never ship a blob we can't open.
        & $gpg --batch --yes --quiet --passphrase-file $passFile -d -o $vrfFile $gpgFile 2>&1 | Out-File -Append -Encoding utf8 $log
        $entries = (tar -tf $vrfFile 2>$null | Measure-Object -Line).Lines
        if ($entries -lt 50) { throw "verify failed: only $entries entries decrypted" }
        Say "verified: decrypts clean, $entries entries, $sizeMB MB"

        # 4. Ship to Hetzner + confirm remote size + prune to last $KEEP.
        scp -o BatchMode=yes $gpgFile "n8n:/opt/alex-backups/$remoteName" 2>&1 | Out-File -Append -Encoding utf8 $log
        if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE) - network or SSH key?" }
        $remoteSize = (ssh -o BatchMode=yes n8n "stat -c%s /opt/alex-backups/$remoteName" 2>$null)
        if (-not $remoteSize -or [int64]$remoteSize -lt 100000) { throw "remote file missing/truncated ($remoteSize bytes)" }
        ssh -o BatchMode=yes n8n "cd /opt/alex-backups && ls -1t vault-*.tar.gpg 2>/dev/null | tail -n +$($KEEP+1) | xargs -r rm -f" 2>&1 | Out-File -Append -Encoding utf8 $log
        $kept = (ssh -o BatchMode=yes n8n "ls -1 /opt/alex-backups/vault-*.tar.gpg 2>/dev/null | wc -l").Trim()
        Say "shipped: $remoteName ($remoteSize bytes remote), $kept kept on box"
    }
} catch {
    $reason = $_.Exception.Message
} finally {
    # ALWAYS shred the plaintext (tar + decrypted verify copy) and the local .gpg/list.
    foreach ($f in @($tarFile,$vrfFile,$gpgFile,"$tmp.list")) {
        if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
    }
}

# --- Alex HQ push (build #16 contract). Distinct metric_key from git-backup's run_status. ---
$tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
if ((Test-Path $tokenFile) -and -not $DryRun) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    if ($null -eq $reason) {
        $body = @{ project='recovery'; metric_key='vault_backup'; value_num=1
                   headline="vault encrypted -> Hetzner ($sizeMB MB)"; status='green' } | ConvertTo-Json
    } else {
        $body = @{ project='recovery'; metric_key='vault_backup'; value_num=0
                   headline="vault backup FAILED: $reason"; status='red' } | ConvertTo-Json
    }
    try {
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token'=$token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        Say "HQ push sent"
    } catch { Say "HQ push failed: $($_.Exception.Message)" }
}

if ($null -eq $reason) { Say "OK ($sizeMB MB)"; exit 0 }
Say "FAILED: $reason"; exit 1
