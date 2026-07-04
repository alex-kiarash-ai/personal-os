# Airbnb Host scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\airbnb-host.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

# Deterministic first (write-first discipline): harvest + rebuild the model even if the agent step fails.
python "work\13-airbnb-host\scrape_airbnb.py"  2>&1 | Out-File -Append -Encoding utf8 $log
python "work\13-airbnb-host\ingest_airbnb.py"   2>&1 | Out-File -Append -Encoding utf8 $log

# Then sync Notion + vault from the freshly-written normalized data (no re-scrape).
$prompt = "Run /airbnb-host monthly-sync: scrape + ingest already ran this run, so raw/bookings-normalized.json and the Excel income model are fresh as of today. Do NOT re-scrape. Read raw/bookings-normalized.json, upsert the Notion Airbnb Bookings DB to match, refresh vault/me/airbnb-studio.md and vault/projects/airbnb-host/status.md and vault/log.md, and flag any new pending requests or discrepancies."
$out = ''
try {
    $out = (& "$env:APPDATA\npm\claude.ps1" -p $prompt --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'airbnb'
