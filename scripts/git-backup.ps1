# Daily git backup to GitHub (Recovery Phase 0, built 2026-07-02)
# Commits the whole tree (respecting .gitignore) and pushes to the PUBLIC
# alex-kiarash-ai/personal-os repo (public since 2026-07-16; .gitignore is the SOLE privacy barrier).
# On any failure: log + RED run_status push
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
    # --- P2.6 GUARDED STAGING (run-47 merged plan, 2026-08-23; closes run-46 finding N10) ----------
    # The default-deny .gitignore covers system/, work/*/state/, .bak, soul-*, vault/ and outputs/,
    # but a personal file dropped at a work/NN ROOT or into scripts/ falls in the residual positive
    # space, and an unattended `git add -A` at 21:30 sweeps it onto a PUBLIC repo. That is exactly the
    # class that burned on 2026-07-20 (four personal files public), and the barrier is one .gitignore
    # miss thick. So: before staging, every NEW untracked file in those two shapes is scanned; a hit
    # means NOTHING from that path is staged and the run reports AMBER naming it. A false positive
    # costs one file one day of backup, loudly. The alternative costs a permanently cacheable leak.
    # Reuses the SAME scanner and the SAME --staged mode the pre-commit hook runs, deliberately: a
    # second scanning path would be a second thing to keep correct. Stage, scan, then unstage only
    # the residual-risk shapes that were flagged.
    git add -A 2>&1 | Out-File -Append -Encoding utf8 $log
    if ($LASTEXITCODE -ne 0) { $reason = "git add failed (exit $LASTEXITCODE)" }

    $blockedPaths = @()
    if ($null -eq $reason) {
        $scanRaw = & node "scripts\personal-data-scan.js" --staged --json 2>&1 | Out-String
        try {
            $scan = $scanRaw | ConvertFrom-Json
            if (-not $scan.clean) {
                # Only the residual positive space is held back here. A hit anywhere ELSE is the
                # pre-commit hook's business (it fails closed on the whole staged set); this guard
                # exists for the two shapes no deny class covers.
                $blockedPaths = @($scan.hits | ForEach-Object { $_.file } | Sort-Object -Unique |
                                  Where-Object { $_ -match '^(work/[^/]+/[^/]+$|scripts/)' })
            }
        } catch { "personal-data guard: scan output unparseable, staging left as-is: $($scanRaw.Trim())" | Out-File -Append -Encoding utf8 $log }
    }
    if ($blockedPaths.Count) {
        # A blocked file must not hold the whole backup hostage: the rest of the day's work still
        # needs its off-machine copy tonight, so unstage only the flagged paths and say so loudly.
        foreach ($b in $blockedPaths) { git reset -q -- $b 2>&1 | Out-File -Append -Encoding utf8 $log }
        "AMBER personal-data guard: held back $($blockedPaths.Count) path(s): $($blockedPaths -join ', ') - review, then either gitignore them or move them out of the repo" | Out-File -Append -Encoding utf8 $log
    }

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
    # BUG-17 fix (2026-07-15): push the CURRENT branch, not a hardcoded 'main'. A commit on a feature
    # branch (e.g. context-engineering-*) never reached GitHub - `git push origin main` no-op'd (exit 0)
    # and reported GREEN while the day's work sat unpushed. Now the backup covers whatever branch is live.
    # cmd /c wrapper: PS 5.1 wraps native stderr in NativeCommandError records; cmd redirect keeps the log clean.
    $br = (git rev-parse --abbrev-ref HEAD 2>$null); if ($br) { $br = $br.Trim() } else { $br = 'main' }
    if ($null -eq $reason -and -not $DryRun) {
        cmd /c "git push origin $br 2>&1" | Out-File -Append -Encoding utf8 $log
        if ($LASTEXITCODE -ne 0) { $reason = "git push failed (exit $LASTEXITCODE, branch $br) - network or expired PAT?" }
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
                   headline = "backup pushed ($changed files changed, branch $br)"; status = 'green' } | ConvertTo-Json
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
