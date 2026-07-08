# Landscape Eval wrapper (#25 Evolution, P2-S2). ONE claude -p call per week.
# Flow: node assembler (zero-token) -> claude -p on the assembled prompt -> save digest ->
#       open a GitHub issue if gh is installed, else keep the digest local -> HQ push -> close-out.
# Empty week = the assembler exits 3, this wrapper posts nothing and stays GREEN (never invents items).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\landscape-eval.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

function Push-HQ($status, $headline) {
    $tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
    if (-not (Test-Path $tokenFile)) { return }
    try {
        $token = (Get-Content $tokenFile -Raw).Trim()
        $val = if ($status -eq 'green') { 1 } else { 0 }
        $body = @{ project = 'evolution'; metric_key = 'run_status'; value_num = $val; headline = $headline; status = $status } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        "HQ $status push sent" | Out-File -Append -Encoding utf8 $log
    } catch { "HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }
}

# 1. Deterministic assembler (zero-token). Exit 3 = nothing new this week; exit 0 = prompt path printed.
$promptPath = (& node "scripts\landscape-eval.js" 2>&1 | Out-String).Trim()
$asmCode = $LASTEXITCODE
if ($asmCode -eq 3) {
    "nothing new in the last 7 days - posting nothing, GREEN" | Out-File -Append -Encoding utf8 $log
    Push-HQ 'green' 'evolution: quiet week, nothing to review'
    exit 0
}
if ($asmCode -ne 0 -or -not (Test-Path $promptPath)) {
    $msg = "WRAPPER EXCEPTION: eval assembler failed (exit $asmCode) - $promptPath"
    $msg | Out-File -Append -Encoding utf8 $log
    Invoke-CloseOutCheck -Out $msg -Code 1 -Log $log -Project 'evolution'
}

# 2. The ONE model call: feed the assembled prompt to claude via stdin (non-interactive print mode).
#    NOTE (confirm on first real run): the prompt is piped to `claude -p` on stdin. If this CLI build
#    needs the prompt as a positional arg instead, pass it as the -p argument here.
$stamp = Get-Date -Format 'yyyy-MM-dd'
$outDir = "outputs\evolution\$stamp"; New-Item -ItemType Directory -Force $outDir | Out-Null
$digestPath = Join-Path $outDir 'digest.md'
$out = ''
try {
    $out = (Get-Content $promptPath -Raw | & "$env:APPDATA\npm\claude.ps1" -p --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

# 3. Real output -> save the digest, then open the GitHub issue if gh exists (else keep it local).
$blocked = ($out -replace '\s', '').Length -lt 200
if ($code -eq 0 -and -not $blocked -and $out -notmatch 'WRAPPER EXCEPTION') {
    $out | Out-File -Encoding utf8 $digestPath
    "digest saved: $digestPath" | Out-File -Append -Encoding utf8 $log
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        try {
            & gh label create ai-landscape-update --color 1f6feb --description "Weekly Alex evolution digest" 2>$null | Out-Null
            (& gh issue create --title "ai-landscape-update $stamp" --label ai-landscape-update --body-file $digestPath 2>&1) | Out-File -Append -Encoding utf8 $log
            "GitHub issue created (label ai-landscape-update)" | Out-File -Append -Encoding utf8 $log
        } catch {
            "gh issue create failed: $($_.Exception.Message) - digest is local at $digestPath" | Out-File -Append -Encoding utf8 $log
        }
    } else {
        "gh not installed - digest saved locally only ($digestPath). Install + auth gh to auto-open the ai-landscape-update issue." | Out-File -Append -Encoding utf8 $log
    }
    Push-HQ 'green' "evolution: weekly digest ready ($stamp)"
}

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'evolution'
