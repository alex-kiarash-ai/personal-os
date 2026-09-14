// scripts/lib/n8n-creds.js
// The ONE resolver for the n8n REST base URL + API key, for CommonJS callers.
//
// WHY IT EXISTS (2026-09-14). `FAILED V6: N8N_API_URL and/or N8N_API_KEY env vars missing` is in
// vault/projects/error-log.md FOUR times (2026-07-10, 2026-07-31, and two more sightings), and every
// recorded "fix" was the same manual workaround: export the two variables by hand before running the
// generator. Nobody fixed the cause, so the Close-Out soul-change re-sync trigger silently needed a
// human who remembered a shell incantation, and on 2026-07-31 that cost a real skipped voice sync.
//
// The cause was structural, not carelessness. The sanctioned credential door is `scripts/lib/paths.mjs`
// (`secret`/`hasSecret`/`secretPath`), which is ESM. `validate-alex.js` and the other callers are
// CommonJS and cannot `import` it synchronously, so V6 had nothing to fall back to and read bare env
// vars. One script (`voice-sync-check.js`) solved it by hardcoding the in-repo key path, which is the
// exact thing paths.mjs forbids ("no script may name a credential path again") and which breaks the
// moment the key is migrated out of the repo, as secret-env.mjs is already warning it should be.
//
// So this module crosses the CJS/ESM boundary the only way a synchronous caller can, by shelling out
// to `secret-env.mjs --read`, which keeps every safety property that file was built for: the value
// goes over a pipe into a variable, never onto a command line, so it cannot land in `ps` output or a
// shell history; stdout here is not a TTY, so its anti-shoulder-surfing guard is satisfied without
// --force; and errors carry no value. NO CREDENTIAL PATH IS NAMED HERE. secret-env.mjs resolves the
// id, including the legacy in-repo location and the migrated ~/.config/alex/secrets one, so this file
// keeps working across that move without an edit.
//
// The BASE URL is deliberately not a secret. It is a public hostname and lives in
// system/manifest.json meta.n8n.api_base, so a checker reads it from SSOT rather than a literal.
//
// Contract: never throws, never logs the key. Returns {base, key, source, missing}. `missing` is a
// human-readable reason when either half is unresolved, so each caller keeps its OWN degrade
// behaviour (V6 fails, or warns under pre-commit; landscape-monitor skips a probe).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SECRET_ID = 'n8n-api-key';

function manifestBase() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
    return (m.meta && m.meta.n8n && m.meta.n8n.api_base) || null;
  } catch {
    return null;
  }
}

function keyFromSecretDoor() {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(REPO, 'scripts', 'lib', 'secret-env.mjs'), '--read', SECRET_ID],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }
    );
    const v = (out || '').trim();
    return v || null;
  } catch {
    return null; // absent, empty, or unreadable: the caller decides what that means
  }
}

function n8nCreds() {
  const envBase = (process.env.N8N_API_URL || '').trim();
  const envKey = (process.env.N8N_API_KEY || '').trim();
  const base = envBase || manifestBase();
  const key = envKey || keyFromSecretDoor();

  const why = [];
  if (!base) why.push('no N8N_API_URL and no system/manifest.json meta.n8n.api_base');
  if (!key) why.push(`no N8N_API_KEY and the '${SECRET_ID}' credential did not resolve (see scripts/lib/secret-env.mjs --path ${SECRET_ID})`);

  return {
    base: base || null,
    key: key || null,
    source: { base: envBase ? 'env' : base ? 'manifest' : null, key: envKey ? 'env' : key ? 'secret-env' : null },
    missing: why.length ? why.join('; ') : null,
  };
}

module.exports = { n8nCreds, SECRET_ID };
