# Landscape Eval wrapper (#25 Evolution, P2-S2). ONE claude -p call per week.
# Flow: node assembler (zero-token) -> claude -p on the assembled prompt -> save digest ->
#       open a GitHub issue if gh is installed, else keep the digest local -> HQ push -> close-out.
# Empty week = the assembler exits 3, this wrapper posts nothing and stays GREEN (never invents items).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"

# n8n creds into env (from file, never code) so the skills installer's `generate-alex.js --only=claude,docs`
# doc-regen passes its live model-routing validation (V6). --only=claude,docs does a read-only n8n check,
# it does NOT sync/write workflows. Absent key file = installer keeps the install but skips the doc regen.
$n8nKeyFile = "work\03-application-engine\config\n8n-api-key.txt"
if (Test-Path $n8nKeyFile) {
    if (-not $env:N8N_API_KEY) { $env:N8N_API_KEY = (Get-Content $n8nKeyFile -Raw).Trim() }
    if (-not $env:N8N_API_URL) { $env:N8N_API_URL = "https://n8n.shaheenkiarash.com/api/v1" }
}
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

# 2. The ONE model call: pipe the assembled prompt to claude -p over STDIN (not a positional arg). The
#    skills lane grew the prompt past ~30KB, near the Windows command-line arg limit, so we feed it on
#    stdin, which has no such ceiling. `claude -p` with no prompt argument reads the prompt from stdin.
$stamp = Get-Date -Format 'yyyy-MM-dd'
$outDir = "outputs\evolution\$stamp"; New-Item -ItemType Directory -Force $outDir | Out-Null
$digestPath = Join-Path $outDir 'digest.md'
$out = ''
try {
    $prompt = Get-Content $promptPath -Raw
    $out = ($prompt | & "$env:APPDATA\npm\claude.ps1" -p --dangerously-skip-permissions 2>&1 | Out-String)
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

    # 3b. Skills lane (#25, 2026-07-11): hand the digest's json install block to the deterministic,
    #     audited installer. It installs allowlisted+clean skills live, wires each into the recall
    #     architecture, and git-commits per install; the rest are flagged in its report. Zero tokens.
    $installOut = ''
    try {
        $installOut = (& node "scripts\skills-installer.js" $digestPath 2>&1 | Out-String)
        $installOut | Out-File -Append -Encoding utf8 $log
        if ($installOut.Trim()) { "`n---`n$installOut" | Out-File -Append -Encoding utf8 $digestPath }
    } catch {
        "skills-installer failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log
    }

    $installedN = 0
    if ($installOut -match 'Installed (\d+)') { $installedN = [int]$Matches[1] }
    $headline = if ($installedN -gt 0) {
        "evolution: digest ready + $installedN skill(s) auto-installed ($stamp) - undo via git revert"
    } else {
        "evolution: weekly digest ready ($stamp)"
    }
    Push-HQ 'green' $headline
}

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'evolution'
