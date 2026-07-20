# Weekly Scout's Eye scheduled wrapper (#30 Modeling Growth Loop, built 2026-07-20).
# Mon 09:30 once ARMED (Phase-0 verification flips #30 LIVE; until then run manually).
# Two stages: (1) deterministic ZERO-TOKEN core work\30-modeling\scripts\scout-checks.mjs
# (live-site health + /now staleness + metrics/rights hygiene); (2) a claude -p judgment
# layer (Cloudflare analytics snapshot -> metrics.jsonl + fix list + collab pipeline +
# ledger follow-ups, all Gmail-draft-only). A RED from the core -> RED heartbeat + non-zero exit,
# regardless of the judgment layer. House pattern: run-modeling-radar.ps1 + close-out.ps1 + quota gate.
param([switch]$Floor)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\modeling-weekly.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
if (-not (Test-AlexQuotaGate -Log $log -Project 'modeling')) { exit 0 }

# --- Stage 1: deterministic Scout's Eye core (zero-token). Captures the SCOUT line + exit code. ---
$scout = (& node "work\30-modeling\scripts\scout-checks.mjs" 2>&1 | Out-String)
$scoutCode = $LASTEXITCODE
$scout | Out-File -Append -Encoding utf8 $log
$scoutLine = ($scout -split "`n" | Where-Object { $_ -match '^SCOUT ' } | Select-Object -First 1)
if (-not $scoutLine) { $scoutLine = 'SCOUT UNKNOWN (core produced no summary line)' }
$scoutLine = $scoutLine.Trim()
$scoutRed = ($scoutCode -ne 0 -or $scoutLine -match 'SCOUT RED')

# --- Stage 2: judgment layer (the core's verdict is ground truth; do NOT re-GET the site). ---
$prompt = "Run the #30 weekly Scout's Eye judgment layer per work/30-modeling/CLAUDE.md (section D+E+F+G). The deterministic core already ran THIS run - its verdict line is: '$scoutLine' (treat it as ground truth, do NOT re-GET the site yourself). Read the spec first: work/30-modeling/CLAUDE.md, fit-rubric.md, pitch-list.md, register.md. Steps: (1) Cloudflare analytics snapshot - read the CF token at work/30-modeling/config/ (per infrastructure.md); pull the last 7 days for shaheenkiarash.com (requests, unique visitors, top paths). PRE-LAUNCH (no first_fire in manifest #30) traffic is ~0 - that is NORMAL, record it, do not alarm. Append a metrics row {ts, kind:'weekly', scout:'$scoutLine', visitors, requests, top_paths} to vault/projects/modeling/metrics.jsonl. (2) Fix list: turn any AMBER/RED in the core verdict into a numbered fix list (what broke -> the one action). GREEN core = say so in one line. (3) Collab pipeline: from pitch-list.md, draft 0-2 photographer/collab intro or follow-up emails as Gmail create_draft ONLY - Brand + Soul Pre-Flight Gate FIRST (read brand/config/brand-config.md + soul.md, print the pre-flight line; voice = soul.md + register.md overlay). Verify via list_drafts. NEVER send. Empty pitch-list / pre-launch = skip, say so. (4) Follow-ups: scan the Notion Modeling Leads ledger (ids in vault/projects/modeling/status.md frontmatter) for rows whose Next follow-up <= today (collab 7/14d, agency 14/30d); list them, draft the top 0-2 as Gmail drafts, verify read-back. (5) Weekly note to outputs/modeling/$(Get-Date -Format yyyy-MM-dd)/weekly-scout.md (scout verdict + fix list + analytics + drafts made) + an outputs-ledger A6 row. Close-Out Gate: log.md entry, status.md last_run, print the Close-Out Report. Do NOT push to Alex HQ - the wrapper does it. Degraded run (CF token missing, Notion down) -> say PARTIAL. The ONLY external writes this run are Gmail drafts + one metrics append + one review file; no send path exists."
$out = ''
try {
    $prompt = "$prompt $AlexVerdictInstruction"
    $out = (& "$env:APPDATA\npm\claude.ps1" --model claude-sonnet-4-6 -p $prompt --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

# --- HQ heartbeat: RED if the core RED'd (site down / stale / rights miss), amber on a degraded
#     judgment run, else green. metric_key 'weekly' = the modeling weekly tile (distinct from radar). ---
$tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
if (Test-Path $tokenFile) {
    try {
        $token = (Get-Content $tokenFile -Raw).Trim()
        $partial = ($out -match 'PARTIAL')
        if ($scoutRed) { $val = 0; $st = 'red'; $hl = "weekly scout RED: $scoutLine" }
        elseif ($partial -or $code -ne 0 -or $out -match 'WRAPPER EXCEPTION') { $val = 0.5; $st = 'amber'; $hl = 'weekly scout PARTIAL (degraded)' }
        else { $val = 1; $st = 'green'; $hl = 'weekly scout ok' }
        $body = @{ project = 'modeling'; metric_key = 'weekly'; value_num = $val; headline = $hl; status = $st } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        "HQ push sent ($st)" | Out-File -Append -Encoding utf8 $log
    } catch { "HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }
}

# The whole run is RED if the deterministic core RED'd, whatever the judgment layer did.
if ($scoutRed -and $code -eq 0) { $code = 1 }
Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'modeling'
