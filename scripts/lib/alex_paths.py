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
    s = re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
               lambda m: os.environ.get(m.group(1), m.group(0)), s)
    # A leading ~ too (added 2026-08-13). Ruling B rewrote meta.paths from `%USERPROFILE%\...` to
    # `~/...`; without this the value resolves to the LITERAL string "~/..." - a path that never
    # exists. Same defect that made C19 report the identity docs missing while they sat right there.
    return os.path.expanduser(s)


def _manifest_paths(repo: Path) -> dict:
    try:
        m = json.loads((repo / "system" / "manifest.json").read_text(encoding="utf-8"))
        return m.get("meta", {}).get("paths", {}) or {}
    except Exception:
        return {}  # a missing/unreadable manifest falls through to the structural default


# --- secrets (ruling A) ---------------------------------------------------------------------------
# The Python twin of paths.mjs secretsDir/secretPath/secret. Added 2026-08-13 because there was no
# Python-side resolver at all, so hq_harvest_push.py named `work/16-alex-hq/config/alex-hq-token.txt`
# as a literal - and broke the moment that file was relocated out of the repo per ruling A. No script
# may name a credential path; this is the sanctioned way to reach one from Python.
# FAILS LOUD, like the Node twin: a credential that cannot be found must never degrade to "" - an
# empty token becomes a silently-unauthenticated call that "succeeds" with a 401 body.
_LEGACY_IN_REPO_SECRETS = {
    "alex-hq-token": "work/16-alex-hq/config/alex-hq-token.txt",
    "hq-basic-auth": "work/16-alex-hq/config/hq-basic-auth.txt",
    "n8n-api-key": "work/03-application-engine/config/n8n-api-key.txt",
    "qra-token": "work/quota-reset-autorun/config/qra-token.txt",
}


def secrets_dir() -> Path:
    """$ALEX_SECRETS_DIR, else $XDG_CONFIG_HOME/alex/secrets, else ~/.config/alex/secrets."""
    env = os.environ.get("ALEX_SECRETS_DIR")
    if env:
        return Path(_expand(env)).resolve()
    xdg = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(xdg) / "alex" / "secrets"


def secret_path(repo: Path, sid: str) -> Path:
    """Resolve a declared credential id to its file. Ledger local_path -> secrets_dir -> legacy."""
    ledger_file = repo / "system" / "credentials-ledger.json"
    if ledger_file.exists():
        try:
            ledger = json.loads(ledger_file.read_text(encoding="utf-8"))
        except Exception as e:
            raise RuntimeError(f"system/credentials-ledger.json is present but unparseable: {e}")
        for c in ledger.get("credentials", []) or []:
            if c.get("id") == sid and c.get("local_path"):
                p = Path(_expand(c["local_path"])).resolve()
                if p.exists():
                    return p
                raise FileNotFoundError(
                    f"secret_path('{sid}'): the ledger declares local_path but nothing exists there. "
                    f"Declared: {c['local_path']}")
    fallback = secrets_dir() / f"{sid}.txt"
    if fallback.exists():
        return fallback
    legacy = repo / _LEGACY_IN_REPO_SECRETS[sid] if sid in _LEGACY_IN_REPO_SECRETS else None
    if legacy and legacy.exists():
        print(f"WARNING secret_path('{sid}'): resolved to the PRE-MIGRATION in-repo path {legacy}. "
              f'Move it: mv "{legacy}" "{fallback}" && chmod 600 "{fallback}"', file=os.sys.stderr)
        return legacy
    raise FileNotFoundError(
        f"secret_path('{sid}'): not found. Looked in system/credentials-ledger.json (id='{sid}', "
        f"field local_path) and {fallback}. Register it in the ledger or place the file.")


def secret(repo: Path, sid: str) -> str:
    """Read a credential's value, trimmed. Warns (never throws) on a too-permissive mode."""
    p = secret_path(repo, sid)
    try:
        if os.name != "nt" and (p.stat().st_mode & 0o077) != 0:
            print(f"WARNING secret('{sid}'): {p} is mode {p.stat().st_mode & 0o777:o}; expected 600. "
                  f'Run: chmod 600 "{p}"', file=os.sys.stderr)
    except OSError:
        pass
    v = p.read_text(encoding="utf-8").strip()
    if not v:
        raise ValueError(f"secret('{sid}'): the file at {p} is empty")
    return v


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
