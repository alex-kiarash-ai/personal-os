# escrow-test.ps1 - T-20 vault-backup passphrase ESCROW DRILL (recovery layer).
# PROVES the vault-backup passphrase stored in Shaheen's PASSWORD MANAGER can decrypt the OFF-MACHINE
# encrypted backup - i.e. the backups survive a dead ThinkPad even if the local .alex-secrets file is gone.
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

$gpg = @("C:\Program Files\Git\usr\bin\gpg.exe","C:\Program Files (x86)\GnuPG\bin\gpg.exe") |
       Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $gpg) { $c = Get-Command gpg -ErrorAction SilentlyContinue; if ($c) { $gpg = $c.Source } }
if (-not $gpg) { Write-Host "FAIL: gpg not found." -ForegroundColor Red; exit 1 }

$localPass = Join-Path $env:USERPROFILE ".alex-secrets\vault-backup.pass"
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
        Write-Host "PASS: your PASSWORD-MANAGER passphrase decrypted the off-machine backup." -ForegroundColor Green
        Write-Host "      $name  ->  $entries entries recovered. The backups survive a dead ThinkPad."
        Write-Host "      Tell Alex 'escrow pass' and it will stamp the attestation + close the queue items."
    } else {
        Write-Host "FAIL: the local file decrypted this blob but your MANAGER copy did not - the manager entry is genuinely wrong/stale." -ForegroundColor Red
        Write-Host "      Fix: run   Set-Clipboard -Value (Get-Content '$localPass' -First 1)"
        Write-Host "      then paste that into your password manager (replace the value), save, and re-run this drill."
    }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue  # wipes the pulled blob, decrypted tars, and pp.txt
}
