'use strict';
/*
 * system/recall/lib/lessons.js - the lessons write-path. Recall Spine Phase 3 (the compound step).
 *
 * Every's compound-engineering insight at Alex scale: end every unit of work with a deposited lesson
 * the NEXT session reads. The Close-Out gate already emits an L-line; this turns that text into rows.
 *
 * Dedup by NORMALIZED text (lowercased, whitespace-collapsed, punctuation-stripped): a repeated
 * lesson increments a hit counter instead of duplicating, so "this bit us 4 times" becomes evidence a
 * human gate won't wave through by accident. 3+ hits queues a /self-review promotion candidate (never
 * auto-edits the constitution - that law stands).
 */

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/*
 * P1.7* FUZZY LESSON IDENTITY (2026-08-23, run-47 merged plan).
 *
 * Measured problem: 91 of 92 lessons sat at hits=1 and exactly ONE ever reached 2, so the promotion
 * gate had never fired and could not fire. Root cause is not the threshold, it is the KEY: dedup was
 * exact-normalized-text, so the same lesson written in different words is a brand-new row. Rewording
 * defeats the counter that the whole compounding loop depends on.
 *
 * The fix is ECC's stable-id-plus-confidence insight expressed under Alex's zero-token law: compare
 * token sets, same class only, and bump the best match above a conservative threshold. Deliberately
 * NOT an embedding (no model call, no new dependency, no network); Jaccard over content tokens is
 * enough to catch a rewording and cheap enough to run inside the nightly harvest.
 *
 * Guards against a wrong merge: same-class-only, a conservative floor, a minimum token count so
 * two short lessons cannot collide on stopwords, and the merged raw text is APPENDED to evidence so
 * every merge is auditable and reversible by hand. The human promotion gate is unchanged.
 */
const JACCARD_MIN = 0.6;
const MIN_TOKENS = 4;
const STOP = new Set(['the','a','an','and','or','but','is','was','are','were','be','been','to','of','in','on','at','for','with','that','this','it','its','as','by','from','not','no','never','always','when','then','than','so','if','you','your','we','our','i']);

/*
 * Light suffix stripping, measured need: the first fixture pair ("coexists"/"coexisting",
 * "reporting"/"reports") scored 0.556 and missed the 0.6 floor purely on morphology, which is the
 * commonest way the SAME lesson gets written twice. Stemming fixes the cause; lowering the floor
 * would have papered over it and raised the false-merge rate everywhere else. Deliberately crude
 * (no Porter, no dependency): four rules, applied to content tokens only.
 */
function stem(w) {
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokens(normText) {
  return new Set(String(normText).split(' ')
    .filter((w) => w && w.length > 2 && !STOP.has(w))
    .map(stem));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Best same-class current lesson whose token set overlaps `norm` at or above the floor. */
function findFuzzyMatch(db, cls, norm) {
  const mine = tokens(norm);
  if (mine.size < MIN_TOKENS) return null; // too short to match safely
  let best = null; let bestScore = 0;
  const rows = db.prepare('SELECT id, lesson, norm, hits, evidence FROM lessons WHERE class=? AND t_invalid IS NULL').all(cls);
  for (const r of rows) {
    const score = jaccard(mine, tokens(r.norm));
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= JACCARD_MIN ? { row: best, score: bestScore } : null;
}

/**
 * Insert a lesson, or bump the hit count of the lesson it repeats (exact-norm first, then fuzzy).
 *
 * PROMOTION THRESHOLD IS 2 (was 3, lowered 2026-08-23 with the fuzzy key): with a working key the
 * bar is reachable, and a lesson seen twice is already a pattern worth a human look. The promotion
 * itself still only PROPOSES, behind the existing /self-review human gate.
 *
 * @returns {{action:'insert'|'bump'|'merge', id:number, hits:number, promote:boolean, score?:number}}
 */
function upsertLesson(db, { date, source_runid = null, cls, lesson, evidence = null,
                            quarantined = 0, source_file = null, source_line = null, origin = null }) {
  const norm = normalize(lesson);
  if (!norm) throw new Error('upsertLesson: empty lesson text');
  const ts = nowIso();

  const bump = (row, action, score) => {
    const hits = row.hits + 1;
    // Audit trail for a fuzzy merge: keep the variant wording so a wrong merge is visible + undoable.
    let ev = row.evidence || null;
    if (action === 'merge') {
      const note = `[merged ${ts} score=${score.toFixed(2)}] ${String(lesson)}`;
      ev = ev ? `${ev} | ${note}` : note;
      db.prepare('UPDATE lessons SET hits=?, evidence=? WHERE id=?').run(hits, ev, row.id);
    } else {
      db.prepare('UPDATE lessons SET hits=? WHERE id=?').run(hits, row.id);
    }
    return { action, id: row.id, hits, promote: hits >= 2, score };
  };

  const exact = db.prepare('SELECT * FROM lessons WHERE norm=? AND t_invalid IS NULL').get(norm);
  if (exact) return bump(exact, 'bump');

  // Quarantined (untrusted-origin) lessons never merge into trusted rows: a poisoned line must not
  // inflate the hit counter of a real lesson. They land as their own inert rows.
  if (!quarantined) {
    const fuzzy = findFuzzyMatch(db, cls, norm);
    if (fuzzy && !fuzzy.row.quarantined) return bump(fuzzy.row, 'merge', fuzzy.score);
  }

  const info = db.prepare(
    `INSERT INTO lessons(date, source_runid, class, lesson, norm, evidence, hits, t_valid,
                         quarantined, source_file, source_line, harvested_at, origin)
     VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?)`
  ).run(date || ts.slice(0, 10), source_runid, cls, String(lesson), norm, evidence, ts,
        quarantined ? 1 : 0, source_file, source_line, ts, origin);
  return { action: 'insert', id: Number(info.lastInsertRowid), hits: 1, promote: false };
}

/**
 * Parse an L-line from a Close-Out Report. Returns null for `L: none` / non-matches.
 *
 * MATCHES THE L SEGMENT ANYWHERE IN THE LINE, and treats the colon as optional. Both are
 * deliberate, and this is the 2026-07-29 fix for the "compounding loop is half open" finding.
 *
 * The original form anchored on `^L:` after trimming the whole line. No scheduled automation has
 * ever written it that way: every one of them emits its Close-Out Report as a SINGLE line with
 * middle-dot separators, e.g.
 *   `Close-Out [morning-brief]: A1 N/A · ... · L: class=verification lesson="..." evidence=... · Verdict: COMPLETE`
 * so `^L:` matched nothing, and email-triage writes `L class=` with no colon at all. The result was
 * that the lessons table sat at 0 rows for the four days the ledger was live while lesson-harvest.js
 * ran nightly and reported success, because finding nothing to parse is indistinguishable from
 * there being nothing to find. The lessons were in the logs the whole time.
 *
 * The lesson of the lesson: parse what the reports ACTUALLY contain, not what the template draws.
 * A format contract enforced only by asking a model to emit a line in a particular position is not
 * a contract. Covered by scripts/tests/test-lesson-parse.js with the real log lines as fixtures.
 */
function parseLLine(line) {
  const s = String(line).trim();
  const allowed = new Set(['propagation', 'verification', 'cost', 'security', 'process']);
  // Real lesson first, so a stray "none" elsewhere in a long report line cannot mask it.
  // evidence runs to the next middle-dot separator or end of line (it often contains spaces).
  const m = s.match(
    /(?:^|[^A-Za-z0-9])L:?\s*class=([a-z]+)\s+lesson="([^"]+)"(?:\s+evidence=(.+?))?\s*(?:·|$)/i
  );
  if (m) {
    const cls = m[1].toLowerCase();
    const evidence = m[3] ? m[3].trim() : null;
    return { cls: allowed.has(cls) ? cls : 'process', lesson: m[2].trim(), evidence: evidence || null };
  }
  // `L: none` / `L none` anywhere in the line = a deliberate no-lesson run.
  if (/(?:^|[^A-Za-z0-9])L:?\s*none\b/i.test(s)) return null;
  return null;
}

module.exports = { upsertLesson, parseLLine, normalize, findFuzzyMatch, tokens, jaccard, JACCARD_MIN };
