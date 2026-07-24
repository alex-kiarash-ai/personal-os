#!/usr/bin/env python
# Item 3 (2026-07-20): numbers-drift check for the identity-carrying master reference.
# Zero-token. Called from check.ps1 as C19. Detect, never repair.
#
# REPOINTED + EXPANDED 2026-07-25 (stress-test fix F2). The master reference MOVED out of the repo
# on 2026-07-21, but this check still hardcoded the old in-repo path - now a 481-byte retirement
# stub - so it read the stub, found no claims, and returned 0 (falsely clean). The living doc was
# guarded by nothing while its claims drifted (standing sections said "V1-V11" while the code ran
# V1-V12, the escrow date was stale, etc). The fixes:
#   (1) the master path is read from system/manifest.json meta.paths.master_reference_md (single
#       source of truth, %USERPROFILE%-anchored) so a future move updates ONE place and cannot
#       silently rot a hardcoded literal again;
#   (2) an ABSENT master returns 2 (amber), never 0 - so a move not reflected in the manifest, or a
#       fresh clone without the out-of-repo doc, is SURFACED, never hidden behind a green;
#   (3) the claim-set is DERIVED from ground-truth sources (not frozen numbers): the recovery
#       C-count from check.ps1, the validator V-count from validate-alex.js, the non-retired project
#       count from the manifest, and the escrow attestation date from state/passphrase-attested.txt.
#
# Claims are checked ONLY in the STANDING part of the doc (everything before the "## 11. Running
# changes" section). The dated running-changes entries legitimately carry the count/version AT THAT
# DATE ("added C18, now V1-V12"); flagging those would false-positive on every historical line and
# break the living-doc-with-running-changes model this check protects. Each new claim needs its own
# (doc-regex + derived-truth) pair; pure prose drift stays the monthly /lint's job.
#
# Exit 0 = consistent - 2 = drift found (one line per finding) - 1 = checker could not compute truth.
import re, sys, os, json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHECK_PS1 = REPO / "work" / "18-recovery-layer" / "check.ps1"
VALIDATE_JS = REPO / "scripts" / "validate-alex.js"
ATTEST = REPO / "work" / "18-recovery-layer" / "state" / "passphrase-attested.txt"
MANIFEST = REPO / "system" / "manifest.json"


def master_path(mani):
    p = (mani.get("meta", {}).get("paths", {}) or {}).get("master_reference_md")
    return Path(os.path.expandvars(p)) if p else None


def live_check_count():
    txt = CHECK_PS1.read_text(encoding="utf-8", errors="replace")
    return len(set(int(m) for m in re.findall(r'(?m)^\s*#\s*---\s*C(\d+)\b', txt)))


def live_v_count():
    txt = VALIDATE_JS.read_text(encoding="utf-8", errors="replace")
    m = re.search(r'V1-V(\d+)\s+PASS', txt)          # the canonical suite-range statement
    if m:
        return int(m.group(1))
    nums = [int(x) for x in re.findall(r'\bV(\d+)\b', txt)]
    return max(nums) if nums else None


def live_project_count(mani):
    return sum(1 for p in mani.get("projects", []) if str(p.get("state", "")).upper() != "RETIRED")


def live_escrow_date():
    if not ATTEST.exists():
        return None
    lines = ATTEST.read_text(encoding="utf-8", errors="replace").splitlines()
    if not lines:
        return None
    m = re.search(r'\d{4}-\d{2}-\d{2}', lines[0])
    return m.group(0) if m else None


def standing_part(text):
    """Everything before the '## 11. Running changes' section (the dated history is excluded)."""
    m = re.search(r'(?m)^##\s+11\.\s', text)
    return text[:m.start()] if m else text


def main():
    if not MANIFEST.exists():
        print(f"cannot compute ground truth: {MANIFEST} missing", file=sys.stderr)
        return 1
    mani = json.loads(MANIFEST.read_text(encoding="utf-8", errors="replace"))
    if not CHECK_PS1.exists():
        print(f"cannot compute ground truth: {CHECK_PS1} missing", file=sys.stderr)
        return 1

    live_c = live_check_count()
    if live_c == 0:
        print("cannot compute ground truth: no '# --- C<n>' headers found in check.ps1", file=sys.stderr)
        return 1

    master = master_path(mani)
    if master is None:
        print("cannot compute: system/manifest.json meta.paths.master_reference_md is not set", file=sys.stderr)
        return 1
    if not master.exists():
        # AMBER, never silent-green: a move not reflected in the manifest, or a fresh clone without
        # the out-of-repo doc, must SURFACE. This is the anti-re-rot guard the old code never fired.
        print(f"master reference not found at {master} (out-of-repo doc absent; cannot verify its claims)")
        return 2

    text = standing_part(master.read_text(encoding="utf-8", errors="replace"))
    findings = []

    # claim 1: recovery check count - "<N> deterministic checks"
    stated_c = [int(m.group(1)) for m in re.finditer(r'(\d+)\s+deterministic checks', text)]
    for v in stated_c:
        if v != live_c:
            findings.append(f"master claims '{v} deterministic checks' but check.ps1 runs {live_c} (C1-C{live_c})")
    if len(set(stated_c)) > 1:
        findings.append(f"master is internally inconsistent on the check count: claims {sorted(set(stated_c))} (live {live_c})")

    # claim 2: validator V-count - "V1-V<N>"
    live_v = live_v_count()
    if live_v is not None:
        for m in re.finditer(r'V1[-–]V(\d+)', text):
            v = int(m.group(1))
            if v != live_v:
                findings.append(f"master claims 'V1-V{v}' but validate-alex.js runs V1-V{live_v}")

    # claim 3: non-retired project count - "~N automations" (approximate register: flag only gross drift, >3 off)
    live_p = live_project_count(mani)
    for m in re.finditer(r'~?\s*(\d+)\s+automations', text):
        v = int(m.group(1))
        if abs(v - live_p) > 3:
            findings.append(f"master claims '{v} automations' but the manifest has {live_p} non-retired (>3 off)")

    # claim 4: escrow attestation date - "C14 attested <date>"
    esc = live_escrow_date()
    if esc:
        for m in re.finditer(r'C14 attested\s+(\d{4}-\d{2}-\d{2})', text):
            if m.group(1) != esc:
                findings.append(f"master cites 'C14 attested {m.group(1)}' but state/passphrase-attested.txt says {esc}")

    if findings:
        for f in findings:
            print(f)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
