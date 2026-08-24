# work/18-recovery-layer/restore-doctor.ps1 - can this clone actually become Alex? (P6.4, run-47.)
#
# WHY THIS EXISTS. Run 46 measured the fresh-clone path a FRACTURE: a clone gets the functional
# system and none of the identity, the skill junctions are machine-local and silently absent, and
# `vault/identity.md` - the compendium a restore is supposed to read FIRST - arrives only inside the
# encrypted tar. All of that is DELIBERATE (the repo is public), and all of it was written down as
# prose in a restore runbook, which is the one form a checker cannot read and a panicking human is
# least likely to follow correctly.
#
# This turns that runbook into a diagnosis. It is the RESTORE-side sibling of check.ps1: check.ps1
# asks "is the running system consistent", this asks "could this tree become a running system".
# Read-only. Exit 0 = ready · 2 = gaps found (expected on a bare clone) · 1 = doctor error.
#
#   powershell -File work/18-recovery-layer/restore-doctor.ps1
param([switch]$Json)

$ErrorActionPreference = 'Stop'
$repo = if ($PSScriptRoot) { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } else { (Get-Location).Path }
Set-Location $repo

$findings = New-Object System.Collections.Generic.List[object]
function Add-F($level, $what, $detail, $fix) {
    $findings.Add([pscustomobject]@{ level = $level; what = $what; detail = $detail; fix = $fix })
}

# 1. IDENTITY. The single thing a clone can never carry, and the thing that makes Alex Alex.
if (Test-Path (Join-Path $repo 'soul.md')) {
    $soulKb = [math]::Round((Get-Item (Join-Path $repo 'soul.md')).Length / 1KB, 1)
    Add-F 'OK' 'soul.md present' "$soulKb KB" ''
} else {
    Add-F 'BLOCKER' 'soul.md is absent' 'A clone never carries it (gitignored by design, public repo). Without it this tree is Claude Code, not Alex.' 'Restore the encrypted vault tar FIRST; everything else below depends on it.'
}
if (Test-Path (Join-Path $repo 'soul-core.md')) {
    Add-F 'OK' 'soul-core.md present' 'The compiled identity card the CLAUDE.md @import loads.' ''
} else {
    Add-F 'WARN' 'soul-core.md is absent' 'Sessions fall back to the BOUNDED soul.md fallback (8KB + a loud warning since P3.2). Degraded, not silent.' 'node -e "require(''./scripts/lib/build-soul-core'').build({force:true})"'
}

# 2. THE RESTORE COMPENDIUM. Prose, but the prose a human needs before anything else.
if (Test-Path (Join-Path $repo 'vault\identity.md')) { Add-F 'OK' 'vault/identity.md present' 'The restore compendium.' '' }
else { Add-F 'BLOCKER' 'vault/identity.md is absent' 'This is the file a restore is supposed to read first, and it rides only in the encrypted tar.' 'Restore the tar, then read vault/identity.md before running anything else.' }

# 3. SKILL JUNCTIONS. Machine-local, gitignored, and silently missing after any clone.
$agents = Join-Path $repo '.agents\skills'
$links  = Join-Path $repo '.claude\skills'
if (Test-Path $agents) {
    $have = @(Get-ChildItem $agents -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    $parked = @()
    try {
        $lock = Get-Content (Join-Path $repo 'skills-lock.json') -Raw | ConvertFrom-Json
        $parked = @($lock.skills.PSObject.Properties | Where-Object { $_.Value.parked } | ForEach-Object { $_.Name })
    } catch {}
    $missing = @($have | Where-Object { ($parked -notcontains $_) -and -not (Test-Path (Join-Path $links $_)) })
    if ($missing.Count) {
        Add-F 'BLOCKER' "$($missing.Count) skill junction(s) missing" "MANDATORY-bound skills silently unloadable. First few: $((($missing | Select-Object -First 4) -join ', '))" 'powershell -File scripts\bootstrap.ps1 -RepairJunctions   (Git Bash ln -s silently COPIES on Windows - never use it)'
    } else {
        Add-F 'OK' 'Skill junctions resolve' "$($have.Count - $parked.Count) active, $($parked.Count) parked" ''
    }
}

# 4. LONG PATHS. A restore-time trap that fails LATE and confusingly if unset.
$lp = (& git config core.longpaths 2>$null)
if ($lp -eq 'true') { Add-F 'OK' 'core.longpaths enabled' '' '' }
else { Add-F 'WARN' 'core.longpaths is not enabled' 'Deep paths fail to check out on Windows, usually mid-restore and with an unhelpful error.' 'git config core.longpaths true   (clone with: git clone -c core.longpaths=true ...)' }

# 5. RE-INCLUDED SYSTEM FILES. The five system/ files that must survive the default-deny.
$mustTrack = @('system\manifest.json','system\hq-heal-map.json','system\skills-sources.json','system\landscape-log.jsonl','system\environment-schema.json')
$absent = @($mustTrack | Where-Object { -not (Test-Path (Join-Path $repo $_)) })
if ($absent.Count) { Add-F 'BLOCKER' 'Tracked system files missing' ($absent -join ', ') 'The clone is incomplete - re-clone rather than patching by hand.' }
else { Add-F 'OK' 'Tracked system files present' "$($mustTrack.Count) checked" '' }

# 6. LOCAL-ONLY STATE that a clone legitimately lacks. Reported so nobody mistakes it for damage.
foreach ($p in @('system\recall\facts.db','scripts\vault-index\vault-search.db')) {
    if (Test-Path (Join-Path $repo $p)) { Add-F 'OK' "$p present" '' '' }
    else { Add-F 'INFO' "$p absent (regenerable)" 'Not a defect: rebuilt by the nightly 21:35 chain or on demand.' 'node system\recall\harvest.js   /   python scripts\vault_search.py build' }
}

# 7. THE OUT-OF-REPO IDENTITY DOCS. The exact pair the 08-21 Desktop move silently dropped from the
#    backup for two nights (run-46 N1). Path read from the manifest, never hardcoded - that fourth
#    hardcoded copy IS what caused N1.
try {
    $idDir = [Environment]::ExpandEnvironmentVariables((Get-Content (Join-Path $repo 'system\manifest.json') -Raw | ConvertFrom-Json).meta.paths.identity_doc_real_dir)
    if (Test-Path $idDir) { Add-F 'OK' 'Identity docs reachable' $idDir '' }
    else { Add-F 'WARN' 'Identity docs not at the manifest path' $idDir 'They live outside the repo and ride only the encrypted tar. Restore it, or correct meta.paths.identity_doc_real_dir if they moved.' }
} catch { Add-F 'WARN' 'Could not resolve the identity-doc path' $_.Exception.Message 'Check meta.paths.identity_doc_real_dir in system/manifest.json.' }

$blockers = @($findings | Where-Object { $_.level -eq 'BLOCKER' })
$warns    = @($findings | Where-Object { $_.level -eq 'WARN' })

if ($Json) {
    [pscustomobject]@{ ready = ($blockers.Count -eq 0); blockers = $blockers.Count; warnings = $warns.Count; findings = $findings } | ConvertTo-Json -Depth 5
} else {
    Write-Output ""
    Write-Output "  Restore doctor - can this tree become Alex?"
    Write-Output ("  " + ("-" * 60))
    foreach ($f in $findings) {
        $tag = switch ($f.level) { 'OK' { '  ok   ' } 'INFO' { ' info  ' } 'WARN' { ' warn  ' } default { 'BLOCKER' } }
        Write-Output ("  [$tag] $($f.what)")
        if ($f.detail) { Write-Output ("            $($f.detail)") }
        if ($f.fix -and $f.level -ne 'OK') { Write-Output ("            fix: $($f.fix)") }
    }
    Write-Output ("  " + ("-" * 60))
    if ($blockers.Count -eq 0) { Write-Output "  READY. $($warns.Count) warning(s)." }
    else { Write-Output "  NOT READY: $($blockers.Count) blocker(s), $($warns.Count) warning(s). Work top to bottom." }
}

if ($blockers.Count) { exit 2 } else { exit 0 }
