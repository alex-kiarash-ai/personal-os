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
 *   Swedish-language job titles at the remote EU boards, which do not carry them.
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

const { lane, sources, pagingDefaults } = require('./_lane');
const L = lane();
const SRC = sources().sources;
const PAGING_DEFAULTS = pagingDefaults();

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
    // ENDPOINT CHANGED 2026-09-12 (D19) and this is the biggest single collection change in the
    // lane. Until now this plan called /jobs/api/search, which is a SAMPLE surface: it ignores
    // limit, never emits a cursor, and served 7 rows on one query and 2 on another while claiming
    // totalCounts of 105546 and 5000. Two calls under different query strings came back BYTE
    // IDENTICAL on fresh origin hits. /jobs/api is the real feed: 20 ordered rows a page with a
    // working cursor, verified end to end. The row shape is identical, so nothing downstream moved.
    // `cursor` is empty on page 1 and the Board Page Guard fills it for every page after that.
    values: { cursor: '' },
    omitted: { cursor: 'page 1 asks for no cursor. The Board Page Guard reads nextCursor off each response and builds the next url from it, so a cursor never comes from this plan.' },
    probes: [],
    paged: true,
    note: 'PAGED by cursor as of 2026-09-12 (D5 resolved). The feed is ordered pubDate DESCENDING, verified across a page boundary, so the loop pages until the oldest row on a page falls before window_start_effective and stops there. Measured density over the two probe pages is about 4 rows an hour, so a 24h window is on the order of 5 pages. A per-run page cap is the backstop and the collector names the oldest pubDate it actually reached, so a truncated window is sized rather than hidden.',
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
// THE geo_id IS READ FROM THE CONTRACT, never typed here (changed 2026-09-14 with the UK scope).
// It used to be a hardcoded null for both live targets, with the correct reason attached: the
// contract's `unproven` list said only Stockholm was confirmed, and a geoId nobody verified returns
// results for the wrong place and looks perfectly healthy. That reason has not weakened, the ids
// have been PROVEN. sources.json now carries linkedin_guest_search.geo_ids.verified, where each id
// is backed by a two leg probe, and geoLookup below reads it by the LinkedIn location NAME.
//
// Reading rather than restating is the point. A hardcoded id would be a second copy of a fact the
// contract already owns, and the day LinkedIn renumbers a geo there would be two places to fix and
// only one of them would get fixed. An id the contract does not carry still resolves to null here,
// so the query goes out with the location STRING alone and carries geo_unresolved, which is the
// same honest degradation as before.
const CONTRACT_GEO_IDS = (function readGeoIds() {
  const block = SRC.linkedin_guest_search.geo_ids;
  if (!block || typeof block !== 'object') {
    throw new Error(
      'Plan Queries: the contract has no linkedin_guest_search.geo_ids block.\n' +
      '  That block is where a PROVEN LinkedIn geo id lives, and this node reads every geoId from it.\n' +
      '  Without it the node cannot tell a missing id from an unproven one, and those are different.'
    );
  }
  const v = block.verified;
  if (!v || typeof v !== 'object' || !Object.keys(v).length) {
    throw new Error('Plan Queries: linkedin_guest_search.geo_ids carries no `verified` map, so there is no id to read and nothing to say about why.');
  }
  for (const name of Object.keys(v)) {
    const row = v[name];
    if (!row || typeof row.geo_id !== 'string' || !/^\d+$/.test(row.geo_id)) {
      throw new Error('Plan Queries: geo_ids.verified[' + JSON.stringify(name) + '].geo_id is ' + JSON.stringify(row && row.geo_id) + ', which is not a numeric id string.');
    }
    // A verified id with no evidence is a typed id wearing the word verified, which is the exact
    // failure the geo_ids block exists to prevent. Refuse it rather than trusting it.
    if (typeof row.what_the_cards_said !== 'string' || row.what_the_cards_said.length < 40) {
      throw new Error(
        'Plan Queries: geo_ids.verified[' + JSON.stringify(name) + '] carries no readable `what_the_cards_said` evidence.\n' +
        '  An id in the verified map with nothing recorded about what the probe actually returned is indistinguishable\n' +
        '  from a guess, and this node would then send it as if it were a measurement.'
      );
    }
  }
  return v;
}());

function geoLookup(linkedInLocationName) {
  const row = CONTRACT_GEO_IDS[linkedInLocationName];
  return row ? row.geo_id : null;
}

// A scope can be MORE THAN ONE PLACE, and that is why every target carries a LIST (2026-09-15).
//
// Shaheen asked for "the gulf and non EU europe" as two scopes, and neither is one thing LinkedIn
// resolves. The Gulf is three countries and non-EU Europe is two. LinkedIn takes exactly ONE geoId
// per query, which was MEASURED rather than assumed, and both ways of asking for more than one fail
// SILENTLY, which is the reason this is a list here instead of a cleverer url:
//   geoId=<uae>&geoId=<qatar>   HTTP 200, 10 real cards, ALL Qatar. The first id is dropped without
//                               a word, so half the scope vanishes and the run looks perfectly well.
//   geoId=<uae>,<qatar>         HTTP 200, 10 real cards, ALL UNITED STATES (Missouri, Virginia,
//                               Illinois and so on). The joined value is not a geo id, so LinkedIn
//                               falls back to a default scope on the other side of the planet and
//                               still answers 200.
// Both were run on 2026-09-15 against a single-id control that returned the right country. A lane
// that shipped either one would collect the wrong continent and report a healthy number, so the
// only honest shape is one call per id, and the cost of that is the call budget below.
//
// Each entry is {name, id}: `name` is the key in the contract's verified map and `id` is what it
// resolved to. Keeping the name next to the id is what lets the assertion below say WHICH place
// failed to resolve rather than just that something did.
function geoSet(names) {
  return names.map((n) => ({ name: n, id: geoLookup(n) }));
}

// HOW MANY SEARCH TERMS A SCOPE FIRES, and it is a CALL BUDGET knob, never a targeting one.
//
// Base LinkedIn calls are (scopes x terms x geo ids), and that product is the whole problem. With
// the settings tab as it will read after the queued sync, the two lanes measure 15 base calls each
// against a per-run ceiling of 20. Five new ids taking the full term list would be BI 15 + 12 + 8 =
// 35 and AI 15 + 15 + 10 = 40, so the ceiling would cancel paging outright and Stage B would spend
// the run refusing work.
//
// So a target may cap how many of cfg.search_terms it fires. `null` means all of them, which is
// what every pre-existing scope keeps. The two new scopes take 1.
//
// THE MEASUREMENT THAT SAYS WHAT THIS COSTS, because the obvious defence of a 1-term cap is that
// the broadest term is a superset of the narrow ones, and that is FALSE. Measured 2026-09-15
// against the UAE id over one window, comparing page-1 job ids returned by the BI lane's own four
// terms. Against the broadest of the four, the other three each returned 4, 6 and 7 job ids out of
// ten that the broad term's page 1 did not carry at all. (The terms themselves are NOT written here:
// this file is tracked and the repo is public, and his targeting lives in the gitignored settings.)
// LinkedIn re-ranks per query and only returns ten rows a page, so a narrower term surfaces
// DIFFERENT rows rather than a subset. A 1-term scope therefore collects genuinely less than a
// 4-term one would, and that is a real cost, not a rounding error. It is accepted here because the
// alternative is not "more rows", it is a plan the ceiling refuses to run. The run report names the
// trim with its reason so the cost is visible every single run rather than argued once in a comment.
//
// WHICH term the cap keeps is HIS ordering: the first entries of the search_terms cell. Reordering
// that cell is the control, and it is a settings edit rather than a code change.
const ALL_TERMS = null;

const LINKEDIN_TARGETS = {
  'Sweden': {
    linkedin: true,
    location: 'Sweden',
    geo_ids: geoSet(['Sweden']),
    work_type: null, // onsite is fine in Sweden, per his geo_rule, so no work type filter
    work_types_accepted: 'any',
    max_terms: ALL_TERMS,
    country: 'SE',
    swedish_terms: true,
  },
  // ============================================================================================
  // THE FOUR NAMED REMOTE COUNTRIES, 2026-09-17, and they REPLACE 'Remote EU'.
  // ============================================================================================
  // His instruction: "Sweden (onsite, Hyprid, remote). UK and Irland Germany the Netherlands Spain
  // (remote only) then Dubai, Doha, Saudi Arabia (on-site)". Asked directly whether remote jobs from
  // the REST of Europe should stop arriving, he chose "strict: only the five I named", with the
  // measured cost in front of him: on the 2026-09-17 runs that would have dropped 20 of 60 BI rows
  // and 9 of 43 AI rows, all of them remote (Portugal x10, Lithuania x4, Poland, France, Romania,
  // Czechia, Italy, Finland). So 'Remote EU' is not narrowed, it is GONE, and a posting whose
  // location says only "Europe" now matches no scope at all. That is the decision, not a side effect.
  //
  // ONE SEARCH TERM EACH, and that is the budget arithmetic rather than a judgement about the
  // markets. Measured on execution 5474: Sweden costs 7 calls (4 English terms plus 3 Swedish),
  // Remote UK 4, the Gulf 3 (one term across three ids), Non-EU Europe 2. Giving these four ALL_TERMS
  // would cost 16 and take the search leg to 32 against a 25 cap, starving the detail stage that
  // Shaheen capped at 14 BY NAME. One term each costs 4 and leaves the run at 20 calls, exactly what
  // it spends today. If a country turns out to be worth more, raise max_terms for that ONE entry and
  // watch the total; do not raise them all.
  //
  // UK KEEPS ITS OWN SCOPE AND ITS FOUR TERMS. His sentence groups the five countries by WORK TYPE
  // (remote only), not by search depth, and folding the UK into a one-term group would have quietly
  // cut an existing market's coverage by four while adding four new ones. The grouping he wrote is
  // honoured in the FILTER, where all five carry the same remote-only rule.
  //
  // country IS SET on all four, unlike the Gulf and Non-EU Europe which are multi-country and carry
  // null. Bright Data Indeed requires exactly one country; it is off by default in both lanes, and
  // the field is correct so that the day it is switched on these scopes are not silently skipped.
  'Remote Ireland': {
    linkedin: true,
    location: 'Ireland',
    geo_ids: geoSet(['Ireland']),
    work_type: '2', // remote only, and not optional: he has no Irish right to work
    work_types_accepted: 'remote_only',
    max_terms: 1,
    country: 'IE',
    swedish_terms: false,
  },
  'Remote Germany': {
    linkedin: true,
    location: 'Germany',
    geo_ids: geoSet(['Germany']),
    work_type: '2',
    work_types_accepted: 'remote_only',
    max_terms: 1,
    country: 'DE',
    swedish_terms: false,
  },
  'Remote Netherlands': {
    linkedin: true,
    location: 'Netherlands',
    geo_ids: geoSet(['Netherlands']),
    work_type: '2',
    work_types_accepted: 'remote_only',
    max_terms: 1,
    country: 'NL',
    swedish_terms: false,
  },
  'Remote Spain': {
    linkedin: true,
    location: 'Spain',
    geo_ids: geoSet(['Spain']),
    work_type: '2',
    work_types_accepted: 'remote_only',
    max_terms: 1,
    country: 'ES',
    swedish_terms: false,
  },
  // Added 2026-09-14 on Shaheen's words, "I want also to add UK remote positions to the plan".
  // REMOTE ONLY, work_type 2, which is the whole difference from the Sweden target: he has no UK
  // right to work, so an onsite London job is not a job he can take, and collecting it would put a
  // row in front of him that costs him a read and can never become an application. Sweden is the
  // one place onsite is allowed, per his geo_rule, and that stays true.
  //
  // country is 'GB' rather than null and that is load bearing for exactly one source: Bright Data
  // Indeed REQUIRES a country and therefore cannot serve Remote EU, which has none. It can serve
  // this one. The source is still off by default in both lanes and its output shape is unobserved,
  // so nothing turns on here; the field is correct so that the day it is turned on, this scope is
  // not silently skipped for a reason that does not apply to it.
  'Remote UK': {
    linkedin: true,
    location: 'United Kingdom',
    geo_ids: geoSet(['United Kingdom']),
    work_type: '2', // 2 = remote. Not optional here, see above.
    work_types_accepted: 'remote_only',
    max_terms: ALL_TERMS,
    country: 'GB',
    swedish_terms: false, // a Swedish language job title in a UK search would return nothing
  },
  // Added 2026-09-15 on Shaheen's words, "Make it like this Sweden and EMEA (hybrid, onsite,
  // remote), Euorope and UK ( remote only)" and then, answering which EMEA markets he meant,
  // "the gulf and non EU europe, and stop dropping them".
  //
  // ALL WORK TYPES, which is the first scope other than Sweden to allow onsite, and the entire
  // point of it. work_type stays null so no f_WT is sent and the result set is mixed. "stop
  // dropping them" is the instruction that produced the work-type rule in 20-filter.js; this is
  // the half that makes the rows EXIST in the first place, because no board here can serve an
  // onsite job and LinkedIn is the only source that can.
  //
  // WHY THREE COUNTRY IDS AND NOT THE REGION ID, decided on a probe rather than on taste. LinkedIn
  // does publish a Middle East region id (91000001, the same curated 91-series as European Union),
  // and one id would have cost one call instead of three. It was measured on 2026-09-15 and
  // REJECTED: its ten cards were UAE, Egypt, Turkiye and Jordan, with ZERO Qatar and ZERO Saudi
  // Arabia. The region is much wider than the Gulf, so the markets he actually named get crowded
  // out of the only page the guest surface returns, by markets he did not ask for. A cheaper call
  // that answers a different question is not a saving.
  //
  // WHY COUNTRIES AND NOT CITIES, though his own 2026-06-16 config named Dubai, Doha and Riyadh.
  // The country ids were probed and they are not noisy: the UAE id returned Dubai and Abu Dhabi,
  // the Saudi id returned Riyadh and Jeddah, and Qatar is effectively one city anyway. A city id
  // would LOSE those second cities, and Abu Dhabi was 3 of 10 UAE rows and Jeddah 2 of 10 Saudi
  // rows, so the cost is measurable and one-directional. The city typeahead is also genuinely
  // dangerous: "Dubai" resolves to five Indian villages before it resolves to anything useful.
  'Gulf': {
    linkedin: true,
    location: 'United Arab Emirates', // the string is cosmetic, the id decides, proven below
    geo_ids: geoSet(['United Arab Emirates', 'Qatar', 'Saudi Arabia']),
    work_type: null, // onsite, hybrid and remote, all three. His words: stop dropping them.
    work_types_accepted: 'any',
    max_terms: 1,
    // NULL, and not 'AE', deliberately. Bright Data Indeed requires exactly one country, and this
    // scope is three. Naming one of them here would make an Indeed run for "Gulf" quietly mean the
    // UAE alone, with Qatar and Saudi Arabia dropped and nothing on the report saying so. A null
    // sends it down the existing explicit skip instead, which names the scope and the reason.
    country: null,
    swedish_terms: false,
  },
  // The second half of the same instruction. NON-EU EUROPE is genuinely new and has no prior
  // record anywhere in the vault, so the market list is a PROPOSAL and is named as one.
  //
  // INCLUDED: Switzerland and Norway. Both are real tech markets with real demand in both lanes,
  // both are outside the EU so they are not already covered by the Remote EU scope, both
  // are reachable from Stockholm, and Norway is Nordic so the cultural and working-hours fit is the
  // closest thing to his home market that is not in it.
  // EXCLUDED, each for a stated reason rather than by omission:
  //   United Kingdom  also non-EU, but he named it SEPARATELY and as remote only, so it keeps its
  //                   own scope and its own f_WT=2. Folding it in here would silently grant it
  //                   onsite, which is the one thing his UK rule refuses.
  //   Iceland         tiny market, and the volume does not justify a call out of a budget this tight.
  //   Serbia, Ukraine, Moldova, the Balkans   real outsourcing volume, but the pay bands are far
  //                   below his Stockholm number, so the rows would cost him a read and never
  //                   become an application.
  //   Turkiye         sits in the Middle East region id, not in a European one, and it is not a
  //                   market he has ever named.
  //   Russia, Belarus sanctions and payment reality make them unworkable regardless of listings.
  'Non-EU Europe': {
    linkedin: true,
    location: 'Switzerland', // cosmetic, as above
    geo_ids: geoSet(['Switzerland', 'Norway']),
    work_type: null, // onsite, hybrid and remote
    work_types_accepted: 'any',
    max_terms: 1,
    country: null, // two countries, same reason as the Gulf scope above
    swedish_terms: false,
  },
  // 'Remote EMEA' was here and it is GONE (2026-09-17). It never cost a LinkedIn call (linkedin:
  // false) and its job was to be the widest residual in the FILTER: a row whose location said only
  // "EMEA" was judged by it. Shaheen chose the strict list, so that residual is exactly what he
  // removed. The reasoning it carried is worth keeping for whoever proposes it again: LinkedIn does
  // resolve an id for EMEA (91000007, probed 2026-09-15, a real EMEA spread) and it was refused then
  // too, because EMEA contains the EU, so an EMEA query with no f_WT would re-admit onsite EU jobs
  // through one scope. That argument is unchanged and it now has a second reason on top of it.
};

// EVERY geoId a target declares must have resolved. This was written for the UK target alone and is
// now general, which is the point: the UK was the first scope to ship with an id and the Gulf and
// non-EU Europe bring five more, so a check that names one scope would pass while four silently
// fell back to a location string.
//
// A null id is not a crash, it is the WORST kind of working: the query still runs, the location
// string alone still returns roughly the right country, and nothing on any report distinguishes it
// from a precise one. For the two new scopes it is worse still, because their location strings are
// COSMETIC by design (one string cannot stand for three countries), so a fallback would quietly
// collapse the whole Gulf onto the UAE and the whole of non-EU Europe onto Switzerland.
(function assertEveryGeoResolved() {
  const bad = [];
  for (const key of Object.keys(LINKEDIN_TARGETS)) {
    const t = LINKEDIN_TARGETS[key];
    if (!t.linkedin) continue;
    if (!Array.isArray(t.geo_ids) || !t.geo_ids.length) {
      bad.push(key + ': declares linkedin:true and carries no geo_ids list at all');
      continue;
    }
    for (const g of t.geo_ids) {
      if (g.id === null || g.id === undefined) {
        bad.push(key + ': "' + g.name + '" resolved to no geoId');
      }
    }
  }
  if (bad.length) {
    throw new Error(
      'Plan Queries: ' + bad.length + ' LinkedIn target geoId(s) did not resolve.\n' +
      '  - ' + bad.join('\n  - ') + '\n' +
      '  Each name above is looked up in sources.json linkedin_guest_search.geo_ids.verified and was\n' +
      '  not found there, or was found with no numeric id. The query would still run on the location\n' +
      '  string alone and would look perfectly healthy, which is exactly why this throws instead.\n' +
      '  Prove the id with the two-leg probe the contract documents, write it into `verified` with its\n' +
      '  evidence, and build again. Do not type a number in to make this pass.'
    );
  }
}());

// A target that accepts any work type must NOT be sending an f_WT, and a remote-only one must be.
// The two fields say the same thing from opposite ends, one to LinkedIn and one to the Filter, and
// the failure they guard against is silent in both directions: a remote-only scope with no f_WT
// collects onsite jobs he cannot take, and an any-work-type scope that still sends f_WT=2 collects
// nothing but remote and looks exactly like a market with no onsite work in it.
(function assertWorkTypeAgrees() {
  for (const key of Object.keys(LINKEDIN_TARGETS)) {
    const t = LINKEDIN_TARGETS[key];
    if (!t.linkedin) continue;
    const sendsFilter = t.work_type !== null && t.work_type !== undefined;
    const wants = t.work_types_accepted;
    if (wants !== 'any' && wants !== 'remote_only') {
      throw new Error('Plan Queries: target "' + key + '" declares work_types_accepted ' + JSON.stringify(wants) + '. It must be "any" or "remote_only"; the Filter switches on exactly those two words.');
    }
    if (wants === 'remote_only' && !sendsFilter) {
      throw new Error(
        'Plan Queries: target "' + key + '" accepts remote work ONLY and sends no f_WT, so LinkedIn would\n' +
        '  return a mixed result set and the scope would collect onsite jobs he cannot take.'
      );
    }
    if (wants === 'any' && sendsFilter) {
      throw new Error(
        'Plan Queries: target "' + key + '" accepts ANY work type and still sends f_WT=' + t.work_type + ', so\n' +
        '  LinkedIn would filter the onsite and hybrid rows out at the source. The scope would then report\n' +
        '  zero onsite work in that market, which is indistinguishable from there being none.'
      );
    }
  }
}());

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

// ---------------------------------------------------------------------------------------------
// THE PAGEABLE BOARDS, derived from the contract rather than listed here. A board is pageable when
// its contract entry carries a verified `pagination` block. Today that is Himalayas alone, by
// cursor. Deriving it means the day a second board's paging is proven, the contract edit is the
// whole change and this node and both guards follow.
//
// BOARD_PLAN.paged is the SECOND opinion and the two must agree. A plan that thinks a board is
// paged while the contract has no pagination block would build next-page urls from a field nobody
// verified; the mirror would leave a proven cursor unused and nothing would say so.
// ---------------------------------------------------------------------------------------------
const BOARD_PAGINATION = (function readBoardPagination() {
  const out = {};
  for (const key of Object.keys(UNIT_KIND)) {
    if (UNIT_KIND[key] !== 'board') continue;
    // A board this node knows and the contract does not is a REAL error, and it is
    // assertPlanMatchesContract's error to raise a few lines below, with the full list of both
    // sides. Skipping it here rather than reading .pagination off undefined is what keeps that
    // better message the one the reader gets.
    if (!SRC[key]) continue;
    const pag = SRC[key].pagination || null;
    const contractSaysPaged = !!(pag && pag.verified === true);
    const planSaysPaged = BOARD_PLAN[key] && BOARD_PLAN[key].paged === true;
    if (contractSaysPaged !== planSaysPaged) {
      throw new Error(
        'Plan Queries: the contract and BOARD_PLAN disagree about whether ' + key + ' is paged.\n' +
        '  contract pagination.verified = ' + contractSaysPaged + '\n' +
        '  BOARD_PLAN.paged            = ' + !!planSaysPaged + '\n' +
        '  One was updated and the other was not. A board paged on one side only either burns calls\n' +
        '  on a mechanism nobody proved, or leaves a proven one unused, and neither says so at run time.'
      );
    }
    if (!contractSaysPaged) continue;
    if (pag.kind !== 'cursor') {
      throw new Error('Plan Queries: ' + key + ' declares pagination.kind "' + pag.kind + '". The board guard only implements cursor paging. Implement the new kind deliberately rather than letting this node plan a page it cannot build.');
    }
    for (const f of ['param', 'cursor_field', 'rows_path', 'page_size']) {
      if (pag[f] === undefined || pag[f] === null || pag[f] === '') {
        throw new Error('Plan Queries: ' + key + ' pagination is verified but has no ' + f + '. The board guard reads all four to build the next page.');
      }
    }
    if (!/unix seconds/i.test(SRC[key].date_format || '')) {
      throw new Error(
        'Plan Queries: ' + key + ' is paged and its declared date_format is "' + SRC[key].date_format + '".\n' +
        '  The board guard stops paging when the OLDEST row on a page falls before the window, and it\n' +
        '  only implements the unix-seconds parser. A second date shape here would silently compare\n' +
        '  NaN and page to the cap every single run.'
      );
    }
    if (!placeholdersOf(SRC[key].endpoint).includes(pag.param)) {
      throw new Error('Plan Queries: ' + key + ' pages on "' + pag.param + '" and its endpoint template has no {' + pag.param + '} placeholder, so page 1 could not drop it and page 2 could not set it.');
    }
    out[key] = { kind: pag.kind, param: pag.param, cursor_field: pag.cursor_field, rows_path: pag.rows_path, page_size: pag.page_size, date_field: SRC[key].date_field };
  }
  return out;
}());

// Bright Data bills per record, so the trigger carries an explicit cap. 10 is deliberately small:
// the input field names for the Indeed dataset are UNVERIFIED and the first real call is a probe,
// not a collection run.
const INDEED_LIMIT_PER_INPUT = 10;
// The Indeed host Bright Data should search. Their Indeed dataset REQUIRES this field; it is not
// optional and the request is rejected without it. Starting at the global host rather than a country
// one (se.indeed.com) because the country is already carried separately and sending both narrowing
// keys risks an empty result that looks like a broken integration. If a probe shows the global host
// ignores `country`, this is the knob to turn.
const INDEED_DOMAIN = 'indeed.com';

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
// Every scope that fired fewer search terms than the settings tab holds, with what was left out.
// This rides into the plan summary and into a warning: a trim nobody can see is the under-collection
// this whole stage refuses to do.
const termTrims = [];
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
    // THE TERM CAP, applied here and REPORTED, never applied quietly. A scope may fire fewer than
    // the full search_terms list to keep the base plan under the per-run ceiling; which terms it
    // keeps is Shaheen's own ordering of that cell, taken from the front.
    const allEnglish = cfg.search_terms.slice();
    const cap = (target.max_terms === null || target.max_terms === undefined)
      ? allEnglish.length
      : Math.max(1, Math.min(target.max_terms, allEnglish.length));
    const usedEnglish = allEnglish.slice(0, cap);
    if (usedEnglish.length < allEnglish.length) {
      const dropped = allEnglish.slice(cap);
      termTrims.push({
        location_setting: locSetting,
        terms_fired: usedEnglish.slice(),
        terms_not_fired: dropped,
        geo_ids: target.geo_ids.length,
        reason: 'base LinkedIn calls are scopes x terms x geo ids, and this scope carries ' + target.geo_ids.length +
          ' geo id(s). Firing all ' + allEnglish.length + ' term(s) here would cost ' + (allEnglish.length * target.geo_ids.length) +
          ' calls out of a per-run ceiling of ' + ((cfg._paging_caps && cfg._paging_caps.linkedin_max_calls_per_run) || 'the per-run ceiling') + '. A narrower term is NOT a subset of a broader one on this ' +
          'endpoint (measured 2026-09-15: 4 to 7 of every 10 ids a narrow term returns are absent from the broad ' +
          'term page 1), so this trim genuinely collects less and is named here rather than absorbed.',
      });
    }
    const terms = usedEnglish.map((t) => ({ term: t, lang: 'en' }));
    if (target.swedish_terms) {
      for (const t of cfg.search_terms_sv) terms.push({ term: t, lang: 'sv' });
    }
    // ONE UNIT PER TERM PER GEO ID. A scope that is more than one country is more than one call,
    // because LinkedIn takes a single geoId per query and both multi-id url shapes fail silently
    // (the repeated param keeps only the last, the comma-joined value falls back to the United
    // States). Measured 2026-09-15, see the note on LINKEDIN_TARGETS.
    for (const t of terms) {
      for (const g of target.geo_ids) {
      linkedinUnits.push({
        unit: 'linkedin',
        source: 'linkedin_guest_search',
        method: CONTRACT.linkedin_guest_search.method,
        url: fillUrl(CONTRACT.linkedin_guest_search.endpoint, {
          keywords: t.term,
          location: g.name,
          geoId: g.id,
          tpr: 'r' + windowSeconds,
          worktype: target.work_type,
          start: '0',
        }),
        term: t.term,
        term_language: t.lang,
        location_setting: locSetting,
        location: g.name,
        geo_id: g.id,
        geo_unresolved: g.id === null,
        geo_ids_in_scope: target.geo_ids.length,
        work_type: target.work_type,
        work_types_accepted: target.work_types_accepted,
        f_tpr: 'r' + windowSeconds,
        start: 0,
        window_filtered_server_side: true,
        page_size: LINKEDIN_PAGE.size,
        page_size_verified: LINKEDIN_PAGE.verified,
        // PAGING IS BUILT as of 2026-09-12 (D15 closed). This unit is page 1 of its query; the
        // LinkedIn Page Guard requests the next page only while a page comes back FULL, under the
        // per-run call ceiling and the per-query page cap in run.paging.caps.
        paging_built: LINKEDIN_PAGE.verified,
        page_index: 0,
        detail_enrichment_enabled: detailOn,
        detail_endpoint: detailOn ? CONTRACT.linkedin_guest_detail.endpoint : null,
        probe_required: LINKEDIN_PAGE.verified ? [] : ['D2'],
      });
      if (!LINKEDIN_PAGE.verified) addProbe('D2');
      }
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
    paged: plan.paged === true,
    page_index: 0,
    pagination: BOARD_PAGINATION[key] || null,
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
    // BRIGHT DATA'S INDEED DATASET REQUIRES A COUNTRY, measured 2026-09-14 on execution 5261:
    // ["country", "Required field"] on the one unit whose target has none. The Sweden units passed
    // validation in that same request; only "European Union" failed, because the EU is a scope and
    // not a country, so the target carries country null and the builder omits an empty value rather
    // than sending it blank. This is NOT a naming bug like the keyword/keyword_search one: Indeed is
    // country-scoped by design, so a location setting with no country cannot be served by this
    // source at all. Skipped explicitly and reported, rather than dropped silently or faked with an
    // arbitrary country that would return the wrong jobs and look perfectly healthy.
    if (!target.country) {
      skipped.push({
        what: 'brightdata_indeed for location "' + locSetting + '"',
        reason: 'the Bright Data Indeed dataset requires a country and this location resolves to none (' +
          target.location + ' is a scope, not a country). Measured on execution 5261. The free remote boards ' +
          'cover this scope instead, which is what they are for.',
      });
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
        // THE BRIGHT DATA INDEED INPUT SET, corrected 2026-09-14 from Bright Data's own rejection.
        // The dataset refuses a 'keyword' field outright and requires 'domain' and 'keyword_search'.
        // Those are the LINKEDIN dataset's names that were carried across as a labelled guess when
        // the original probe could not run: the key was unreadable on this machine and the agent was
        // forbidden from building a node on the box, so it shipped the guess rather than invent one.
        // The 400 response echoed its full schema back with our values merged in, which is where
        // date_posted, posted_by and location_radius come from; empty values are omitted by the
        // builder rather than sent blank, so they cost nothing by being named here.
        domain: INDEED_DOMAIN,
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

// --- the paging contract ----------------------------------------------------
// Resolved once and carried on every unit through run.paging. Both page guards read it from here
// and from nowhere else, so a cap is decided in one place and quoted in one place. cfg._paging_caps
// has already merged the three levels (settings tab, then lane.json, then the node default) and
// cfg._paging_caps_source says which level won for each number.
if (!cfg._paging_caps) {
  throw new Error(
    'Plan Queries: Parse Settings produced no _paging_caps. Both page guards read their caps from ' +
    'run.paging and an uncapped loop is the one failure mode a scheduled unattended job must not have, ' +
    'so this stops rather than defaulting. Rebuild the workflow: 04-parse-settings.js and this node ' +
    'ship together.'
  );
}
const paging = {
  caps: cfg._paging_caps,
  caps_source: cfg._paging_caps_source || {},
  linkedin: {
    page_size: LINKEDIN_PAGE.size,
    step: LINKEDIN_PAGE.step,
    param: 'start',
    verified: LINKEDIN_PAGE.verified,
    // The stop condition, stated where both the guard and the report can quote it. It is a PARTIAL
    // PAGE and deliberately not a date: the three probed LinkedIn pages are not in date order
    // within a page or across pages, so a first-old-row rule would stop early at random.
    stop_rule: 'page a query only while its page comes back FULL. A partial page means that query is exhausted.',
  },
  boards: BOARD_PAGINATION,
};

// --- warnings that belong in the run report, not in a comment ---------------
// THE RATE-LIMIT WARNING MEASURES WHAT THE RUN CAN SPEND, NOT WHAT THE BASE PLAN NAMES.
// Corrected 2026-09-12, and the correction was forced by Shaheen narrowing the search terms.
//
// This used to read "linkedinUnits.length > LINKEDIN_SOFT_CALL_LIMIT", which was right when it was
// written: paging did not exist, so the base plan WAS the run. Adaptive paging arrived and the
// condition was never revisited. The BI base plan then went from 12 calls to exactly 10, the
// condition became 10 > 10, and the entire rate-limit signal disappeared from a run that can still
// make twenty calls. Nothing failed. The warning simply stopped appearing, which is the quietest
// way a report can lose a fact.
//
// So the comparison is now against the CEILING this run can actually reach. Math.max, not the raw
// cap, because a ceiling at or below the base plan buys zero extra pages and cancels nothing: the
// run still makes every base call. See the block immediately below, which says the same thing from
// the other side.
//
// The 10 itself is a DOCUMENTED figure, not a measured one, and it is now known to be conservative:
// execution 5154 made 20 LinkedIn calls from this box, verdict ok, source_down false, no 429 and no
// 999. The warning stays because one clean run is not a rate limit that has been disproven, only one
// that has not bitten yet. Raising the number is a settings-level judgement and is Shaheen's.
const linkedinPagingEnabled = !!(linkedinUnits.length && LINKEDIN_PAGE.verified);
const linkedinCallCeiling = linkedinPagingEnabled
  ? Math.max(linkedinUnits.length, paging.caps.linkedin_max_calls_per_run)
  : linkedinUnits.length;
if (linkedinCallCeiling > LINKEDIN_SOFT_CALL_LIMIT) {
  const extra = linkedinCallCeiling - linkedinUnits.length;
  warnings.push(
    'this run can make up to ' + linkedinCallCeiling + ' LinkedIn calls (' + linkedinUnits.length + ' base' +
    (extra > 0 ? ' plus up to ' + extra + ' adaptive page(s)' : '') + '), above the ' + LINKEDIN_SOFT_CALL_LIMIT +
    ' that a datacenter IP is reported to tolerate before 429 or 999, and the box is a datacenter IP. ' +
    'Hard ceiling ' + paging.caps.linkedin_max_calls_per_run + ' calls per run (D20). One live run has already made ' +
    '20 from this box with no refusal, so the ' + LINKEDIN_SOFT_CALL_LIMIT + ' is documented rather than measured. ' +
    'Stage B paces them and reports a 429 or a 999 as a DEGRADED source with a named reason, never as an empty result.'
  );
}
// THE CEILING CAPS PAGING, NEVER THE BASE PLAN. Stage A refused to trim search terms to fit under a
// number and that decision stands: a ceiling at or below the base plan buys zero extra pages and
// drops nothing. Said out loud here because a ceiling that silently cancelled planned queries would
// be the exact under-collection this lane exists to prevent, and it would look identical to a quiet
// day in the sheet.
if (linkedinUnits.length && LINKEDIN_PAGE.verified) {
  const budget = paging.caps.linkedin_max_calls_per_run - linkedinUnits.length;
  if (budget <= 0) {
    warnings.push(
      'LINKEDIN PAGING IS EFFECTIVELY OFF this run: the base plan is ' + linkedinUnits.length + ' call(s) and the ' +
      'per-run ceiling is ' + paging.caps.linkedin_max_calls_per_run + ' (' + paging.caps_source.linkedin_max_calls_per_run + '), ' +
      'so there is no budget for a second page of anything. Every query is capped at ' + LINKEDIN_PAGE.size +
      ' rows again. The base plan is NOT trimmed to make room; raise the ceiling or cut search_terms.'
    );
  } else {
    warnings.push(
      'LinkedIn paging is ON and adaptive: a query is paged only while its page comes back full (' + LINKEDIN_PAGE.size +
      ' rows, step ' + LINKEDIN_PAGE.step + '). Base plan ' + linkedinUnits.length + ' call(s), hard ceiling ' +
      paging.caps.linkedin_max_calls_per_run + ' (' + paging.caps_source.linkedin_max_calls_per_run + '), so up to ' + budget +
      ' extra page(s), at most ' + paging.caps.linkedin_max_pages_per_query + ' page(s) per query. ' +
      (firstRun ? 'THIS IS THE FIRST RUN and its ' + cfg.first_run_window_hours + 'h window is the worst case: expect most queries to come back full and the ceiling to bite. ' : '') +
      'A full page the ceiling refused to follow is reported as a named truncation with a count, never dropped quietly.'
    );
  }
}
const pagedBoards = boardUnits.filter((u) => u.paged);
if (pagedBoards.length) {
  warnings.push(
    pagedBoards.length + ' board(s) are paged by cursor (' + pagedBoards.map((u) => u.source).join(', ') + '), up to ' +
    paging.caps.himalayas_max_pages_per_run + ' page(s) per run (' + paging.caps_source.himalayas_max_pages_per_run + '). ' +
    'The loop stops early when the oldest row on a page falls before that source\\'s effective window start, so on a ' +
    'normal day the WINDOW stops it and not the cap. The collector reports the oldest pubDate it actually reached.'
  );
}
const unresolvedGeo = linkedinUnits.filter((u) => u.geo_unresolved).length;
if (unresolvedGeo) {
  warnings.push(
    unresolvedGeo + ' LinkedIn call(s) run with a location string and no geoId. Every shipped target ' +
    'resolves its ids at BUILD time and the build refuses a null one, so reaching this at run time means ' +
    'the built plan and the contract have come apart. Those calls are less precise than they look, and for ' +
    'a multi-country scope they collapse onto whichever single country the location string names.'
  );
}
// THE TERM TRIM, said out loud every run it happens. Stage A refused to trim search terms to fit
// under a number and that refusal still stands for the scopes that were here before: nothing is
// dropped from Sweden, Remote EU or Remote UK to make room. What IS capped is a scope that was
// added knowing the ceiling, and the difference between the two is that this one is reported.
for (const t of termTrims) {
  warnings.push(
    'TERM TRIM on "' + t.location_setting + '": fired ' + JSON.stringify(t.terms_fired) + ' and did NOT fire ' +
    JSON.stringify(t.terms_not_fired) + '. ' + t.reason
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
  // Per-scope LinkedIn call counts, so a reader can see where the base plan went without counting
  // units by hand, and can see a multi-country scope costing more than one call per term.
  linkedin_by_scope: (function () {
    const out = {};
    for (const u of linkedinUnits) {
      const k = u.location_setting;
      if (!out[k]) out[k] = { calls: 0, geo_ids: [], work_type: u.work_type, work_types_accepted: u.work_types_accepted };
      out[k].calls += 1;
      if (out[k].geo_ids.indexOf(u.geo_id) === -1) out[k].geo_ids.push(u.geo_id);
    }
    return out;
  }()),
  term_trims: termTrims,
  probes_outstanding: Object.keys(probeSet).sort(),
  warnings: warnings,
};

const run = {
  lane: LANE_NUMBER,
  run_started_at: runStartedAt,
  paging: paging,
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

// The whole rule set Stage E decides on, carried on every planned unit. ONE surface, read once by
// the Filter node. locations and max_scored_per_run joined it in Stage E (2026-09-11): they were in
// the settings object all along and not on this block, so Stage E would otherwise have had to reach
// PAST Plan Queries to Parse Settings for two of its six rules, which is how one rule ends up read
// from two places and the two drift.
const filters = {
  keep_if_title_has: cfg.keep_if_title_has,
  always_drop: cfg.always_drop,
  locations: cfg.locations,
  match_rule: cfg.match_rule,
  geo_rule: cfg.geo_rule,
  language_rule: cfg.language_rule,
  max_scored_per_run: cfg.max_scored_per_run,
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
  `const BOARD_PAGINATION = ${JSON.stringify(BOARD_PAGINATION)};`,
  `const INDEED_LIMIT_PER_INPUT = ${JSON.stringify(INDEED_LIMIT_PER_INPUT)};`,
  `const INDEED_DOMAIN = ${JSON.stringify(INDEED_DOMAIN)};`,
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
