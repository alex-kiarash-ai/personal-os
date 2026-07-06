# Daily git backup to GitHub (Recovery Phase 0, built 2026-07-02)
# Commits the whole tree (respecting .gitignore) and pushes to the private
# alex-kiarash-ai/personal-os repo. On any failure: log + RED run_status push
# to Alex HQ so a dead backup is never silent. Success pushes GREEN.
# Plan + runbook: vault/projects/recovery/github-backup-plan.md
param([switch]$DryRun)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\git-backup.log"

"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

$reason = $null
$changed = 0
try {
    git add -A 2>&1 | Out-File -Append -Encoding utf8 $log
    if ($LASTEXITCODE -ne 0) { $reason = "git add failed (exit $LASTEXITCODE)" }

    if ($null -eq $reason) {
        $staged = git diff --cached --name-only
        $changed = ($staged | Measure-Object).Count
        if ($changed -gt 0) {
            $msg = "Daily backup $(Get-Date -Format 'yyyy-MM-dd HH:mm') ($changed files)"
            if ($DryRun) {
                "DRYRUN: would commit '$msg'" | Out-File -Append -Encoding utf8 $log
            } else {
                git commit -m $msg 2>&1 | Out-File -Append -Encoding utf8 $log
                if ($LASTEXITCODE -ne 0) { $reason = "git commit failed (exit $LASTEXITCODE)" }
            }
        } else {
            "no changes to commit" | Out-File -Append -Encoding utf8 $log
        }
    }

    # Push even on no-change days: recovers from a previously failed push.
    # cmd /c wrapper: PS 5.1 wraps native stderr in NativeCommandError records; cmd redirect keeps the log clean.
    if ($null -eq $reason -and -not $DryRun) {
        cmd /c "git push origin main 2>&1" | Out-File -Append -Encoding utf8 $log
        if ($LASTEXITCODE -ne 0) { $reason = "git push failed (exit $LASTEXITCODE) - network or expired PAT?" }
    }
} catch {
    $reason = "wrapper exception: $($_.Exception.Message)"
}

# --- Alex HQ push (build #16 contract). Never log the token; never let the push crash the wrapper. ---
$tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
if (Test-Path $tokenFile) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    if ($null -eq $reason) {
        $body = @{ project = 'recovery'; metric_key = 'run_status'; value_num = 1
                   headline = "backup pushed ($changed files changed)"; status = 'green' } | ConvertTo-Json
    } else {
        $body = @{ project = 'recovery'; metric_key = 'run_status'; value_num = 0
                   headline = "backup FAILED: $reason"; status = 'red' } | ConvertTo-Json
    }
    if (-not $DryRun) {
        try {
            Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' `
                -Body $body -TimeoutSec 10 | Out-Null
            "HQ push sent" | Out-File -Append -Encoding utf8 $log
        } catch {
            "HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log
        }
    }
} else {
    "HQ push skipped: token file missing" | Out-File -Append -Encoding utf8 $log
}

if ($null -eq $reason) {
    "OK ($changed files)" | Out-File -Append -Encoding utf8 $log
    exit 0
}
"FAILED: $reason" | Out-File -Append -Encoding utf8 $log
exit 1
