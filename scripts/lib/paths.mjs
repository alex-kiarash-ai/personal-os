// scripts/lib/paths.mjs
// The ONE Node answer to "where is X" (bash migration Phase 1, 2026-08-05).
//
// WHY THIS EXISTS: the PowerShell layer hardcoded C:\Users\Thinkpad\Desktop\personal-os in 20
// files and read secrets from literal in-repo paths in ~48 places. Both are migration hazards and
// both are the kind of thing that rots silently. Every Node file ported in Phases 2, 5 and 6
// imports from here and never builds a path by string concatenation.
//
// It is also the resolver that makes ruling A of the migration plan possible: secrets moved OUT of
// the repo to ~/.config/alex/secrets/ are found through system/credentials-ledger.json, so no code
// ever names a credential path again.
//
// Siblings, keep in agreement: scripts/lib/alex_paths.py (Python), scripts/lib/alex-hq-path.js (CJS).
// Node builtins only, by design (see package.json -> nodeNotes.why-no-dependencies).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- ROOT ----------------------------------------------------------------------------------------
// Derived from this file's own location (scripts/lib/ -> repo), never a literal, never cwd.
// ALEX_ROOT overrides it for odd layouts and CI, matching the shell helper in common.sh.
const _here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.ALEX_ROOT
  ? path.resolve(process.env.ALEX_ROOT)
  : path.resolve(_here, '..', '..');

/** Join against the repo root. Use this instead of any string concatenation. */
export const r = (...parts) => path.join(ROOT, ...parts);

// --- variable expansion --------------------------------------------------------------------------
// The manifest's own convention is %USERPROFILE% (a Windows-ism that survives as a data format);
// ${VAR} and a leading ~ are also honored. UNKNOWN VARIABLES ARE LEFT VERBATIM on purpose: a bad
// value then fails loudly on a path still containing % or $, instead of silently resolving to the
// wrong directory. This mirrors alex_paths.py._expand and alex-hq-path.js.expand exactly.
export function expand(s) {
  if (typeof s !== 'string' || s === '') return s;
  let out = s
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, v) => {
      // USERPROFILE has no meaning on Linux/macOS; HOME is the honest equivalent.
      if (v.toUpperCase() === 'USERPROFILE') return process.env.USERPROFILE || os.homedir();
      return process.env[v] !== undefined ? process.env[v] : m;
    })
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, v) => (process.env[v] !== undefined ? process.env[v] : m));
  if (out === '~') out = os.homedir();
  else if (out.startsWith('~/')) out = path.join(os.homedir(), out.slice(2));
  // Accept backslash-separated declared values (Windows-era manifest data) and normalize them.
  if (process.platform !== 'win32' && out.includes('\\') && !out.includes('/')) {
    out = out.replace(/\\/g, '/');
  }
  return out;
}

// --- manifest ------------------------------------------------------------------------------------
let _manifestCache = null;
/** system/manifest.json, parsed. Throws loudly: a missing registry is never something to paper over. */
export function manifest() {
  if (_manifestCache) return _manifestCache;
  const p = r('system', 'manifest.json');
  try {
    _manifestCache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`paths: cannot read the project registry at ${p}: ${e.message}`);
  }
  return _manifestCache;
}

/** meta.paths, with every value expanded. Returns {} rather than throwing if absent. */
export function metaPaths() {
  try {
    const mp = manifest()?.meta?.paths || {};
    const out = {};
    for (const [k, v] of Object.entries(mp)) out[k] = typeof v === 'string' ? expand(v) : v;
    return out;
  } catch {
    return {};
  }
}

// --- secrets (ruling A of the migration plan) -----------------------------------------------------
// Secrets live OUTSIDE the repo at ~/.config/alex/secrets/ (mode 600) and are declared in
// system/credentials-ledger.json (gitignored, local-only), which was already the resolver for the
// gpg passphrase. This function is the ONLY sanctioned way to reach one.
//
// FAILS LOUD, ALWAYS. A credential that cannot be found must never degrade to empty string: an
// empty token turns into a silently-unauthenticated HTTP call that "succeeds" with a 401 body,
// which is precisely the class of silent failure the Close-Out Gate exists to prevent.

/** The secrets directory: $ALEX_SECRETS_DIR, else $XDG_CONFIG_HOME/alex/secrets, else ~/.config/alex/secrets. */
export function secretsDir() {
  if (process.env.ALEX_SECRETS_DIR) return path.resolve(expand(process.env.ALEX_SECRETS_DIR));
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'alex', 'secrets');
}

// MIGRATION FALLBACK, and it is deliberately temporary. Ruling A relocates these four files out of
// the repo during Phase 3, but Phases 2 and 5 land first and must not break in the meantime. So a
// declared id also resolves at its Windows-era in-repo path, with a LOUD warning naming the fix.
// Phase 9 checklist item: delete this map once every secret is relocated and the ledger is the only
// resolver. Keep the .gitignore entries even then (migration plan §6 step 4): a stale ignore rule
// costs nothing and catches a file recreated in the old location by an un-migrated script.
const LEGACY_IN_REPO_SECRETS = {
  'alex-hq-token': 'work/16-alex-hq/config/alex-hq-token.txt',
  'hq-basic-auth': 'work/16-alex-hq/config/hq-basic-auth.txt',
  'n8n-api-key': 'work/03-application-engine/config/n8n-api-key.txt',
  'qra-token': 'work/quota-reset-autorun/config/qra-token.txt',
};

function credentialsLedger() {
  const p = r('system', 'credentials-ledger.json');
  if (!fs.existsSync(p)) return null; // local-only + gitignored: absent in a fresh clone, by design
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`paths: system/credentials-ledger.json is present but unparseable: ${e.message}`);
  }
}

/**
 * Resolve a declared credential to its on-disk path.
 * Order: ledger local_path (expanded) -> secretsDir()/<id>.txt -> throw.
 */
export function secretPath(id) {
  if (!id) throw new Error('paths.secretPath: an id is required');
  const ledger = credentialsLedger();
  const entry = ledger?.credentials?.find((c) => c.id === id);
  if (entry?.local_path) {
    const p = path.resolve(expand(entry.local_path));
    if (fs.existsSync(p)) return p;
    throw new Error(
      `paths.secretPath('${id}'): the ledger declares local_path but nothing exists there. ` +
        `Declared: ${entry.local_path}`
    );
  }
  const fallback = path.join(secretsDir(), `${id}.txt`);
  if (fs.existsSync(fallback)) return fallback;
  const legacy = LEGACY_IN_REPO_SECRETS[id] ? r(LEGACY_IN_REPO_SECRETS[id]) : null;
  if (legacy && fs.existsSync(legacy)) {
    console.error(
      `WARNING paths.secretPath('${id}'): resolved to the PRE-MIGRATION in-repo path ${legacy}. ` +
        `Move it: mkdir -p "${secretsDir()}" && mv "${legacy}" "${path.join(secretsDir(), `${id}.txt`)}" && chmod 600 "${path.join(secretsDir(), `${id}.txt`)}"`
    );
    return legacy;
  }
  throw new Error(
    `paths.secretPath('${id}'): not found. Looked in system/credentials-ledger.json ` +
      `(id='${id}', field local_path), ${fallback}` +
      (legacy ? `, and the pre-migration path ${legacy}` : '') +
      `. Register it in the ledger or place the file.`
  );
}

/**
 * Read a credential's value, trimmed.
 * ALSO WARNS on a too-permissive mode: on a machine holding real credentials, a 644 token is a
 * finding, not a detail. Warns rather than throws so a permissions problem never wedges a
 * scheduled run that would otherwise work.
 */
export function secret(id) {
  const p = secretPath(id);
  try {
    const mode = fs.statSync(p).mode & 0o777;
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
      console.error(
        `WARNING paths.secret('${id}'): ${p} is mode ${mode.toString(8)}; expected 600. Run: chmod 600 "${p}"`
      );
    }
  } catch {
    /* stat failure is not fatal; the read below will report the real problem */
  }
  const v = fs.readFileSync(p, 'utf8').trim();
  if (!v) throw new Error(`paths.secret('${id}'): the file at ${p} is empty`);
  return v;
}

/** Does a credential resolve? For callers that must degrade honestly rather than fail. */
export function hasSecret(id) {
  try {
    secretPath(id);
    return true;
  } catch {
    return false;
  }
}

// --- named surfaces ------------------------------------------------------------------------------
// Everything the ported checkers and the Close-Out Gate reach for, in one place.

export const paths = {
  root: ROOT,
  claudeMd: () => r('CLAUDE.md'),
  soulMd: () => r('soul.md'),
  manifestJson: () => r('system', 'manifest.json'),
  quotaState: () => r('system', 'quota-state.json'),
  travelState: () => r('system', 'travel-state.json'),
  humanActions: () => r('system', 'human-actions.jsonl'),
  pendingWrites: () => r('system', 'pending-writes.jsonl'),
  healMap: () => r('system', 'hq-heal-map.json'),
  credentialsLedger: () => r('system', 'credentials-ledger.json'),
  factsDb: () => r('system', 'recall', 'facts.db'),
  schedulerDoc: () => r('scheduler', 'schedule.md'),
  recoveryCheck: () => r('work', '18-recovery-layer', 'check.mjs'),
  recoveryState: () => r('work', '18-recovery-layer', 'state'),
  outputsLedger: () => r('outputs', 'ledger.jsonl'),
  logDir: () => r('outputs', 'logs'),
  log: (job) => r('outputs', 'logs', `${job}.log`),
  vaultLog: () => r('vault', 'log.md'),
  vaultIndex: () => r('vault', 'index.md'),
  systemdDir: () => r('systemd'),
};

// --- Alex HQ push endpoint ------------------------------------------------------------------------
// The token was read from a literal in-repo path in 8+ PowerShell files. One name now.
export const HQ_TOKEN_ID = 'alex-hq-token';
export const HQ_PUSH_URL = 'https://n8n.shaheenkiarash.com/webhook/alex-push';

// --- platform ------------------------------------------------------------------------------------
// The scheduler layer is Linux-only (ruling C). Callers use this to degrade to a LOUD SKIP on the
// macOS dev machine instead of crashing or, worse, silently doing nothing.
export const isLinux = process.platform === 'linux';
export const isMac = process.platform === 'darwin';

/** Is systemd actually usable here? Cheap check; the scheduler code must not assume. */
export function hasSystemd() {
  return isLinux && fs.existsSync('/run/systemd/system');
}

export default { ROOT, r, expand, manifest, metaPaths, secret, secretPath, hasSecret, secretsDir, paths, isLinux, isMac, hasSystemd, HQ_TOKEN_ID, HQ_PUSH_URL };
