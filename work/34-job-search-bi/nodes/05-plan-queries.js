'use strict';
/*
 * 05-plan-queries.js - the search window, then one item per unit of work.
 *
 * THE WINDOW, and Shaheen's own reason for it.
 *   FIRST run of a lane covers first_run_window_hours (168h, seven days), detected by last_run_at
 *   being EMPTY. Every later run covers the time since the last successful run plus one hour of
 *   margin, and never less than min_window_hours (24h).
 *   His reason for "since the last run" rather than a flat 24 hours: a fixed 24 hour window on the
 *   Monday run misses everything posted between Friday morning and Sunday. The floor is the other
 *   half of the same idea, two runs in one morning must not collect an empty window and report a
 *   healthy zero.
 *
 * HOW THE WINDOW REACHES EACH SOURCE, and they are not the same mechanism.
 *   LinkedIn does it SERVER SIDE: f_TPR=r<seconds>, so the window is baked into the URL.
 *   Every board is cut LOCALLY on its own publish timestamp, so every item carries window_start as
 *   an ISO string and the date_field plus date_format from the contract, because the three formats
 *   in play are unix seconds, ISO with an offset and ISO with no offset at all.
 *   Remotive is the exception that has to be stated rather than absorbed: they delay every job by
 *   24 hours as a deliberate attribution policy (D8), so a 24 hour cut sees almost nothing from
 *   them. Its item carries window_start_effective, shifted back by that lag, plus the lag itself,
 *   so Stage E cuts correctly and the run report can say WHY that source's window is different.
 *   A healthy looking zero from a source that is structurally a day behind is exactly the failure
 *   D8 exists to prevent.
 *
 * WHAT ONE UNIT IS.
 *   LinkedIn: one per search term x location. The Swedish forms in search_terms_sv go ONLY to the
 *   Sweden queries, which is the entire reason they are a separate key: one merged list would fire
 *   BI-utvecklare at the remote EU boards.
 *   Boards: one per enabled board, whole feed or one page, filtered locally.
 *   Indeed (Bright Data): one per term x location, and it emits NOTHING while its switch is off,
 *   which is the shipped default because it is the only source that bills per record.
 *   Every source_<key> switch is honoured: a disabled source emits nothing at all and is named in
 *   the plan summary, so "off" and "broken" never look the same in a run report.
 *
 * WHY THE BOARDS ARE CALLED WIDE AND FILTERED LOCALLY.
 *   Three of them accept a narrowing param and all three params are measured as unreliable in the
 *   contract: Himalayas q matches the DESCRIPTION body and not the title (D6), Remotive's
 *   documented category slug did not filter at all (D7), Jobicy's tag is loose free text. Narrowing
 *   on a param that silently does not narrow is how a collector under-collects and still reports
 *   200 and success. So those params are omitted DELIBERATELY, each with its reason carried on the
 *   item, and relevance is Stage E's job against the keep list. Stage C resolves D7 before any
 *   category slug is ever sent.
 *
 * Endpoints, params, date fields, date formats and dedup rules are READ from the shared contract
 * at config/sources.json. Nothing about the outside world is typed into this file.
 */

const { lane, sources } = require('./_lane');
const L = lane();
const SRC = sources().sources;

// ---------------------------------------------------------------------------------------------
// WHAT EACH SOURCE IS, as a unit of work. Asserted against the contract below, so a source added
// or renamed in sources.json fails THIS BUILD rather than silently vanishing from every plan.
// ---------------------------------------------------------------------------------------------
const UNIT_KIND = {
  linkedin_guest_search: 'linkedin',
  linkedin_guest_detail: 'enrichment', // driven per job by Stage B, never its own query unit
  himalayas: 'board',
  remotive: 'board',
  remoteok: 'board',
  workingnomads: 'board',
  jobicy: 'board',
  arbeitnow: 'board',
  brightdata_indeed: 'indeed',
};

// The value the plan supplies for each query placeholder in a board's endpoint template. A value
// of '' means the param is DELIBERATELY OMITTED and the reason is carried on the item.
const BOARD_PLAN = {
  himalayas: {
    values: { q: '', sort: 'recent' },
    omitted: { q: 'q is matched against the DESCRIPTION body, not the title (D6): all four probe hits matched on the body and none on the title. Narrowing on it hides real title matches, so pull recent and let the keep list decide in Stage E.' },
    probes: ['D4', 'D5'],
    note: 'One call. No paging until D5 settles the cursor contract, and D4 settles whether a short response means the end of the results or just the end of the recency window.',
  },
  remotive: {
    values: { category: '' },
    // D7 RESOLVED 2026-09-11 by the Stage D probe, and the answer is not the one the question
    // assumed. The param is not WRONG, it is IGNORED: a call with no category at all came back
    // byte for byte the same as the category=data call, same 16 rows, same eight categories. So
    // there is no correct slug to go and find, and omitting it, which this plan already did for the
    // other reason, turns out to be the only honest option. Dropped from probes because a question
    // with an answer is not a probe; D8 stays because it got WORSE, not better.
    omitted: { category: 'the param is IGNORED, not wrong (D7, settled by probe): a call with no category returned the identical 16 rows and the identical byte count as one with category=data. There is no slug that narrows this feed.' },
    probes: ['D8'],
    publish_lag_hours: 24,
    note: 'Every job here is deliberately 24 hours behind (D8), so its window is shifted by that lag. MEASURED WORSE than documented: on 2026-09-11 the freshest of the 16 rows was 72 hours old, and the whole free feed is 16 jobs (D18). Expect this source to contribute zero on a daily run, and expect the run report to say so with the reason attached rather than printing a healthy zero.',
  },
  remoteok: {
    values: {},
    probes: [],
    whole_feed: true,
    note: 'The whole board arrives in one call, so one call per run. Element 0 of the array is their legal notice, not a job (D11).',
  },
  workingnomads: {
    values: {},
    probes: [],
    whole_feed: true,
    note: 'Whole feed in one call. tags is a comma separated STRING here and an array almost everywhere else (D12).',
  },
  jobicy: {
    values: { count: '100', geo: 'europe', tag: '' },
    omitted: { tag: 'free text keyword, loose, and the keep list already does this job in Stage E.' },
    probes: [],
    note: 'geo is a loose REGION filter, not a country filter (D13): europe was echoed back in appliedFilters and honoured, and the rows still span EMEA, UK, Germany, Sweden and Anywhere. A Sweden only pass substring matches jobGeo locally.',
  },
  arbeitnow: {
    values: { page: '1' },
    probes: [],
    note: 'Page 1 only. Jobs update hourly and are ordered newest first, so one page catches everything new. Germany first board, it earns its place on remote rows (D14).',
  },
};

// The settings tab's `locations` strings, mapped to what they mean to LinkedIn. This is the ONE
// place a location becomes a LinkedIn query, and Plan Queries THROWS on a location it does not
// know, rather than dropping it, because a location added to the sheet and quietly ignored is
// invisible in every run report.
//
// geo_id is null for both, and that is deliberate, not an oversight: the contract's `unproven`
// list says only Stockholm 100907646 is confirmed and the Sweden and European Union ids are NOT
// resolved. A geoId nobody verified returns results for the wrong place and looks perfectly
// healthy, so the query goes out with the location STRING and no geoId, and carries
// geo_unresolved so the run report can say which calls ran less precisely than they could.
const LINKEDIN_TARGETS = {
  'Sweden': {
    linkedin: true,
    location: 'Sweden',
    geo_id: null,
    work_type: null, // onsite is fine in Sweden, per his geo_rule, so no work type filter
    country: 'SE',
    swedish_terms: true,
  },
  'Remote EU': {
    linkedin: true,
    location: 'European Union',
    geo_id: null,
    work_type: '2', // 2 = remote
    country: null,
    swedish_terms: false,
  },
  'Remote EMEA': {
    linkedin: false,
    reason: 'EMEA is a work scope, not a place LinkedIn resolves, and no geoId for it has ever been verified. Searching it would return whatever LinkedIn guesses and look perfectly healthy. The remote boards cover this scope instead, which is what they are for.',
    swedish_terms: false,
  },
};

const LINKEDIN_VALUE_KEYS = ['keywords', 'location', 'geoId', 'tpr', 'worktype', 'start'];

// The contract's rate note: a datacenter IP is reported to get 429 or 999 after roughly ten pages,
// and the Hetzner box is a datacenter IP. Unproven from the box, which is why this is a WARNING
// threshold and not a cap: silently dropping search terms to stay under a number would be the
// under-collection this whole stage is built to avoid.
const LINKEDIN_SOFT_CALL_LIMIT = 10;

// D2, SETTLED 2026-09-11 by the Stage C start=10 probe: the guest page size is 10, not the 25 the
// brief claimed, and `start` steps by 10. Both numbers are READ from the contract, never typed, and
// whether D2 is still an open question is read from the contract's OWN discrepancy table. A node
// that carried its own copy of either would go on asking a question the contract has answered, or
// worse, stop asking one it has not.
//
// The consequence is D15 and it is the reason this block exists at all: this lane requests start=0
// and nothing else, so every LinkedIn query is capped at one page. The probe proved page 2 holds ten
// more real jobs for the very first query in the BI plan. Paging is Stage D work; naming the cap
// here is what stops it being invisible in the meantime.
const LINKEDIN_PAGE = (function readPageContract() {
  const s = SRC.linkedin_guest_search;
  const pag = s.pagination || null;
  const verified = !!(pag && pag.verified === true);
  const d2 = (sources().discrepancies || []).find((d) => d.id === 'D2') || null;
  const d2Resolved = !!(d2 && d2.status === 'RESOLVED');

  if (verified !== d2Resolved) {
    throw new Error(
      'Plan Queries: the contract disagrees with itself about D2.\n' +
      '  sources.linkedin_guest_search.pagination.verified = ' + verified + '\n' +
      '  discrepancies D2 status RESOLVED = ' + d2Resolved + '\n' +
      '  One of the two was updated and the other was not. Until they agree, this node cannot say\n' +
      '  honestly whether the page size is a measurement or a guess, and that is the only thing it\n' +
      '  reports about paging.'
    );
  }
  if (verified) {
    if (typeof s.page_size !== 'number' || s.page_size <= 0) {
      throw new Error('Plan Queries: the contract calls LinkedIn paging verified but page_size is ' + JSON.stringify(s.page_size) + '. A verified page size is a number.');
    }
    if (pag.step !== s.page_size) {
      throw new Error('Plan Queries: the contract says the page size is ' + s.page_size + ' and that start steps by ' + pag.step + '. A paging loop built on the smaller of two disagreeing numbers repeats rows, and on the larger it skips them.');
    }
  }
  return { size: verified ? s.page_size : null, step: verified ? pag.step : null, verified: verified };
}());

// Bright Data bills per record, so the trigger carries an explicit cap. 10 is deliberately small:
// the input field names for the Indeed dataset are UNVERIFIED and the first real call is a probe,
// not a collection run.
const INDEED_LIMIT_PER_INPUT = 10;

// --- build-time assertions --------------------------------------------------------------------
// These run on this machine, before anything reaches the box.
function placeholdersOf(tpl) {
  const out = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m;
  while ((m = re.exec(String(tpl)))) out.push(m[1]);
  return out;
}
function sortedEq(a, b) {
  const x = a.slice().sort();
  const y = b.slice().sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

(function assertPlanMatchesContract() {
  const contractKeys = Object.keys(SRC).sort();
  const planKeys = Object.keys(UNIT_KIND).sort();
  if (!sortedEq(contractKeys, planKeys)) {
    throw new Error(
      'Plan Queries: the source contract and this node disagree about which sources exist.\n' +
      '  contract: ' + contractKeys.join(', ') + '\n' +
      '  planned:  ' + planKeys.join(', ') + '\n' +
      '  A source added or renamed in sources.json must be classified here (linkedin / enrichment /\n' +
      '  board / indeed) and, if it is a board, given a BOARD_PLAN entry. Failing the build is the\n' +
      '  point: the alternative is a source that quietly stops being searched.'
    );
  }
  const boards = Object.keys(UNIT_KIND).filter(k => UNIT_KIND[k] === 'board').sort();
  if (!sortedEq(boards, Object.keys(BOARD_PLAN).sort())) {
    throw new Error('Plan Queries: every board needs a BOARD_PLAN entry. boards=' + boards.join(', ') + ' planned=' + Object.keys(BOARD_PLAN).join(', '));
  }
  // Every query placeholder in an endpoint template must have a decided value, and every decided
  // value must correspond to a real placeholder. This is what catches an endpoint changing shape.
  for (const key of boards) {
    const want = placeholdersOf(SRC[key].endpoint);
    const have = Object.keys(BOARD_PLAN[key].values);
    if (!sortedEq(want, have)) {
      throw new Error('Plan Queries: ' + key + ' endpoint asks for {' + want.join('}, {') + '} and BOARD_PLAN supplies ' + (have.length ? have.join(', ') : '(nothing)') + '. Decide every placeholder, or omit it deliberately with a value of "".');
    }
  }
  const liWant = placeholdersOf(SRC.linkedin_guest_search.endpoint);
  if (!sortedEq(liWant, LINKEDIN_VALUE_KEYS)) {
    throw new Error('Plan Queries: the LinkedIn search endpoint asks for {' + liWant.join('}, {') + '} and this node supplies ' + LINKEDIN_VALUE_KEYS.join(', ') + '. The endpoint changed shape.');
  }
  const indWant = placeholdersOf(SRC.brightdata_indeed.endpoint);
  if (!sortedEq(indWant, ['n'])) {
    throw new Error('Plan Queries: the Bright Data trigger endpoint asks for {' + indWant.join('}, {') + '} and this node supplies {n}.');
  }
  for (const k of Object.keys(SRC)) {
    if (UNIT_KIND[k] === 'enrichment') continue;
    if (!SRC[k].date_field || !SRC[k].date_format) {
      throw new Error('Plan Queries: contract source ' + k + ' has no date_field/date_format, so Stage E has nothing to cut the window on.');
    }
  }
}());

// Only what a plan item actually needs travels to the box. The rest of the contract stays in the
// contract, where Stage B and Stage E read it.
const CONTRACT = {};
for (const k of Object.keys(SRC)) {
  CONTRACT[k] = {
    method: SRC[k].method,
    endpoint: SRC[k].endpoint,
    date_field: SRC[k].date_field,
    date_format: SRC[k].date_format,
    dedup_id_rule: SRC[k].dedup_id_rule,
  };
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Plan Queries.
// ---------------------------------------------------------------------------
const cfg = $input.first() ? $input.first().json : null;
if (!cfg || !cfg._meta) {
  throw new Error('Plan Queries: no config on the input. This node runs on the single item Parse Settings emits and on nothing else.');
}

// --- the window ------------------------------------------------------------
const now = new Date();
const runStartedAt = now.toISOString();
const firstRun = !cfg.last_run_at;

let windowHours;
let windowReason;
let hoursSinceLastRun = null;
let lastRunInFuture = false;

if (firstRun) {
  windowHours = cfg.first_run_window_hours;
  windowReason = 'first run: last_run_at is empty, so the window is first_run_window_hours (' + cfg.first_run_window_hours + 'h)';
} else {
  hoursSinceLastRun = (now.getTime() - Date.parse(cfg.last_run_at)) / 3600000;
  lastRunInFuture = hoursSinceLastRun < 0;
  const withMargin = hoursSinceLastRun + 1;
  if (withMargin >= cfg.min_window_hours) {
    windowHours = withMargin;
    windowReason = 'time since last_run_at (' + hoursSinceLastRun.toFixed(2) + 'h) plus 1h of margin';
  } else {
    windowHours = cfg.min_window_hours;
    windowReason = 'floored at min_window_hours (' + cfg.min_window_hours + 'h); only ' + hoursSinceLastRun.toFixed(2) + 'h since the last run';
  }
}

const windowSeconds = Math.max(1, Math.round(windowHours * 3600));
const windowStart = new Date(now.getTime() - windowSeconds * 1000).toISOString();

// --- url assembly ----------------------------------------------------------
// Fills an endpoint template from the contract. A query param whose planned value is empty is
// DROPPED whole rather than sent blank, because an empty param is not the same request as no
// param and nobody has measured which one these boards prefer. A placeholder with no decided
// value THROWS: an endpoint that grew a param nobody planned must not go out half filled.
function fillUrl(tpl, values) {
  const qi = tpl.indexOf('?');
  let base = qi === -1 ? tpl : tpl.slice(0, qi);
  const query = qi === -1 ? '' : tpl.slice(qi + 1);

  base = base.replace(/\\{([a-zA-Z0-9_]+)\\}/g, (m, name) => {
    if (!(name in values) || values[name] === null || values[name] === undefined || values[name] === '') {
      throw new Error('Plan Queries: endpoint path placeholder {' + name + '} has no value: ' + tpl);
    }
    return encodeURIComponent(String(values[name]));
  });

  if (!query) return base;
  const kept = [];
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) { kept.push(pair); continue; }
    const name = pair.slice(0, eq);
    const tok = pair.slice(eq + 1);
    const m = /^\\{([a-zA-Z0-9_]+)\\}$/.exec(tok);
    if (!m) { kept.push(pair); continue; }
    const slot = m[1];
    if (!(slot in values)) {
      throw new Error('Plan Queries: endpoint asks for {' + slot + '} and the plan decided no value for it. Decide it, or omit it deliberately with an empty value: ' + tpl);
    }
    const v = values[slot];
    if (v === null || v === undefined || v === '') continue;
    kept.push(name + '=' + encodeURIComponent(String(v)));
  }
  return kept.length ? base + '?' + kept.join('&') : base;
}

// --- the plan --------------------------------------------------------------
const disabled = [];
const skipped = [];
const warnings = [];
const probeSet = {};
const addProbe = (id) => { probeSet[id] = true; };

const isOn = (sourceKey) => cfg['source_' + sourceKey] === true;
const offReason = (sourceKey) => ({ source: sourceKey, reason: 'source_' + sourceKey + ' is off in the settings tab' });

// LinkedIn: term x location.
const linkedinUnits = [];
const detailOn = isOn('linkedin_guest_detail');

if (!isOn('linkedin_guest_search')) {
  disabled.push(offReason('linkedin_guest_search'));
  if (detailOn) {
    skipped.push({
      what: 'linkedin_guest_detail',
      reason: 'the detail endpoint enriches jobs the SEARCH endpoint found, and the search switch is off, so it has no driver. Its own switch being on changes nothing.',
    });
  }
} else {
  for (const locSetting of cfg.locations) {
    const target = LINKEDIN_TARGETS[locSetting];
    if (!target) {
      throw new Error(
        'Plan Queries: the settings tab lists location ' + JSON.stringify(locSetting) + ' and this node ' +
        'has no LinkedIn target for it. Adding a location to the sheet without teaching this node what ' +
        'it means would drop it from every LinkedIn query silently. Add it to LINKEDIN_TARGETS in ' +
        'nodes/05-plan-queries.js, or take it out of the locations cell.'
      );
    }
    if (!target.linkedin) {
      skipped.push({ what: 'linkedin_guest_search for location "' + locSetting + '"', reason: target.reason });
      continue;
    }
    const terms = cfg.search_terms.map((t) => ({ term: t, lang: 'en' }));
    if (target.swedish_terms) {
      for (const t of cfg.search_terms_sv) terms.push({ term: t, lang: 'sv' });
    }
    for (const t of terms) {
      linkedinUnits.push({
        unit: 'linkedin',
        source: 'linkedin_guest_search',
        method: CONTRACT.linkedin_guest_search.method,
        url: fillUrl(CONTRACT.linkedin_guest_search.endpoint, {
          keywords: t.term,
          location: target.location,
          geoId: target.geo_id,
          tpr: 'r' + windowSeconds,
          worktype: target.work_type,
          start: '0',
        }),
        term: t.term,
        term_language: t.lang,
        location_setting: locSetting,
        location: target.location,
        geo_id: target.geo_id,
        geo_unresolved: target.geo_id === null,
        work_type: target.work_type,
        f_tpr: 'r' + windowSeconds,
        start: 0,
        window_filtered_server_side: true,
        page_size: LINKEDIN_PAGE.size,
        page_size_verified: LINKEDIN_PAGE.verified,
        // start=0 and nothing else. A full page means more was waiting and this lane did not ask.
        paging_built: false,
        detail_enrichment_enabled: detailOn,
        detail_endpoint: detailOn ? CONTRACT.linkedin_guest_detail.endpoint : null,
        probe_required: LINKEDIN_PAGE.verified ? [] : ['D2'],
      });
      if (!LINKEDIN_PAGE.verified) addProbe('D2');
    }
  }
}

// Boards: one per enabled board.
const boardUnits = [];
for (const key of BOARD_KEYS) {
  if (!isOn(key)) { disabled.push(offReason(key)); continue; }
  const plan = BOARD_PLAN[key];
  const lag = plan.publish_lag_hours || 0;
  boardUnits.push({
    unit: 'board',
    source: key,
    method: CONTRACT[key].method,
    url: fillUrl(CONTRACT[key].endpoint, plan.values),
    whole_feed: plan.whole_feed === true,
    omitted_params: plan.omitted || {},
    publish_lag_hours: lag,
    window_start_effective: lag ? new Date(Date.parse(windowStart) - lag * 3600000).toISOString() : windowStart,
    window_filtered_server_side: false,
    note: plan.note,
    probe_required: (plan.probes || []).slice(),
  });
  for (const p of (plan.probes || [])) addProbe(p);
}

// Indeed via Bright Data: term x location, and nothing at all while the switch is off.
const indeedUnits = [];
if (!isOn('brightdata_indeed')) {
  disabled.push({
    source: 'brightdata_indeed',
    reason: 'source_brightdata_indeed is off in the settings tab. It is the only source that bills per record and the Bright Data account has lapsed before, so off is the shipped default. Turning it on is a cost decision, not a config tweak.',
  });
} else {
  for (const locSetting of cfg.locations) {
    const target = LINKEDIN_TARGETS[locSetting];
    if (!target || !target.linkedin) {
      skipped.push({ what: 'brightdata_indeed for location "' + locSetting + '"', reason: 'no resolvable place for this location setting' });
      continue;
    }
    for (const term of cfg.search_terms) {
      indeedUnits.push({
        unit: 'indeed',
        source: 'brightdata_indeed',
        method: CONTRACT.brightdata_indeed.method,
        url: fillUrl(CONTRACT.brightdata_indeed.endpoint, { n: String(INDEED_LIMIT_PER_INPUT) }),
        term: term,
        location_setting: locSetting,
        location: target.location,
        country: target.country,
        limit_per_input: INDEED_LIMIT_PER_INPUT,
        billed_per_record: true,
        input_shape_unverified: true,
        window_filtered_server_side: false,
        note: 'The Indeed dataset input field names and output shape are UNVERIFIED. The first call is a two record probe, not a collection run, and the branch has to survive a dead Bright Data account without failing the run.',
        probe_required: ['brightdata-input-shape'],
      });
      addProbe('brightdata-input-shape');
    }
  }
  warnings.push('brightdata_indeed is ON. It bills per record, its input shape is unverified, and it is capped at ' + INDEED_LIMIT_PER_INPUT + ' records per input by this plan.');
}

// --- warnings that belong in the run report, not in a comment ---------------
if (linkedinUnits.length > LINKEDIN_SOFT_CALL_LIMIT) {
  warnings.push(
    'this plan emits ' + linkedinUnits.length + ' LinkedIn calls, above the ' + LINKEDIN_SOFT_CALL_LIMIT +
    ' that a datacenter IP is reported to tolerate before 429 or 999, and the box is a datacenter IP. ' +
    'Stage B must pace them and treat a 429 or a 999 as a DEGRADED source with a named reason, never as an empty result.'
  );
}
if (linkedinUnits.length && LINKEDIN_PAGE.verified) {
  warnings.push(
    'D15: every LinkedIn call requests start=0 only, and the guest page size is ' + LINKEDIN_PAGE.size +
    ' (D2, settled by probe). So each of the ' + linkedinUnits.length + ' LinkedIn queries is capped at ' +
    LINKEDIN_PAGE.size + ' rows and anything past the first page is never requested. The Stage C probe ' +
    'proved page 2 of the first BI query held ' + LINKEDIN_PAGE.size + ' more real jobs. Paging is not ' +
    'built: it belongs to Stage D and it steps by ' + LINKEDIN_PAGE.step + '.'
  );
}
const unresolvedGeo = linkedinUnits.filter((u) => u.geo_unresolved).length;
if (unresolvedGeo) {
  warnings.push(
    unresolvedGeo + ' LinkedIn call(s) run with a location string and no geoId, because only Stockholm ' +
    '100907646 is confirmed and the Sweden and European Union ids are unresolved. The results are less ' +
    'precise than they could be and that is a known gap, not a fault.'
  );
}
if (!firstRun && windowHours > cfg.first_run_window_hours) {
  warnings.push(
    'the window is ' + windowHours.toFixed(1) + 'h, wider than first_run_window_hours (' + cfg.first_run_window_hours +
    'h), so this run is catching up after a gap. Expect more rows than a normal day and a slower run.'
  );
}
if (lastRunInFuture) {
  warnings.push(
    'last_run_at is in the FUTURE (' + cfg.last_run_at + '). The window fell back to the ' +
    cfg.min_window_hours + 'h floor. Someone hand edited that cell, or a run wrote a bad timestamp.'
  );
}

const units = linkedinUnits.concat(boardUnits, indeedUnits);
if (!units.length) {
  throw new Error(
    'Plan Queries: the plan is empty, so this run would collect nothing and report a healthy zero.\\n' +
    '  disabled: ' + (disabled.map((d) => d.source).join(', ') || 'none') + '\\n' +
    '  skipped:  ' + (skipped.map((s) => s.what).join(', ') || 'none') + '\\n' +
    '  Either every source switch is off, or locations and search_terms resolved to no work.'
  );
}

const planSummary = {
  units: units.length,
  linkedin: linkedinUnits.length,
  boards: boardUnits.length,
  indeed: indeedUnits.length,
  disabled_sources: disabled,
  skipped: skipped,
  probes_outstanding: Object.keys(probeSet).sort(),
  warnings: warnings,
};

const run = {
  lane: LANE_NUMBER,
  run_started_at: runStartedAt,
  first_run: firstRun,
  window_start: windowStart,
  window_end: runStartedAt,
  window_hours: Number(windowHours.toFixed(4)),
  window_seconds: windowSeconds,
  window_reason: windowReason,
  hours_since_last_run: hoursSinceLastRun === null ? null : Number(hoursSinceLastRun.toFixed(4)),
  last_run_at: cfg.last_run_at || null,
  plan: planSummary,
};

const filters = {
  keep_if_title_has: cfg.keep_if_title_has,
  always_drop: cfg.always_drop,
  match_rule: cfg.match_rule,
  geo_rule: cfg.geo_rule,
  language_rule: cfg.language_rule,
};

let seq = 0;
return units.map((u) => {
  seq += 1;
  const c = CONTRACT[u.source];
  return {
    json: Object.assign({}, u, {
      seq: seq,
      of: units.length,
      lane: LANE_NUMBER,
      // The cut line, on every item, as an ISO string. Boards that carry a publish lag also carry
      // window_start_effective and that is the one Stage E cuts on.
      window_start: windowStart,
      window_end: runStartedAt,
      window_start_effective: u.window_start_effective || windowStart,
      publish_lag_hours: u.publish_lag_hours || 0,
      date_field: c.date_field,
      date_format: c.date_format,
      dedup_id_rule: c.dedup_id_rule,
      filters: filters,
      run: run,
    }),
  };
});
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/05-plan-queries.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const CONTRACT = ${JSON.stringify(CONTRACT)};`,
  `const BOARD_PLAN = ${JSON.stringify(BOARD_PLAN)};`,
  `const BOARD_KEYS = ${JSON.stringify(Object.keys(UNIT_KIND).filter(k => UNIT_KIND[k] === 'board'))};`,
  `const LINKEDIN_TARGETS = ${JSON.stringify(LINKEDIN_TARGETS)};`,
  `const LINKEDIN_SOFT_CALL_LIMIT = ${JSON.stringify(LINKEDIN_SOFT_CALL_LIMIT)};`,
  `const LINKEDIN_PAGE = ${JSON.stringify(LINKEDIN_PAGE)};`,
  `const INDEED_LIMIT_PER_INPUT = ${JSON.stringify(INDEED_LIMIT_PER_INPUT)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Plan Queries',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [780, 100],
  connectFrom: 'Parse Settings',
  notes: 'Derives the search window, then emits one item per unit of work. A disabled source emits nothing and is named in the plan summary.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
