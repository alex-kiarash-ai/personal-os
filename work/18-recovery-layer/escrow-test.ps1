# escrow-test.ps1 - T-20 vault-backup passphrase ESCROW DRILL (recovery layer).
# PROVES the vault-backup passphrase stored in Shaheen's PASSWORD MANAGER can decrypt the OFF-MACHINE
# encrypted backup - i.e. the backups survive a dead ThinkPad even if the local passphrase file is gone.
#
# Run:   powershell -File work\18-recovery-layer\escrow-test.ps1
# When prompted, paste the passphrase COPIED FROM YOUR PASSWORD MANAGER (not the local file).
# The passphrase is read into a SecureString and handed to gpg via a temp --passphrase-file that is wiped
# immediately; it is never echoed, logged, or sent anywhere. Re-run every ~90 days (the C14 window).
#
# Two-stage on purpose: (1) SELF-TEST with the local passphrase file proves the drill + blob + gpg all work,
# so a FAIL can only mean the manager copy. (2) MANAGER TEST is the real proof.
# NOTE: passphrases go to gpg via --passphrase-file, never stdin: piping to --passphrase-fd on Windows appends
# \r\n, which gpg folds into the passphrase and breaks decryption regardless of the value.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-GpgDecrypt($gpgExe, $blobPath, $passFile, $outPath, $errPath) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # gpg writes status to stderr even on success
    & $gpgExe --batch --yes --pinentry-mode loopback --passphrase-file $passFile -o $outPath -d $blobPath 2>$errPath | Out-Null
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return ($rc -eq 0) -and (Test-Path $outPath) -and ((Get-Item $outPath).Length -gt 0)
}

$repo      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$attestFile = Join-Path $PSScriptRoot 'state\passphrase-attested.txt'
$haCli     = Join-Path $repo 'scripts\human-actions.js'

# --- Class A single-source-of-truth (2026-07-21, audit F-01): the drill is the ONLY writer of the
# attestation, and it closes/opens the queue in the SAME run, so the file and the queue can never
# disagree the way they did on 2026-07-18. Stamp the date BEFORE closing (the human-actions `done`
# gate reads this file and refuses to close an unproven escrow item).
function Write-AttestationPass($blobName, $entries) {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $due   = (Get-Date).AddDays(90).ToString('yyyy-MM-dd')
    $body  = @("$today",
               "Escrow drill PASSED: the password-manager passphrase decrypted $blobName ($entries entries) on $today.",
               "Next re-drill due ~$due (90-day C14 window). Sole writer: escrow-test.ps1.") -join "`n"
    [System.IO.File]::WriteAllText($attestFile, $body + "`n", (New-Object System.Text.UTF8Encoding($false)))
    # BUGFIX 2026-07-21: node prints "no open item" to stderr for an already-closed id; under this script's
    # $ErrorActionPreference='Stop' that NativeCommandError was terminating and aborted the loop before it
    # reached the still-open item (the drill PASSED but passphrase-safeplace-fix stayed open). Run the loop
    # under 'Continue' + per-id try/catch so one benign stderr can never skip closing the real open item.
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    foreach ($id in @('passphrase-attestation','passphrase-escrow-retest','passphrase-safeplace-fix')) {
        try { & node $haCli done $id 2>$null | Out-Null } catch { }   # no-op if not open; the gate passes (date stamped above)
    }
    $ErrorActionPreference = $prevEAP
    $global:LASTEXITCODE = 0
}
function Write-AttestationFail($reason) {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $body  = @("PENDING - escrow drill FAILED $today, do NOT treat as attested",
               "$reason",
               "Fix + re-run: powershell -File work\18-recovery-layer\escrow-test.ps1. Sole writer: escrow-test.ps1.") -join "`n"
    [System.IO.File]::WriteAllText($attestFile, $body + "`n", (New-Object System.Text.UTF8Encoding($false)))
    # Ensure the failure is ESCALATED: the canonical escrow item stays open and ages up the ladder.
    # Same 'Continue' guard as the PASS branch (a native stderr under 'Stop' must never abort this).
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $open = (& node $haCli list 2>$null | Out-String)
    if ($open -notmatch 'passphrase-safeplace-fix') {
        try { & node $haCli add --id passphrase-safeplace-fix --what "Vault-backup off-machine passphrase is UNPROVEN: fix the password-manager copy and re-run work/18-recovery-layer/escrow-test.ps1 until it prints PASS" --why "only you can open your password manager" --severity high 2>$null | Out-Null } catch { }
    }
    $ErrorActionPreference = $prevEAP
    $global:LASTEXITCODE = 0
}

$gpg = @("C:\Program Files\Git\usr\bin\gpg.exe","C:\Program Files (x86)\GnuPG\bin\gpg.exe") |
       Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $gpg) { $c = Get-Command gpg -ErrorAction SilentlyContinue; if ($c) { $gpg = $c.Source } }
if (-not $gpg) { Write-Host "FAIL: gpg not found." -ForegroundColor Red; exit 1 }

# F-04 (2026-07-21): the local passphrase-file path is read from the gitignored credentials ledger,
# not hardcoded in this tracked/public script.
$localPass = $null
$__ledger = Join-Path $repo 'system\credentials-ledger.json'
if (Test-Path $__ledger) {
    try {
        $__pe = (Get-Content $__ledger -Raw | ConvertFrom-Json).credentials | Where-Object { $_.id -eq 'vault-backup-gpg-passphrase' } | Select-Object -First 1
        if ($__pe -and $__pe.local_path) { $localPass = [Environment]::ExpandEnvironmentVariables($__pe.local_path) }
    } catch { }
}
$tmp = Join-Path $env:TEMP ("escrow-" + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    Write-Host "Finding the newest off-machine backup on the box..."
    $blob = (ssh -o BatchMode=yes n8n "ls -1t /opt/alex-backups/vault-*.tar.gpg 2>/dev/null | head -1").Trim()
    if (-not $blob) { Write-Host "FAIL: no backup blob found on the box." -ForegroundColor Red; exit 1 }
    $name = Split-Path $blob -Leaf
    $blobPath = Join-Path $tmp $name
    Write-Host "Newest off-machine blob: $name"
    Write-Host "Pulling it down (~140 MB, give it a moment)..."
    scp "n8n:$blob" $blobPath
    if (-not (Test-Path $blobPath)) { Write-Host "FAIL: could not pull the blob off the box." -ForegroundColor Red; exit 1 }

    # 1) SELF-TEST with the local passphrase file (the one the nightly backup uses).
    Write-Host "Self-test: decrypting with the LOCAL passphrase file..."
    if (-not (Test-Path $localPass)) {
        Write-Host "  NOTE: local passphrase file not found - skipping self-test, manager result still valid."
    } elseif (Invoke-GpgDecrypt $gpg $blobPath $localPass (Join-Path $tmp "self.tar") (Join-Path $tmp "e1.txt")) {
        Write-Host "  self-test OK - the drill, the blob and gpg all work. A FAIL below can only be the manager copy."
    } else {
        Write-Host ""
        Write-Host "PROBLEM: even the LOCAL passphrase file did not decrypt this blob." -ForegroundColor Red
        Write-Host "         So the issue is the drill / blob / gpg, NOT your password manager. Tell Alex; do not touch the manager."
        exit 1
    }

    # 2) MANAGER TEST - the real escrow proof.
    $sec  = Read-Host -AsSecureString "Paste the vault-backup passphrase FROM your password manager"
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $pf = Join-Path $tmp "pp.txt"
    [System.IO.File]::WriteAllText($pf, $plain, (New-Object System.Text.UTF8Encoding($false)))  # exact value, no BOM, no newline
    $plain = $null
    Write-Host "Decrypting with your PASSWORD-MANAGER passphrase..."
    $ok = Invoke-GpgDecrypt $gpg $blobPath $pf (Join-Path $tmp "out.tar") (Join-Path $tmp "e2.txt")
    Remove-Item $pf -Force -ErrorAction SilentlyContinue

    Write-Host ""
    if ($ok) {
        $entries = (& tar -tf (Join-Path $tmp "out.tar") 2>$null | Measure-Object).Count
        Write-AttestationPass $name $entries
        Write-Host "PASS: your PASSWORD-MANAGER passphrase decrypted the off-machine backup." -ForegroundColor Green
        Write-Host "      $name  ->  $entries entries recovered. The backups survive a dead ThinkPad."
        Write-Host "      Attestation stamped ($attestFile) and the escrow queue items closed automatically."
        Write-Host "      C14 will read green on the next recovery sweep. No 'tell Alex' step needed."
    } else {
        Write-AttestationFail "the local file decrypted this blob but the password-manager copy did not - the manager entry is genuinely wrong/stale."
        Write-Host "FAIL: the local file decrypted this blob but your MANAGER copy did not - the manager entry is genuinely wrong/stale." -ForegroundColor Red
        Write-Host "      Attestation left PENDING and a HIGH 'passphrase-escrow-red' item is open until this passes."
        Write-Host "      Fix: run   Set-Clipboard -Value (Get-Content '$localPass' -First 1)"
        Write-Host "      then paste that into your password manager (replace the value), save, and re-run this drill."
    }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue  # wipes the pulled blob, decrypted tars, and pp.txt
}
