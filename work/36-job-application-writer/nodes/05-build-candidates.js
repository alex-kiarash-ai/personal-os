'use strict';
/*
 * 05-build-candidates.js - "Build Candidates". The intake stage, and the node that decides what
 * this run is allowed to spend money on.
 *
 * =============================================================================================
 * 1. WHAT THIS NODE IS FOR, in one line: it turns two spreadsheet reads into a ranked, capped,
 * costed, url-guarded list of pairs, and it emits a report even when that list is empty.
 * =============================================================================================
 *
 * =============================================================================================
 * 2. THE PAIRING, AND WHY IT IS THE FIRST THING THAT HAPPENS.
 * =============================================================================================
 * `$input` is two HTTP responses and an HTTP Request node does not carry its input fields through,
 * so a response on its own cannot say which spreadsheet it came from. The authority is
 * $('Seed Lanes').all(): the complete ordered list of lanes, one per call, in the order the calls
 * were made. `pairedItem` is the second opinion where the node set it.
 *
 * If the two lengths disagree, or a pairedItem points somewhere else, this node does NOT guess an
 * alignment. It refuses the whole batch. The failure it is refusing is specific and silent: the BI
 * settings applied to the AI spreadsheet would pass every later check, write AI applications into
 * the BI Drive folder, and tailor from the wrong CV master. The lane guard below would catch this
 * particular case, and the refusal is not built on that: a guard that only works because a second
 * guard exists is one edit away from not working.
 *
 * =============================================================================================
 * 3. THE HEADER ASSERTS, AND THE EMPTY-TAB CASE THEY ALSO CATCH.
 * =============================================================================================
 * The jobs tab is read as fifteen columns BY POSITION, so a header that has moved means every cell
 * read after it is the wrong field. The header is compared to shared_row_shape, in order, before a
 * single row is read, and a mismatch refuses the lane and names the first column that differs.
 *
 * The applications header is asserted for the same reason and for one more: a tab with NO header at
 * all is the degenerate case where an append invents a header out of the first item and returns a
 * perfectly healthy 200. #34 records that behaviour from the n8n source. An empty header here is a
 * refusal rather than an empty list.
 *
 * =============================================================================================
 * 4. THE DAILY CAP IS COUNTED, NOT ASSUMED.
 * =============================================================================================
 * D11 is ten pairs a day. Per RUN it would be ten pairs per execution, and two manual re-runs in
 * one morning would write twenty applications and spend twice the money. So the cap is counted:
 * writer_runs is read, today's rows for this lane are summed on their `attempted` column, and the
 * run may admit the remainder and nothing more.
 *
 * `attempted` counts pairs ADMITTED TO THE READER, not pairs shipped. A pair that was read, cost
 * money and then failed a gate has still been attempted, and a cap that forgave it would let a bad
 * morning spend the day cap twice over.
 *
 * WHAT HAPPENS BEFORE THAT TAB EXISTS. It does not exist in either spreadsheet yet. Google fails a
 * values:batchGet whose ranges name a missing sheet with a 400 for the WHOLE request, so until the
 * tab is created every lane is refused here by name, with the remedy in the message. That is the
 * right behaviour and not a workaround: a daily cap that cannot count today is not a cap, and this
 * lane spends real money unattended.
 *
 * =============================================================================================
 * 5. THE CAP ARITHMETIC. cap + 2 IN, THE REAL GATE LATER.
 * =============================================================================================
 * Design defect 6 from the plan review: a cap consumed by BLOCKED pairs under delivers. If the cap
 * is three and the top three all turn out to be onsite jobs in a remote-only scope, a run that
 * admitted exactly three ships nothing, while the fourth and fifth qualifiers sat in the sheet.
 *
 * So intake admits cap + intake_overshoot (two), and the REAL cap gate runs in Parse Job Brief,
 * after the D10 verdicts, taking the top `cap` survivors. The overshoot is paid for whether or not
 * it is needed, which is why it is two and not five: each overshoot pair costs one opus-5 read.
 *
 * Every qualifier BEYOND cap + 2 is stamped skipped:cap here and travels through the workflow
 * untouched, so the write-back half stamps its jobs.status cell in the same batch write. D11 is
 * literal about what that means: a skipped row is NOT re-written the next day. Typing `new` back
 * into the cell re-queues it, from the phone, with no rebuild.
 *
 * =============================================================================================
 * 6. THE COST GUARD IS PESSIMISTIC BY CONSTRUCTION.
 * =============================================================================================
 * Every call in the chain is priced at FULL input price with no cache credit, at the worst case
 * token counts each stage can actually reach given the caps this design already enforces (a 12,000
 * character ad, an 8,000 character site read, a one page CV, a 280 word letter). So the estimate is
 * always above the bill, and the guard can only ever refuse too early, never too late.
 *
 * The estimate assumes every admitted pair goes the whole way. Most do not: a pair blocked at the
 * D10 gate costs one read and stops. That is the direction the error should run in.
 *
 * The build REFUSES a configuration where the default budget cannot pay for the default daily cap.
 * A guard that bites on the ordinary case is not a guard, it is a silent cap nobody chose.
 *
 * =============================================================================================
 * 7. THE URL GUARD.
 * =============================================================================================
 * The ad url comes out of a spreadsheet cell that was written by a collector that read it off a job
 * board. It is attacker-influenced text and this workflow is going to fetch it from inside the
 * docker network on the n8n box, where gotenberg, the n8n API itself and every other container are
 * reachable by name. So: https only, no credentials in the url, no port other than 443, no IP
 * literal, no private range, no single-label host (which is what a docker service name looks like),
 * and no .internal or .local suffix. A url that fails is not an error: the pair simply gets no
 * fetch url, takes the false side of Fetch Route, and falls back to the row excerpt.
 *
 * =============================================================================================
 * 8. THE SCOPE, AND THE THING THE SHEET DOES NOT CARRY.
 * =============================================================================================
 * The amended D10 says to branch on the _filter.scope the collector stamps rather than re-deriving
 * geography. That field does not survive to the sheet: the jobs tab is fifteen columns and none of
 * them is scope. See the long note on collectorScopes() in _lane.js. What this node does instead is
 * resolve the scope from the location cell using the very token table and precedence
 * order, read out of 20-filter.js at build time, and stamp it as scope_source
 * recovered_from_location so nothing downstream can mistake it for the collector verdict.
 *
 * The `remote` cell is read as three-valued on purpose: yes, no, and empty. Empty is NOT onsite.
 * The amendment is explicit that treating null as onsite would silently block the entire Gulf and
 * non-EU Europe intake while every count upstream looked healthy.
 */

const LN = require('./_lane');

const L = LN.lane();
const LANE_ROWS = LN.lanes();
const CAPS = LN.caps();
const JOBS_COLUMNS = LN.jobsColumns();
const APPLICATIONS_COLUMNS = LN.APPLICATIONS_COLUMNS;
const WRITER_RUNS_COLUMNS = LN.WRITER_RUNS_COLUMNS;
const SCOPES = LN.collectorScopes();
const LINKEDIN_DETAIL_TEMPLATE = LN.linkedinDetailTemplate();

// ---------------------------------------------------------------------------------------------
// THE SETTINGS SCHEMA for this workflow. Four keys, all of them NEW: neither settings tab carries a
// phase2_ row today, which is exactly why every one has a default. A default that needs a hand edit
// before it applies is not a default, and Shaheen already has hand edits queued.
//
// The decoders mirror the encoder both collectors use, byte for byte:
//   switch  the cell holds the literal text on / off
//   number  Number(String(v).trim())
// ---------------------------------------------------------------------------------------------
const SETTINGS_SPEC = {
  phase2_enabled: {
    type: 'switch',
    fallback: 'on',
    why: 'the master switch. Off means this lane collects and scores as usual and writes no applications, which is the safe state for a morning when something upstream is wrong.',
  },
  phase2_daily_cap: {
    type: 'number',
    fallback: CAPS.values.daily_cap,
    clamp_max: CAPS.values.hard_max_pairs,
    clamp_min: 0,
    why: 'D11, ten pairs a day. Clamped to hard_max_pairs in code so a hand edited cell cannot raise it.',
  },
  phase2_max_cost_per_run_usd: {
    type: 'number',
    fallback: CAPS.values.max_cost_per_run_usd,
    clamp_max: CAPS.values.hard_max_cost_per_run_usd,
    clamp_min: 0,
    why: 'the per lane spend ceiling for one run, clamped to the hard maximum in code.',
  },
  phase2_min_score: {
    type: 'number',
    fallback: CAPS.values.min_score,
    floor: CAPS.values.min_score,
    why: 'D3, his own words: more than 69. 70 is the default AND the floor, so a settings edit can raise the bar and cannot lower it.',
  },
};

// ---------------------------------------------------------------------------------------------
// THE COST MODEL. Six calls per shipped pair, each priced at full input price with no cache credit.
//
// EVERY TOKEN NUMBER IS TIED TO A CAP THIS DESIGN ALREADY ENFORCES, so the estimate is checkable
// rather than invented, and so the next seat can correct it against measured usage:
//   read      the ad is capped at ad_text_max_chars (12,000 chars, about 3,000 tokens) plus the
//             recruiter rubric. Output is the reader max_tokens ceiling.
//   research  the company site read is capped at 8,000 characters, about 2,000 tokens.
//   select    the model view of the master is a 1,200 word CV, about 2,500 tokens, plus the brief.
//   write     the selection, the brief, the soul voice block and the letter rubric.
//   rewrite   the same request object plus the audit reasons as a second user turn.
//   grade     the two documents plus the rubric, and nothing else: the grader sees no reasoning.
//
// PRICES come from _lane.js, which read them off the claude-api model table on 2026-09-15 and
// cross checks the overlap against the table the collectors already use. A wrong price makes both the guard
// and the run report fiction rather than data.
// ---------------------------------------------------------------------------------------------
const COST_MODEL = [
  { stage: 'read', model: LN.STAGE_MODELS.read, in_tokens: 5000, out_tokens: CAPS.values.read_max_tokens },
  { stage: 'research', model: LN.STAGE_MODELS.research, in_tokens: 3000, out_tokens: 1024 },
  // RAISED 2048 -> 16384 on 2026-09-16, on measured evidence from letter-eval execution 5425.
  // All six eval calls came back HTTP 200 with stop_reason max_tokens, output_tokens 2048 of which
  // thinking_tokens 2048, and NO text block at all: the model spent the entire ceiling reasoning and
  // emitted zero characters of letter. The eval reported 6 x no_letter, which is why it keeps that
  // outcome apart from a failed check.
  // CAUSE, and it is a property of the model not of the prompt: on claude-sonnet-5 and claude-opus-5
  // OMITTING the `thinking` parameter runs ADAPTIVE thinking, and max_tokens caps thinking and text
  // TOGETHER. The same correction was already applied to the read row on 2026-09-15 (2048 -> 4096)
  // for exactly this reason; these three rows were missed because only the reader had been analysed.
  // SCOPE, derived from the model table rather than from taste: the two sonnet-4-6 rows are NOT
  // raised, because on 4.6 omitting `thinking` means no thinking at all. Only the three rows whose
  // model thinks by default are exposed.
  // WHY 3072 AND NOT THE 16384 THE FOUR LIVE JOB LANES USE. 16384 was tried first and the offline
  // suite refused it: at that ceiling the default 4.00 USD per-lane budget pays for 8 pairs, not the
  // default cap of 10, and the coherence guard that refuses a config whose budget cannot pay for its
  // own cap fired exactly as designed. 3072 is the largest round value that keeps budget and cap
  // coherent (the three rows share roughly 0.164 USD of headroom per pair at 45 USD/MTok combined).
  // So the ceiling alone cannot buy enough room, and the other half of this fix is REDUCING the
  // thinking rather than paying for more of it: builders 10, 24 and 29 now send
  // output_config.effort = 'low'. Raising the budget instead is a real money decision about spend
  // per day and it is Shaheen's, not this file's.
  // FIT IT AGAIN once there is a measurement: the next eval run prints real thinking_tokens.
  { stage: 'select', model: LN.STAGE_MODELS.select, in_tokens: 5000, out_tokens: 3072 },
  { stage: 'write', model: LN.STAGE_MODELS.write, in_tokens: 7000, out_tokens: 3072 },
  { stage: 'rewrite', model: LN.STAGE_MODELS.rewrite, in_tokens: 9000, out_tokens: 3072 },
  { stage: 'grade', model: LN.STAGE_MODELS.grade, in_tokens: 4000, out_tokens: 1024 },
];

function callCost(c) {
  const p = LN.prices(c.model);
  return (c.in_tokens / 1e6) * p.in_per_mtok + (c.out_tokens / 1e6) * p.out_per_mtok;
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;

const COST_PER_STAGE = COST_MODEL.map((c) => ({ stage: c.stage, model: c.model, usd: round6(callCost(c)) }));
const COST_PER_PAIR_FULL = round6(COST_PER_STAGE.reduce((a, s) => a + s.usd, 0));
// An overshoot pair that loses the cap gate at Parse Job Brief has paid for exactly one read.
const COST_PER_PAIR_READ_ONLY = round6(COST_PER_STAGE[0].usd);

// ---------------------------------------------------------------------------------------------
// THE URL GUARD tables. Hosts are matched as whole labels, never as substrings, because a
// substring rule would refuse `gotenberg-jobs.example.com` and a label rule refuses `gotenberg`.
// ---------------------------------------------------------------------------------------------
const BLOCKED_HOST_LABELS = ['localhost', 'gotenberg', 'n8n', 'internal', 'local', 'metadata'];
const BLOCKED_HOST_SUFFIXES = ['.internal', '.local', '.localhost', '.localdomain'];

// The five range names, READ out of Seed Lanes own baked seed rather than restated. This node
// unpacks valueRanges BY POSITION, so the order is a contract between exactly two files and it is
// declared in one of them.
const RANGE_NAMES = (function readRangeNames() {
  const seed = require('./03-seed-lanes.js');
  const src = String(seed.parameters.jsCode || '');
  const at = src.indexOf('const LANES = [');
  if (at === -1) throw new Error('Build Candidates: Seed Lanes no longer bakes a LANES array, and the five range names are read out of it so the two nodes cannot disagree about the order valueRanges arrive in.');
  const end = src.indexOf('];', at);
  const baked = JSON.parse(src.slice(at + 'const LANES = '.length, end + 1));
  const names = baked[0] && baked[0].range_names;
  if (!Array.isArray(names) || names.length !== 5) {
    throw new Error('Build Candidates: Seed Lanes baked ' + JSON.stringify(names) + ' as its range_names. This node reads exactly five valueRanges by position.');
  }
  for (const l of baked) {
    if (!Array.isArray(l.ranges) || l.ranges.length !== names.length) {
      throw new Error('Build Candidates: a baked lane has ' + (l.ranges || []).length + ' range(s) and ' + names.length + ' range name(s). The url and the unpacking would disagree.');
    }
  }
  return names;
}());

(function assertAgainstUpstream() {
  const read = require('./04-read-lane-sheets.js');
  const seed = require('./03-seed-lanes.js');
  if (read.name !== 'Read Lane Sheets') throw new Error('Build Candidates: node 04 is named ' + JSON.stringify(read.name) + ' and this node connects from "Read Lane Sheets".');
  if (seed.name !== 'Seed Lanes') throw new Error('Build Candidates: node 03 is named ' + JSON.stringify(seed.name) + ' and this node reads $(\'Seed Lanes\') for the authoritative lane order.');

  // fullResponse is what makes a 4xx readable as data instead of invisible. Without it there is no
  // status code, and the missing writer_runs tab becomes an unexplained empty body.
  const resp = read.parameters.options && read.parameters.options.response && read.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error(
      'Build Candidates: Read Lane Sheets no longer sets fullResponse AND neverError.\n' +
      '  This node reads statusCode off the item to tell a missing tab from a lapsed credential from a\n' +
      '  rate limit. Without them a 4xx either throws or arrives with no status at all, and the run\n' +
      '  cannot tell "no new jobs" from "the sheet refused the read".'
    );
  }
  if (read.executeOnce === true) {
    throw new Error(
      'Build Candidates: Read Lane Sheets is executeOnce, so it fires ONCE and returns one response.\n' +
      '  This node pairs one response per lane by position and would refuse the whole batch. Two lanes\n' +
      '  means two spreadsheets and two calls.'
    );
  }

  LN.assertPricesAgreeWithCollector();
  LN.assertColumnsAgainstSeed();

  // THE CONFIGURATION HAS TO BE ABLE TO DELIVER ITS OWN DEFAULT CAP.
  // A guard that bites on the ordinary case is a silent cap nobody chose, so a default budget that
  // cannot pay for a default-cap day fails the BUILD rather than trimming every single run.
  const worstFullDay = round6(CAPS.values.daily_cap * COST_PER_PAIR_FULL + CAPS.values.intake_overshoot * COST_PER_PAIR_READ_ONLY);
  if (worstFullDay > CAPS.values.max_cost_per_run_usd) {
    throw new Error(
      'Build Candidates: a full day at the default cap costs at most $' + worstFullDay.toFixed(4) + ' and the default\n' +
      '  budget is $' + CAPS.values.max_cost_per_run_usd.toFixed(2) + '. The cost guard would trim the cap on EVERY ordinary run,\n' +
      '  which is a silent cap nobody chose rather than a guard.\n' +
      '  Per pair worst case: ' + JSON.stringify(COST_PER_STAGE) + '\n' +
      '  Either raise caps.max_cost_per_run_usd in lane.json, lower caps.daily_cap, or correct the token\n' +
      '  assumptions in COST_MODEL against measured usage. Do not just raise the clamp.'
    );
  }
  if (worstFullDay > CAPS.values.hard_max_cost_per_run_usd) {
    throw new Error('Build Candidates: a full day at the default cap costs more than the hard clamp, so the clamp would be unreachable and meaningless.');
  }

  // The scope table has to have been READ, not restated. If collectorScopes() ever starts returning
  // a table this file declared, the whole point of reading it is gone.
  if (SCOPES.read_from.indexOf('34-job-search-bi') === -1) {
    throw new Error('Build Candidates: the scope table did not come from the collector node. It is read from there so #36 and the collectors can never hold two different copies of it.');
  }
  if (!SCOPES.remote_only.length) {
    throw new Error('Build Candidates: no collector scope is remote_only, so the amended D10 work type block can never fire.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Candidates. Pair, assert, decode, count, rank, cap, cost, guard, emit.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

// --- 1. the authority on which lane is which --------------------------------
let seeds;
try {
  seeds = $('Seed Lanes').all();
} catch (e) {
  throw new Error('Build Candidates: cannot reach Seed Lanes (' + e.message + '). Every lane fact and the run stamp came from there, and without it this node cannot say which spreadsheet answered.');
}
const laneSeeds = seeds.map((i) => i.json);
const responses = $input.all();

let pairing = 'ok';
let pairingWhy = null;
if (responses.length !== laneSeeds.length) {
  pairing = 'mismatch';
  pairingWhy = 'Seed Lanes emitted ' + laneSeeds.length + ' lane(s) and Read Lane Sheets returned ' + responses.length +
    ' response(s). Refusing to guess an alignment: one lane settings block applied to the other spreadsheet ' +
    'passes every later check and tailors from the wrong CV master.';
} else {
  for (let i = 0; i < responses.length; i += 1) {
    const pi = responses[i] && responses[i].pairedItem;
    const idx = pi && typeof pi === 'object' && !Array.isArray(pi) ? pi.item : (Array.isArray(pi) && pi.length ? pi[0].item : undefined);
    if (idx !== undefined && Number(idx) !== i) {
      pairing = 'mismatch';
      pairingWhy = 'response ' + i + ' carries pairedItem ' + JSON.stringify(idx) + ', so the responses are not in the order the calls were made. Refusing to guess an alignment.';
      break;
    }
  }
}

// --- 2. small helpers --------------------------------------------------------
function txt(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/\\s+/g, ' ').trim();
}
function norm(v) { return txt(v).toLowerCase(); }
function num(v) {
  const s = txt(v);
  if (!s) return null;
  const n = Number(s.split(',').join('.'));
  return isFinite(n) ? n : null;
}
function rowsOf(vr) { return (vr && Array.isArray(vr.values)) ? vr.values : []; }
function round6(n) { return Math.round(n * 1e6) / 1e6; }

// Header comparison. Returns null when the two agree, or the first disagreement in words.
function headerProblem(actual, expected, what) {
  if (!Array.isArray(actual) || !actual.length) {
    return 'the ' + what + ' tab returned NO header row at all. An append into a tab with no header invents one out of the first item and returns a healthy 200, so an empty header is refused rather than read as an empty tab.';
  }
  if (actual.length !== expected.length) {
    return 'the ' + what + ' header has ' + actual.length + ' column(s) and this run expects ' + expected.length + ': ' + JSON.stringify(actual);
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (norm(actual[i]) !== norm(expected[i])) {
      return 'the ' + what + ' header differs at column ' + (i + 1) + ': the sheet says ' + JSON.stringify(txt(actual[i])) + ' and this run expects ' + JSON.stringify(expected[i]) + '. Every cell is read by POSITION, so one moved column misreads every field after it.';
    }
  }
  return null;
}

// --- 3. the url guard --------------------------------------------------------
// See header note 7. A refusal is never an error: the pair just gets no fetch url.
function isIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\\d{1,3}$/.test(p)) return false;
    if (Number(p) > 255) return false;
  }
  return true;
}
function isPrivateIpv4(host) {
  const p = host.split('.').map(Number);
  if (p[0] === 10) return true;
  if (p[0] === 127) return true;
  if (p[0] === 0) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  return false;
}
function guardUrl(raw) {
  const s = txt(raw);
  if (!s) return { ok: false, why: 'the cell is empty' };
  if (s.length > 2000) return { ok: false, why: 'the url is longer than 2000 characters, which no job board produces and a crafted cell does' };
  if (/^http:/i.test(s)) return { ok: false, why: 'plain http is refused, https only' };
  const m = /^https:\\/\\/([^\\/?#\\s:@]+)(?::(\\d+))?([\\/?#][^\\s]*)?$/i.exec(s);
  if (!m) return { ok: false, why: 'it does not parse as a plain https url with a hostname, or it carries an at sign, which is how credentials are smuggled into a url' };
  const host = m[1].toLowerCase();
  const port = m[2] ? Number(m[2]) : 443;
  if (port !== 443) return { ok: false, why: 'the url names port ' + port + ' and only 443 is allowed' };
  if (isIpv4(host)) {
    if (isPrivateIpv4(host)) return { ok: false, why: 'the host is a PRIVATE ip literal (' + host + '), which from inside the docker network reaches the box itself' };
    return { ok: false, why: 'the host is an ip literal (' + host + ') rather than a name, and no job board publishes one' };
  }
  if (host.indexOf(':') !== -1 || host.charAt(0) === '[') return { ok: false, why: 'the host looks like an ipv6 literal' };
  const labels = host.split('.');
  if (labels.length < 2) {
    return { ok: false, why: 'the host ' + JSON.stringify(host) + ' is a single label, which on the box is a docker service name (gotenberg, n8n) rather than a public site' };
  }
  for (const bad of BLOCKED_HOST_LABELS) {
    if (labels.indexOf(bad) !== -1) return { ok: false, why: 'the host contains the label ' + JSON.stringify(bad) + ', which names infrastructure on the box rather than a job board' };
  }
  for (const suf of BLOCKED_HOST_SUFFIXES) {
    if (host.length > suf.length && host.slice(-suf.length) === suf) return { ok: false, why: 'the host ends in ' + JSON.stringify(suf) + ', which is an internal name' };
  }
  return { ok: true, url: s, host: host };
}

// --- 4. the scope, recovered ------------------------------------------------
// The token table and the precedence order are the COLLECTOR ones, read at build time. Only the
// matcher is local, and every stamped scope says so. See header note 8.
function tokenMatch(hay, tok) {
  const t = String(tok).toLowerCase();
  if (!t) return false;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(t, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : hay.charAt(at - 1);
    const after = at + t.length >= hay.length ? '' : hay.charAt(at + t.length);
    const wordish = /[a-z0-9]/;
    const okBefore = before === '' || !wordish.test(before);
    const okAfter = after === '' || !wordish.test(after);
    if (okBefore && okAfter) return true;
    from = at + 1;
  }
}
function resolveScope(location) {
  const loc = norm(location);
  if (!loc) return { scope: null, why: 'the location cell is empty, so no scope can be recovered' };
  for (const key of GEO_PRECEDENCE) {
    const t = GEO_TARGETS[key];
    if (!t) continue;
    for (const tok of t.tokens) {
      if (tokenMatch(loc, tok)) return { scope: key, why: 'the location cell names ' + JSON.stringify(tok), token: tok };
    }
  }
  return { scope: null, why: 'no collector scope token matched the location cell' };
}
// yes / no / empty, and empty is NOT no. The amendment is explicit about this.
function remoteCell(v) {
  const s = norm(v);
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return null;
}

// --- 5. settings -------------------------------------------------------------
function decodeSettings(rows) {
  const raw = {};
  for (const r of rows) {
    if (!Array.isArray(r) || !r.length) continue;
    const k = txt(r[0]);
    if (!k || norm(k) === 'key') continue;
    raw[k] = r.length > 1 ? r[1] : '';
  }
  const out = {};
  const source = {};
  const notes = [];
  for (const key of Object.keys(SETTINGS_SPEC)) {
    const spec = SETTINGS_SPEC[key];
    const present = Object.prototype.hasOwnProperty.call(raw, key);
    if (spec.type === 'switch') {
      if (!present) { out[key] = spec.fallback === 'on'; source[key] = 'node default'; continue; }
      const cell = norm(raw[key]);
      if (cell === 'on') { out[key] = true; source[key] = 'settings tab'; }
      else if (cell === 'off') { out[key] = false; source[key] = 'settings tab'; }
      else {
        out[key] = spec.fallback === 'on';
        source[key] = 'node default';
        notes.push('settings ' + key + ' reads ' + JSON.stringify(txt(raw[key])) + ', which is neither on nor off, so the default was used. The cell holds the literal text on or off, the same encoding both collectors use.');
      }
      continue;
    }
    let v = present ? num(raw[key]) : null;
    if (v === null) {
      if (present) notes.push('settings ' + key + ' reads ' + JSON.stringify(txt(raw[key])) + ', which is not a number, so the default was used.');
      v = spec.fallback;
      source[key] = 'node default';
    } else {
      source[key] = 'settings tab';
    }
    if (spec.clamp_max !== undefined && v > spec.clamp_max) {
      notes.push('settings ' + key + ' asks for ' + v + ' and the hard clamp in code is ' + spec.clamp_max + '. Clamped. ' + spec.why);
      v = spec.clamp_max;
    }
    if (spec.clamp_min !== undefined && v < spec.clamp_min) {
      notes.push('settings ' + key + ' asks for ' + v + ', below the floor of ' + spec.clamp_min + '. Clamped.');
      v = spec.clamp_min;
    }
    if (spec.floor !== undefined && v < spec.floor) {
      notes.push('settings ' + key + ' asks for ' + v + ' and the FLOOR is ' + spec.floor + '. Raised back to the floor. ' + spec.why);
      v = spec.floor;
    }
    out[key] = v;
  }
  return { values: out, source: source, notes: notes, raw_lane_cell: txt(raw.lane) };
}

// --- 6. classify a refused read ---------------------------------------------
function classifySheets(status, body, seed) {
  const msg = (body && body.error && body.error.message) ? String(body.error.message) : '';
  const named = msg.indexOf(seed.writer_runs_tab) !== -1;
  const rangeProblem = /unable to parse range|not found|no sheet|invalid range/i.test(msg);
  if (rangeProblem && named) {
    return {
      kind: 'error:writer_runs_missing',
      why: 'the spreadsheet has no tab called ' + JSON.stringify(seed.writer_runs_tab) + ', and a values:batchGet ' +
        'fails the WHOLE request when one range names a missing sheet, so the four good ranges came back with it. ' +
        'This lane is refused rather than run, because the daily cap is counted out of that tab and a cap that ' +
        'cannot count today is not a cap. FIX: create a tab named ' + JSON.stringify(seed.writer_runs_tab) +
        ' in this spreadsheet with the header row ' + WRITER_RUNS_COLUMNS.join(', ') + '. Google said: ' + msg,
    };
  }
  if (rangeProblem) {
    return { kind: 'error:range', why: 'Google refused one of the five ranges: ' + msg };
  }
  if (status === 401 || status === 403) {
    return { kind: 'error:sheets_auth', why: 'the Google Sheets credential was refused (' + status + '). ' + (msg || 'no message') + ' If the message is about an HTTP Request node rather than about the account, the credential Allowed HTTP Request Domains setting needs to allow sheets.googleapis.com.' };
  }
  if (status === 404) return { kind: 'error:sheets_not_found', why: 'the spreadsheet id in the lane file does not resolve (404). ' + (msg || 'no message') };
  if (status === 429) return { kind: 'error:sheets_rate_limit', why: 'Google rate limited the read (429). ' + (msg || 'no message') };
  if (status >= 500) return { kind: 'error:sheets_upstream', why: 'Google returned ' + status + '. ' + (msg || 'no message') };
  return { kind: 'error:sheets_http_' + status, why: 'HTTP ' + status + '. ' + (msg || 'no message') };
}

// --- 7. per lane -------------------------------------------------------------
const laneReports = [];
const pairItems = [];
const globalWarnings = [];
let totalQualifiers = 0;
let totalAdmitted = 0;
let totalSkippedCap = 0;

function laneReport(seed, state, why, extra) {
  return Object.assign({
    _kind: 'lane_report',
    lane_key: seed.lane_key,
    source_project: seed.source_project,
    label: seed.label,
    spreadsheet_id: seed.spreadsheet_id,
    state: state,
    why: why,
    run_date: seed.run_date,
    exec_id: seed.exec_id,
    run_started_at: seed.run_started_at,
    _call_now: false,
    ad_fetch_url: '',
  }, extra || {});
}

if (pairing === 'mismatch') {
  globalWarnings.push('PAIRING REFUSED. ' + pairingWhy);
  for (const seed of laneSeeds) {
    laneReports.push(laneReport(seed, 'error:pairing', pairingWhy));
  }
} else {
  for (let i = 0; i < laneSeeds.length; i += 1) {
    const seed = laneSeeds[i];
    const item = responses[i] || {};
    const j = item.json || {};

    if (j.error !== undefined && j.statusCode === undefined) {
      laneReports.push(laneReport(seed, 'error:transport', 'the sheet read never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 300)));
      continue;
    }
    const status = Number(j.statusCode);
    if (!isFinite(status)) {
      laneReports.push(laneReport(seed, 'error:transport', 'the response carried no statusCode. fullResponse is set on Read Lane Sheets, so a missing status means the item is not an HTTP response at all.'));
      continue;
    }
    if (status < 200 || status >= 300) {
      const c = classifySheets(status, j.body, seed);
      laneReports.push(laneReport(seed, c.kind, c.why, { http_status: status }));
      continue;
    }

    const vrs = (j.body && Array.isArray(j.body.valueRanges)) ? j.body.valueRanges : null;
    if (!vrs || vrs.length !== RANGE_NAMES.length) {
      laneReports.push(laneReport(seed, 'error:ranges', 'the read returned ' + (vrs ? vrs.length : 'no') + ' valueRange(s) and this node reads ' + RANGE_NAMES.length + ' BY POSITION (' + RANGE_NAMES.join(', ') + '). A different count means the url and this node have come apart.'));
      continue;
    }

    const settingsRows = rowsOf(vrs[0]);
    const jobsRows = rowsOf(vrs[1]);
    const appIdRows = rowsOf(vrs[2]);
    const appHeaderRows = rowsOf(vrs[3]);
    const runsRows = rowsOf(vrs[4]);

    // --- headers, before a single cell is read as data ---
    const jobsProblem = headerProblem(jobsRows[0], JOBS_COLUMNS, 'jobs');
    if (jobsProblem) { laneReports.push(laneReport(seed, 'error:jobs_header', jobsProblem)); continue; }
    const appProblem = headerProblem(appHeaderRows[0], APPLICATIONS_COLUMNS, 'applications');
    if (appProblem) { laneReports.push(laneReport(seed, 'error:applications_header', appProblem)); continue; }

    // --- settings, and the lane guard ---
    const st = decodeSettings(settingsRows);
    const wantLane = String(seed.source_project);
    if (st.raw_lane_cell && st.raw_lane_cell !== wantLane) {
      laneReports.push(laneReport(seed, 'error:lane_guard',
        'the settings tab of this spreadsheet says lane ' + JSON.stringify(st.raw_lane_cell) + ' and the lane file points it at collector #' + wantLane + '. ' +
        'The two spreadsheet ids have been crossed, or one id in the lane file is wrong. Refused: running on would tailor from the wrong CV master and write into the wrong Drive folder.'));
      continue;
    }
    if (!st.raw_lane_cell) {
      globalWarnings.push('lane ' + seed.lane_key + ': the settings tab has no lane cell, so the guard that proves this spreadsheet belongs to collector #' + wantLane + ' could not run. Every other check passed.');
    }

    if (!st.values.phase2_enabled) {
      laneReports.push(laneReport(seed, 'skipped:disabled', 'phase2_enabled is off in the settings tab of this lane, so it collects and scores as usual and writes no applications. That is a switch, not a fault.', { settings: st.values, settings_source: st.source }));
      continue;
    }

    // --- the daily cap, counted out of writer_runs ---
    const dateCol = WRITER_RUNS_COLUMNS.indexOf('date');
    const laneCol = WRITER_RUNS_COLUMNS.indexOf('lane');
    const attemptedCol = WRITER_RUNS_COLUMNS.indexOf('attempted');
    let attemptedToday = 0;
    let runRowsToday = 0;
    let runsHeaderSeen = false;
    for (const r of runsRows) {
      if (!Array.isArray(r) || !r.length) continue;
      if (norm(r[dateCol]) === 'date') { runsHeaderSeen = true; continue; }
      if (txt(r[dateCol]) !== String(seed.run_date)) continue;
      if (txt(r[laneCol]) !== wantLane) continue;
      runRowsToday += 1;
      attemptedToday += (num(r[attemptedCol]) || 0);
    }
    if (!runsHeaderSeen && runsRows.length) {
      globalWarnings.push('lane ' + seed.lane_key + ': the writer_runs tab has rows but no header, so the columns were read by position on faith. The write seat writes the header ' + WRITER_RUNS_COLUMNS.join(', ') + '.');
    }

    const dailyCap = st.values.phase2_daily_cap;
    const remaining = Math.max(0, dailyCap - attemptedToday);
    const capNotes = [];
    if (attemptedToday > 0) {
      capNotes.push(runRowsToday + ' earlier run row(s) today already attempted ' + attemptedToday + ' pair(s) on this lane, so the day cap of ' + dailyCap + ' leaves ' + remaining + '. The cap is a DAY cap, counted out of writer_runs, so a second run in one morning cannot spend it twice.');
    }
    if (remaining === 0) {
      laneReports.push(laneReport(seed, 'skipped:daily_cap_reached',
        'the day cap of ' + dailyCap + ' pair(s) has already been attempted on this lane today (' + attemptedToday + ' across ' + runRowsToday + ' run row(s)). Nothing is read and nothing is written.',
        { settings: st.values, settings_source: st.source, attempted_today: attemptedToday }));
      continue;
    }

    // --- the already-written set ---
    const written = {};
    let writtenCount = 0;
    for (let k = 0; k < appIdRows.length; k += 1) {
      const cell = txt(appIdRows[k] && appIdRows[k][0]);
      if (!cell) continue;
      if (k === 0 && norm(cell) === 'job_id') continue;
      if (!written[cell]) { written[cell] = true; writtenCount += 1; }
    }

    // --- the qualifiers ---
    const minScore = st.values.phase2_min_score;
    const counts = { rows: 0, not_new: 0, below_score: 0, no_score: 0, already_written: 0, no_job_id: 0, qualified: 0 };
    const qualifiers = [];
    let newestFoundAt = '';
    for (let k = 1; k < jobsRows.length; k += 1) {
      const raw = jobsRows[k];
      if (!Array.isArray(raw) || !raw.length) continue;
      counts.rows += 1;
      const row = {};
      for (let c = 0; c < JOBS_COLUMNS.length; c += 1) row[JOBS_COLUMNS[c]] = raw.length > c ? raw[c] : '';
      const jobId = txt(row.job_id);
      const foundAt = txt(row.found_at);
      if (foundAt > newestFoundAt) newestFoundAt = foundAt;
      if (!jobId) { counts.no_job_id += 1; continue; }
      if (norm(row.status) !== 'new') { counts.not_new += 1; continue; }
      const score = num(row.fit_score);
      if (score === null) { counts.no_score += 1; continue; }
      if (score < minScore) { counts.below_score += 1; continue; }
      if (written[jobId]) { counts.already_written += 1; continue; }
      counts.qualified += 1;
      qualifiers.push({ row: row, job_id: jobId, fit_score: score, found_at: foundAt, sheet_row: k + 1 });
    }

    // Rank: score desc, then found_at desc. An empty found_at sorts last rather than first, because
    // a blank cell is an unknown date and an unknown date is not the freshest thing in the sheet.
    qualifiers.sort(function (a, b) {
      if (b.fit_score !== a.fit_score) return b.fit_score - a.fit_score;
      const af = a.found_at || '';
      const bf = b.found_at || '';
      if (af === bf) return a.job_id < b.job_id ? -1 : (a.job_id > b.job_id ? 1 : 0);
      if (!af) return 1;
      if (!bf) return -1;
      return af < bf ? 1 : -1;
    });

    // --- the cap, plus the overshoot ---
    const intake = remaining + CAPS.intake_overshoot;
    let admitted = qualifiers.slice(0, intake);
    let cappedOut = qualifiers.slice(intake);
    if (cappedOut.length) {
      capNotes.push(cappedOut.length + ' qualifier(s) beyond the intake of ' + intake + ' (cap ' + remaining + ' plus an overshoot of ' + CAPS.intake_overshoot + ') are stamped skipped:cap in this same batch write. D11 is literal: they are NOT re-written tomorrow. Typing new back into the status cell re-queues one.');
    }

    // --- the cost guard, per lane ---
    const budget = st.values.phase2_max_cost_per_run_usd;
    const costOf = function (n) {
      const full = Math.min(n, remaining);
      const readOnly = Math.max(0, n - remaining);
      return round6(full * COST_PER_PAIR_FULL + readOnly * COST_PER_PAIR_READ_ONLY);
    };
    let laneCostRefused = 0;
    while (admitted.length > 0 && costOf(admitted.length) > budget) {
      cappedOut.unshift(admitted.pop());
      laneCostRefused += 1;
    }
    if (laneCostRefused) {
      capNotes.push('THE COST GUARD BIT: ' + laneCostRefused + ' admitted pair(s) were handed back because the pessimistic worst case for this lane would have passed the budget of $' + budget.toFixed(2) + '. Worst case per shipped pair is $' + COST_PER_PAIR_FULL.toFixed(4) + ' and per overshoot pair $' + COST_PER_PAIR_READ_ONLY.toFixed(4) + '. The estimate prices every call at full input price with no cache credit, so it is always above the bill.');
    }

    const laneEstimate = costOf(admitted.length);

    laneReports.push(laneReport(seed, admitted.length ? 'ok' : 'no_candidates',
      admitted.length ? (admitted.length + ' pair(s) admitted of ' + counts.qualified + ' qualifier(s).')
        : (counts.qualified ? 'every qualifier was capped or refused on cost this run.' : 'no row in this jobs tab is status new, scoring ' + minScore + ' or more, and not already in applications. That is an ordinary quiet day.'),
      {
        settings: st.values,
        settings_source: st.source,
        settings_notes: st.notes,
        attempted_today: attemptedToday,
        daily_cap: dailyCap,
        cap_remaining: remaining,
        intake: intake,
        counts: counts,
        qualifiers: counts.qualified,
        admitted: admitted.length,
        skipped_cap: cappedOut.length,
        cost_estimate_usd: laneEstimate,
        cost_budget_usd: budget,
        cost_refused: laneCostRefused,
        newest_found_at: newestFoundAt,
        already_written_rows: writtenCount,
        cap_notes: capNotes,
      }));

    totalQualifiers += counts.qualified;
    totalAdmitted += admitted.length;
    totalSkippedCap += cappedOut.length;

    // --- the pairs ---
    function basePair(q, rank) {
      const row = q.row;
      const scope = resolveScope(row.location);
      const remote = remoteCell(row.remote);
      const rule = scope.scope && GEO_TARGETS[scope.scope] ? GEO_TARGETS[scope.scope].work_types : null;
      return {
        _kind: 'pair',
        _status: null,
        lane_key: seed.lane_key,
        source_project: seed.source_project,
        label: seed.label,
        spreadsheet_id: seed.spreadsheet_id,
        jobs_tab: seed.jobs_tab,
        applications_tab: seed.applications_tab,
        writer_runs_tab: seed.writer_runs_tab,
        drive_parent_folder_id: seed.drive_parent_folder_id,
        master_key: seed.master_key,
        cv_master_frozen: seed.cv_master_frozen,
        run_started_at: seed.run_started_at,
        run_date: seed.run_date,
        exec_id: seed.exec_id,
        job_id: q.job_id,
        sheet_row: q.sheet_row,
        rank: rank,
        fit_score: q.fit_score,
        found_at: q.found_at,
        company: txt(row.company),
        title: txt(row.title),
        location: txt(row.location),
        source: txt(row.source),
        url: txt(row.url),
        apply_url: txt(row.apply_url),
        posted_at: txt(row.posted_at),
        excerpt: txt(row.excerpt),
        fit_reasons: txt(row.fit_reasons),
        remote: remote,
        _scope: {
          scope: scope.scope,
          work_type_rule: rule,
          why: scope.why,
          token: scope.token || null,
          scope_source: 'recovered_from_location',
          note: 'the collector stamps _filter.scope in its own workflow and the jobs TAB carries fifteen columns, none of which is scope. This value was recovered here from the location cell using the very token table and precedence order the collector itself decides with, read out of 20-filter.js at build time. It is a RECOVERY, not the collector verdict, and must never be reported as one.',
        },
        _cap: {
          daily_cap: dailyCap,
          attempted_today: attemptedToday,
          cap: remaining,
          intake: intake,
          overshoot: CAPS.intake_overshoot,
          rule: 'intake admits cap plus overshoot and the REAL cap gate runs in Parse Job Brief, after the D10 verdicts, so a cap consumed by blocked pairs does not under deliver.',
        },
        _budget: {
          max_cost_per_run_usd: budget,
          per_pair_worst_usd: COST_PER_PAIR_FULL,
          per_read_worst_usd: COST_PER_PAIR_READ_ONLY,
          estimate_usd: laneEstimate,
        },
        _cost: { usd: 0, calls: [] },
      };
    }

    for (let r = 0; r < admitted.length; r += 1) {
      const p = basePair(admitted[r], r + 1);
      // The ad url. LinkedIn rows go to the contract guest-detail endpoint by numeric id; everything
      // else uses its own url cell. Both through the guard.
      const isLinkedIn = /linkedin/i.test(p.source) || /^li-\\d+$/i.test(p.job_id);
      let candidateUrl = '';
      let urlKind = '';
      if (isLinkedIn) {
        const numeric = p.job_id.replace(/^li-/i, '');
        if (/^\\d+$/.test(numeric)) {
          candidateUrl = LINKEDIN_DETAIL_TEMPLATE.split('{job_id}').join(numeric);
          urlKind = 'linkedin guest detail, built from the shared source contract template';
        } else {
          candidateUrl = p.url;
          urlKind = 'the row url: the job_id does not carry a numeric LinkedIn posting id, so no detail url could be built';
        }
      } else {
        candidateUrl = p.url;
        urlKind = 'the row url cell';
      }
      const g = guardUrl(candidateUrl);
      p.ad_fetch_url = g.ok ? g.url : '';
      p.ad_fetch_host = g.ok ? g.host : null;
      p.ad_fetch_kind = urlKind;
      p.ad_fetch_why = g.ok ? 'passed the url guard' : ('NO FETCH: ' + g.why + '. The row excerpt is used instead, which is a smaller read rather than a failure.');
      p._call_now = p.ad_fetch_url !== '';
      pairItems.push({ json: p, pairedItem: { item: 0 } });
    }

    for (let r = 0; r < cappedOut.length; r += 1) {
      const p = basePair(cappedOut[r], admitted.length + r + 1);
      p._status = 'skipped:cap';
      p._status_why = laneCostRefused && r < laneCostRefused
        ? 'the pessimistic cost guard refused this pair: the worst case for this lane would have passed the run budget of $' + budget.toFixed(2) + '.'
        : 'it qualified and ranked below the intake of ' + intake + ' pair(s) for today. D11: it is NOT re-written tomorrow. Typing new back into its status cell re-queues it.';
      p.ad_fetch_url = '';
      p.ad_fetch_host = null;
      p.ad_fetch_kind = 'none: a capped pair is never fetched and never read';
      p.ad_fetch_why = 'skipped:cap, so no money is spent on it';
      p._call_now = false;
      pairItems.push({ json: p, pairedItem: { item: 0 } });
    }
  }
}

// --- 8. the stage report ------------------------------------------------------
const lanesOk = laneReports.filter((r) => r.state === 'ok').length;
const lanesRefused = laneReports.filter((r) => String(r.state).indexOf('error:') === 0);
if (lanesRefused.length) {
  globalWarnings.push(lanesRefused.length + ' lane(s) were REFUSED and wrote nothing: ' + lanesRefused.map((r) => r.lane_key + ' (' + r.state + ')').join(', ') + '. A refused lane leaves every one of its rows at status new, so the next run offers them again.');
}
if (!pairItems.length && !lanesRefused.length) {
  globalWarnings.push('nothing was admitted this run. That is an ordinary quiet morning on a lane whose jobs are already written, and it is also what a lane with phase2 switched off looks like. The per lane reports say which.');
}

const report = {
  _kind: 'stage_report',
  stage: 'intake',
  workflow_lane: WORKFLOW_LANE,
  pairing: { state: pairing, why: pairingWhy, lanes: laneSeeds.length, responses: responses.length },
  lanes_ok: lanesOk,
  lanes_refused: lanesRefused.length,
  qualifiers: totalQualifiers,
  admitted: totalAdmitted,
  skipped_cap: totalSkippedCap,
  pairs_emitted: pairItems.length,
  to_fetch: pairItems.filter((p) => p.json._call_now === true).length,
  cost_model: { per_pair_worst_usd: COST_PER_PAIR_FULL, per_read_worst_usd: COST_PER_PAIR_READ_ONLY, per_stage: COST_PER_STAGE, rule: 'every call priced at full input price with no cache credit, at the worst case token count each stage can reach under the caps this design already enforces. The estimate is always above the bill.' },
  scope_recovery: {
    source: 'the collector GEO_TARGETS and GEO_PRECEDENCE, read out of 20-filter.js at build time',
    note: 'the jobs tab carries no scope column, so the _filter.scope the collector stamps does not reach this workflow. Every pair carries scope_source recovered_from_location and the D10 gate in Parse Job Brief says so in its verdict.',
    scopes: GEO_PRECEDENCE,
    remote_only: REMOTE_ONLY_SCOPES,
  },
  warnings: globalWarnings,
  _call_now: false,
  ad_fetch_url: '',
};

// Pairs first, then one report per lane, then this one. NEVER an empty array: the run with nothing
// to do is the run whose report matters most, and a Code node returning [] ends the branch.
const laneItems = laneReports.map((r) => ({ json: r, pairedItem: { item: 0 } }));
return pairItems.concat(laneItems, [{ json: report, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/05-build-candidates.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const JOBS_COLUMNS = ' + JSON.stringify(JOBS_COLUMNS) + ';',
  'const APPLICATIONS_COLUMNS = ' + JSON.stringify(APPLICATIONS_COLUMNS) + ';',
  'const WRITER_RUNS_COLUMNS = ' + JSON.stringify(WRITER_RUNS_COLUMNS) + ';',
  'const RANGE_NAMES = ' + JSON.stringify(RANGE_NAMES) + ';',
  'const SETTINGS_SPEC = ' + JSON.stringify(SETTINGS_SPEC) + ';',
  'const CAPS = ' + JSON.stringify(CAPS.values) + ';',
  'const GEO_TARGETS = ' + JSON.stringify(SCOPES.targets) + ';',
  'const GEO_PRECEDENCE = ' + JSON.stringify(SCOPES.precedence) + ';',
  'const REMOTE_ONLY_SCOPES = ' + JSON.stringify(SCOPES.remote_only) + ';',
  'const LINKEDIN_DETAIL_TEMPLATE = ' + JSON.stringify(LINKEDIN_DETAIL_TEMPLATE) + ';',
  'const BLOCKED_HOST_LABELS = ' + JSON.stringify(BLOCKED_HOST_LABELS) + ';',
  'const BLOCKED_HOST_SUFFIXES = ' + JSON.stringify(BLOCKED_HOST_SUFFIXES) + ';',
  'const COST_PER_STAGE = ' + JSON.stringify(COST_PER_STAGE) + ';',
  'const COST_PER_PAIR_FULL = ' + JSON.stringify(COST_PER_PAIR_FULL) + ';',
  'const COST_PER_PAIR_READ_ONLY = ' + JSON.stringify(COST_PER_PAIR_READ_ONLY) + ';',
  'const WORKFLOW_LANE = ' + JSON.stringify(String(L.lane)) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Build Candidates',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [780, 100],
  connectFrom: 'Read Lane Sheets',
  notes: 'The intake stage. Pairs each sheet read back to its lane, asserts both headers before reading a cell, decodes the phase2 settings with defaults and clamps, counts today attempted pairs out of writer_runs so the daily cap is true across re-runs, ranks the qualifiers, admits cap plus two, stamps every other qualifier skipped:cap in the same batch, refuses on a pessimistic cost estimate, and builds a guarded ad fetch url per pair. Emits pair items, one report per lane and its own stage report, never an empty array.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
