#!/usr/bin/env node
/*
 * capture-typed-input.js - auto-capture every typed user message to a local raw transcript,
 * so the soul.md "My Words" harvest never depends on Alex remembering to do it mid-session.
 *
 * This is the TYPED-channel twin of the voice loop's save_transcript() in
 * work/voice/alex_voice.py. The voice side was already guaranteed code; the typed side was only
 * a standing rule (could be skipped under load). This closes that gap (wired 2026-07-07).
 *
 * Wired as a UserPromptSubmit hook in .claude/settings.json. It runs on every prompt submit.
 *
 * HARD RULES (a log write must never harm Shaheen's message):
 *   - Never write to stdout. UserPromptSubmit stdout is injected into the model context; anything
 *     printed here would silently pollute the conversation. Only ever touch the transcript file.
 *   - Never throw, never exit non-zero. Exit code 2 would BLOCK/erase his prompt. Always exit 0.
 *   - outputs/ is gitignored, so these transcripts are local-only (same privacy tier as voice).
 *
 * Kept verbatim: no cleanup. The imperfections (ESL-direct phrasing, run-ons, dropped -s) ARE the
 * signal the corpus wants, per soul.md's voice-transcription rule.
 */

// P3.3 kill-switch (run-47 merged plan, 2026-08-23): `set ALEX_DISABLED_HOOKS=capture-typed-input`
// makes this hook a silent no-op for the session, without editing .claude/settings.json mid-flight.
if (String(process.env.ALEX_DISABLED_HOOKS || '').split(',').map((s) => s.trim()).includes('capture-typed-input')) {
  process.exit(0);
}

const fs = require('fs');
const path = require('path');

function main(raw) {
  let prompt = '';
  try {
    prompt = (JSON.parse(raw || '{}').prompt || '').trim();
  } catch (_) {
    return; // unparseable stdin -> drop silently
  }
  if (!prompt) return;                  // empty submit
  if (prompt.startsWith('/') || prompt.startsWith('<')) {
    // Slash-command / harness-wrapper messages are not his prose - dropped. BUG-18 fix (2026-07-15):
    // if the message does NOT look like a real command/wrapper it may be genuine prose being lost
    // from the corpus, so breadcrumb it - NEVER to the transcript (keeps the corpus clean), NEVER to
    // stdout (HARD RULE), just a local skips log so a dropped line is at least discoverable.
    const looksLikeCommand = /^\/[\w-]+(\s|$)/.test(prompt);
    // A01-T16 / A15-T14 (2026-09-10): this was /^<[\w!/-]/ and `\w` matches any letter or digit, so
    // ANY prose opening with `<` was classed as a harness wrapper and dropped: `<3 this feature`,
    // `<80 chars is fine`, `<name> should be the key`. Worse, it went through the WRAPPER branch,
    // which leaves no breadcrumb, so the corpus lost those lines with no trace - the exact class
    // BUG-18's breadcrumb exists to make discoverable. It now matches real wrapper tag shapes only.
    const looksLikeWrapper = /^<\/?(?:command-name|command-message|command-args|system-reminder|task-notification|local-command-[\w-]+|[\w-]+-context)\b/.test(prompt);
    // NOTE: prose starting with `<` is still NOT stored in the transcript. That is deliberate and
    // predates this fix - the outer gate drops every `<`-opening message to keep the corpus clean,
    // and the breadcrumb is how a dropped line stays discoverable. This change restores the
    // breadcrumb for real prose; it does not change the capture policy, which is the author's call.
    if (!looksLikeCommand && !looksLikeWrapper) {
      try {
        const d = new Date(); const p = (n) => String(n).padStart(2, '0');
        const st = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        fs.mkdirSync(path.join(__dirname, '..', 'outputs', 'logs'), { recursive: true });
        fs.appendFileSync(path.join(__dirname, '..', 'outputs', 'logs', 'typed-capture-skips.log'),
          `${st} dropped-maybe-prose len=${prompt.length}\n`, 'utf8');
      } catch (_) { /* never harm the prompt */ }
    }
    return;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const dir = path.join(__dirname, '..', 'outputs', 'typed', 'transcripts');
  const file = path.join(dir, `${day}.md`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, `# Typed transcript ${day} (raw typed messages, for soul.md My Words harvest)\n\n`, 'utf8');
    }
    // one bullet per message; collapse internal newlines so a multi-line paste stays a single entry,
    // words otherwise untouched (verbatim) EXCEPT a pasted secret, which is replaced by its shape
    // (stress-test A10-T12, 2026-09-09: a provider key and a JWT sat verbatim in two transcripts,
    // rode the nightly encrypted backup to the box and fed the soul harvester; a key is never
    // "his words").
    // Cap the stored bullet (A01-T16). A 2 MB paste would otherwise become one 2 MB line in a file
    // the soul harvester reads and the nightly encrypted backup carries. 64 KB is far past any real
    // message, and the truncation says so, so a reader knows the line is not the whole of it.
    const collapsed = redactSecrets(prompt.replace(/\r?\n/g, ' ').replace(/[ \t]+/g, ' ').trim());
    const line = collapsed.length > 65536
      ? `${collapsed.slice(0, 65536)} [truncated at 64 KB by capture-typed-input; original was ${collapsed.length} chars]`
      : collapsed;
    fs.appendFileSync(file, `- [${hm}] ${line}\n`, 'utf8');
  } catch (err) {
    // Fail VISIBLE, never fatal (c4, upgrade P1 2026-07-12): a locked file or full disk must not
    // silently eat corpus days. stderr surfaces in hook debug output; the breadcrumb log gives the
    // Monday sweep / a human something to find. Still exit 0 - the prompt is never harmed.
    process.stderr.write(`capture-typed-input: transcript write FAILED (${err.code || err.message})\n`);
    try {
      fs.mkdirSync(path.join(__dirname, '..', 'outputs', 'logs'), { recursive: true });
      fs.appendFileSync(path.join(__dirname, '..', 'outputs', 'logs', 'typed-capture-errors.log'),
        `${day} ${hm} ${err.code || ''} ${String(err.message).slice(0, 200)}\n`, 'utf8');
    } catch (_) { /* disk truly gone; stderr was the last resort */ }
  }
}

// Secret SHAPES, replaced before the append (A10-T12). Deliberately shape-based, never value-based:
// provider keys (sk-..., sk-ant-...), GitHub tokens (ghp_/gho_/github_pat_), Slack (xox?-), AWS
// access keys (AKIA...), JWTs (three base64url segments), and `Bearer`/`X-*-Token:` values. A false
// positive costs one odd-looking word in a private transcript; a miss ships a key to the box.
const SECRET_SHAPES = [
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED:provider-key]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:slack-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\beyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,})+/g, '[REDACTED:jwt]'], // 2 or 3 segments: the 07-28 paste had two
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/g, '$1 [REDACTED:bearer]'],
  [/\b(X-[A-Za-z-]*(?:Token|Key)\s*:\s*)[A-Za-z0-9._~+/=-]{16,}/gi, '$1[REDACTED:header-token]'],
];
function redactSecrets(s) {
  let out = s;
  for (const [re, rep] of SECRET_SHAPES) out = out.replace(re, rep);
  return out;
}

module.exports = { redactSecrets, SECRET_SHAPES };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => { try { main(raw); } catch (_) { /* never harm the prompt */ } process.exit(0); });
  process.stdin.on('error', () => process.exit(0));
}
