#!/usr/bin/env python
# Item 3 (2026-07-20): numbers-drift check for the identity-carrying master reference.
# Zero-token. The plain-English guide + the technical master reference are under a standing order to be
# updated in the same session as any behavior change, but NOTHING verified it - the last place Alex
# trusted a habit over a mechanism. This catches the class every recovery C-check misses: a narrative
# doc claiming a COUNT the code disproves. Detect, never repair. Called from check.ps1 as C19.
#
# MVP claim-set (deliberately small, calibrated against the real doc 2026-07-20): the recovery-check
# count only, via the canonical stable phrasings "<N> deterministic checks" and "C1-C<N>". The
# automation count is written approximately in the master ref ("~27") and LIVE is not stated
# numerically, so checking those would false-positive; they are deliberately OUT until phase 2.
# Phase 2: python-docx extraction of the plain-English guide's tables (T07 catalog, T08 timetable).
#
# Exit 0 = consistent · 2 = drift found (one line per finding) · 1 = checker could not compute truth.
import re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHECK_PS1 = REPO / "work" / "18-recovery-layer" / "check.ps1"
MASTER = REPO / "outputs" / "sessions" / "2026-07-15-alex-infra-audit" / "ALEX-OS-master.md"

def live_check_count():
    """Ground truth: distinct C-numbers among check.ps1's '# --- C<n>' block headers."""
    txt = CHECK_PS1.read_text(encoding="utf-8", errors="replace")
    nums = set(int(m) for m in re.findall(r'(?m)^\s*#\s*---\s*C(\d+)\b', txt))
    return len(nums), nums

def main():
    if not CHECK_PS1.exists():
        print(f"cannot compute ground truth: {CHECK_PS1} missing", file=sys.stderr)
        return 1
    live, nums = live_check_count()
    if live == 0:
        print("cannot compute ground truth: no '# --- C<n>' headers found in check.ps1", file=sys.stderr)
        return 1

    if not MASTER.exists():
        print(f"master reference not found at {MASTER} (cannot verify its check-count claims)")
        return 2

    text = MASTER.read_text(encoding="utf-8", errors="replace")
    findings = []

    # Canonical CURRENT-STATE claim: "<N> deterministic checks". This is the single authoritative
    # phrasing for the current count. The bare "C1-C<N>" range form is deliberately NOT enforced: it
    # also appears in DATED running-changes entries ("added C18, now C1-C18") that legitimately carry
    # the count-at-that-date, and flagging those would false-positive on every historical line - which
    # would break the living-doc-with-running-changes model this check is meant to protect.
    stated = [int(m.group(1)) for m in re.finditer(r'(\d+)\s+deterministic checks', text)]
    for val in stated:
        if val != live:
            findings.append(f"master reference claims '{val} deterministic checks' but check.ps1 runs {live} (C1-C{live})")

    # Intra-doc consistency: the doc must not state two different CURRENT check counts.
    if len(set(stated)) > 1:
        findings.append(f"master reference is internally inconsistent on the current check count: claims {sorted(set(stated))} (live is {live})")

    if findings:
        for f in findings:
            print(f)
        return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
