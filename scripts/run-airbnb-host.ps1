# Airbnb Host scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\airbnb-host.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip this slot as visible-PARTIAL
if (-not (Test-AlexQuotaGate -Log $log -Project 'airbnb')) { exit 0 }

# Deterministic first (write-first discipline): harvest, THEN rebuild the model.
# --headless is REQUIRED for the scheduled/unattended run (fix 2026-07-14): a HEADED launch has no
# desktop to render into under Task Scheduler and hangs to a 180s launch timeout (that was the real
# 2026-06-24 failure, NOT an expired login - the session was still valid). Headless reuses the same
# persistent .browser-profile session and works read-only (verified 2026-07-14: logged-in, 38 rows).
# Manual/on-demand runs stay HEADED per RUNBOOK.md (lower bot-detection risk when Shaheen is watching).
python "work\13-airbnb-host\scrape_airbnb.py" --headless 2>&1 | Out-File -Append -Encoding utf8 $log
$scrapeCode = $LASTEXITCODE
if ($scrapeCode -ne 0) {
    # FAIL LOUD (fix, /deep-audit full-repo M2, 2026-07-14): a failed scrape must NOT fall through to
    # ingest, which would rebuild the income model from STALE raw/ and publish it as fresh. That was the
    # silent 2026-06-24 false-success - the browser session timed out, yet the run still reported
    # "37 bookings" on 06-14 data and exited 0. Skip ingest, push RED via close-out, exit non-zero.
    "[FAIL] scrape_airbnb.py exited $scrapeCode - Airbnb data NOT refreshed. Skipping ingest so stale raw is not published as fresh. Likely the Playwright session expired: run the --setup login (queue: airbnb-playwright-setup)." | Out-File -Append -Encoding utf8 $log
    Invoke-CloseOutCheck -Out "BLOCKED: scrape_airbnb.py failed (exit $scrapeCode); income model NOT rebuilt, to avoid publishing STALE Airbnb data as fresh. The Airbnb browser session likely expired - run the Playwright --setup login (queue: airbnb-playwright-setup)." -Code 1 -Log $log -Project 'airbnb'
    exit 1
}
python "work\13-airbnb-host\ingest_airbnb.py"   2>&1 | Out-File -Append -Encoding utf8 $log

# Then sync Notion + vault from the freshly-written normalized data (no re-scrape).
$prompt = "Run /airbnb-host monthly-sync: scrape + ingest already ran this run, so raw/bookings-normalized.json and the Excel income model are fresh as of today. Do NOT re-scrape. Read raw/bookings-normalized.json, upsert the Notion Airbnb Bookings DB to match, refresh vault/me/airbnb-studio.md and vault/projects/airbnb-host/status.md and vault/log.md, and flag any new pending requests or discrepancies."
$out = ''
try {
    $prompt = "$prompt $AlexVerdictInstruction"
    $out = (& "$env:APPDATA\npm\claude.ps1" -p $prompt --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'airbnb'
