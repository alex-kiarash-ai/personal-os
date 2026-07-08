# Landscape Monitor wrapper (#25 Evolution, P2-S1). ZERO-TOKEN: runs Node, never calls claude.
# Close-Out Gate hardened (shared mechanism scripts/lib/close-out.ps1). On all-sources-fail the node
# script exits 1 -> close-out logs FAILED, pushes RED to Alex HQ, self-schedules a +90min retry.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\landscape-monitor.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

$out = ''
try {
    $out = (& node "scripts\landscape-monitor.js" 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

# GREEN heartbeat on success (tolerant; never logs the token; never crashes the wrapper). Lands on the
# Alex HQ 'evolution' tile once activation sets hq_project; harmless orphan metric until then.
if ($code -eq 0 -and $out -notmatch 'WRAPPER EXCEPTION') {
    $tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
    if (Test-Path $tokenFile) {
        try {
            $token = (Get-Content $tokenFile -Raw).Trim()
            $body = @{ project = 'evolution'; metric_key = 'run_status'; value_num = 1; headline = 'landscape monitor ok'; status = 'green' } | ConvertTo-Json -Compress
            Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
            "HQ green push sent" | Out-File -Append -Encoding utf8 $log
        } catch { "HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }
    }
}

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'evolution'
