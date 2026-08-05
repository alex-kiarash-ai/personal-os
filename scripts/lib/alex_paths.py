"""Alex HQ path resolution for the Python side (added 2026-08-04, the website split).

WHY THIS EXISTS: the HQ harvest/heal/liveness scripts reached into `work/16-alex-hq/app/public/data`,
which stopped existing the moment the website moved into its own repo. No script should name an
absolute path or assume the site lives inside personal-os again.

THE ORDER, for every lookup (first hit wins):
  1. env var             - ALEX_HQ_REPO, for odd layouts + CI
  2. manifest meta.paths - system/manifest.json, the SSOT check.mjs already reads
  3. structural default  - <personal-os>/../alex-hq, a sibling

Node twin: work/16-alex-hq/scripts/lib/paths.mjs. Keep the two in agreement.
"""
import json
import os
import re
from pathlib import Path


def _expand(s: str) -> str:
    """%USERPROFILE% (the manifest's own convention) and ${VAR}, expanded at read time.

    Unknown variables are left verbatim rather than blanked, so a bad value fails loudly
    on a path that still contains a % or $ instead of silently resolving to the wrong dir.
    """
    s = re.sub(r"%([A-Za-z_][A-Za-z0-9_]*)%",
               lambda m: os.environ.get(m.group(1), m.group(0)), s)
    return re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                  lambda m: os.environ.get(m.group(1), m.group(0)), s)


def _manifest_paths(repo: Path) -> dict:
    try:
        m = json.loads((repo / "system" / "manifest.json").read_text(encoding="utf-8"))
        return m.get("meta", {}).get("paths", {}) or {}
    except Exception:
        return {}  # a missing/unreadable manifest falls through to the structural default


def alex_hq_repo(repo: Path) -> Path:
    """The Alex HQ website repo, split out of work/16-alex-hq on 2026-08-04.

    Default layout is a SIBLING of personal-os (same pattern as the shaheenkiarash.com repo).
    A relative declared value resolves against the personal-os root, never the cwd.
    """
    declared = os.environ.get("ALEX_HQ_REPO") or _manifest_paths(repo).get("alex_hq_repo")
    if not declared:
        return (repo.parent / "alex-hq").resolve()
    p = Path(_expand(declared))
    return p.resolve() if p.is_absolute() else (repo / p).resolve()


def alex_hq_data(repo: Path) -> Path:
    """The static-JSON dir the build scripts write and the box serves from /opt/alex-hq-data."""
    return alex_hq_repo(repo) / "public" / "data"
