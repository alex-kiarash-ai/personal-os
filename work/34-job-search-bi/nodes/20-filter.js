'use strict';
/*
 * 20-filter.js - "Filter". The node that decides what Shaheen ever sees.
 *
 * FIVE rules, in this order, first failure wins: always_drop on the title, keep_if_title_has on the
 * title, geography, WORK TYPE, freshness. Plus one thing that is not a rule: posted_at is normalised
 * here, in the one node that sees all three branches, so the sheet column holds one format.
 *
 * Work type joined the list on 2026-09-15, on Shaheen's "the gulf and non EU europe, and stop
 * dropping them". Until that day nothing in this lane dropped a row for being onsite: every
 * arrangement word sat in NO_INFO_TOKENS and was STRIPPED as "how the work is done, not where"
 * before the geography test ran. The concept did not exist. Section 3b below is the whole of it.
 *
 * THE RULES COME FROM THE SETTINGS TAB. Every list, the location set and the per-run cap arrive on
 * `filters`, which Plan Queries stamps onto every planned unit out of the validated config object.
 * Nothing about what Shaheen is hunting is typed into this file. The only vocabulary that lives
 * here is the geography one, and it is here for the same reason LINKEDIN_TARGETS is in Plan
 * Queries: turning the string "Remote EU" into something a free-text location field can be matched
 * against is a decision, and a decision belongs in a file that can be read and reversed.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. TOKEN BOUNDARIES ON always_drop, PLAIN SUBSTRING ON keep_if_title_has. Not a symmetry slip.
 * ---------------------------------------------------------------------------------------------
 * A short drop term matched as a plain substring kills every longer word that merely STARTS with it,
 * and both lanes' real lists are full of exactly that shape. Two of them do most of the damage: a
 * six-letter term aimed at entry-level roles is also the opening of the ordinary adjective for
 * cross-border work, and a five-letter term aimed at commercial roles is also the opening of a very
 * well known CRM vendor's name. Measured against eighteen realistic titles for this lane, plain
 * substring matching produced NINE false drops, and token-boundary matching recovers every one of
 * them while still dropping the three that genuinely should go.
 *
 * The titles and the terms are NOT written here. They live in config/test-stage-e.js, which is
 * gitignored, because this folder is tracked and the repo is PUBLIC. A node file holds wiring.
 *
 * The boundary test is BY INDEX, never by the regex \b. Real terms in both lists carry a dot, a
 * hyphen and an ampersand: there are product names with a dot in them, Swedish job titles joined by
 * a hyphen, and a two-word term joined by an ampersand. \b is defined against \w, which puts a
 * word boundary in the MIDDLE of every one of those, so a \b match would cut them in half and
 * match their fragments. A term matches only where the character on each side is not a letter or a
 * digit.
 *
 * keep_if_title_has stays a plain substring, and that is deliberate rather than unfinished. The two
 * lists fail in OPPOSITE directions: a loose always_drop DROPS a real job, a loose keep_if_title_has
 * KEEPS a junk one, which the scorer then sees and ranks low. So each list gets the matcher that
 * fails in the cheap direction. It is also exactly what the settings tab's own match_rule cell says.
 * And it matters in the other lane specifically: several of its keep terms are three-letter
 * acronyms that real job titles glue straight onto a following word, and a boundary match would
 * refuse every one of those titles.
 *
 * always_drop WINS. Checked first, and a drop hit ends the row whatever the keep list says.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. THE WINDOW IS THE ONE THE PLAN COMPUTED, AND LINKEDIN ROWS ARE NOT CUT ON IT AT ALL.
 * ---------------------------------------------------------------------------------------------
 * The cut line is `_collect.window_start_effective`, per row, which is what Plan Queries computed:
 * 168h on a first run, since-last-run plus a 1h margin with a 24h floor after that, shifted back
 * further for a source with a declared publish lag. A fixed 48h cut would throw away five days of
 * the first run's backfill and nothing would say so.
 *
 * A row with `_collect.window_filtered_server_side === true` SKIPS the window rule entirely. That
 * is LinkedIn, which was cut at the source by f_TPR. Skipping it is not a convenience, it is a
 * correctness fix, and the reason is a false drop that would have hit every LinkedIn row posted on
 * the day of the run: LinkedIn publishes a DATE with no time, this node reads a bare date as the
 * start of that day in UTC, and on a normal 25h window the window starts in the MIDDLE of a day. So
 * a job posted this morning carries today's date, resolves to midnight, lands before window_start,
 * and gets dropped as too old. Server-side-filtered rows were already inside the window when they
 * arrived; re-cutting them on a coarser date than the one the cut needs is strictly worse than not
 * cutting them.
 *
 * An UNDATED row is KEPT, sorted last by the cap, and counted. Losing a date must not lose a job,
 * which is the rule the board collector already applies when it emits one. It is counted so the
 * count can be read, because a stale row silently treated as fresh is the other half of the trap.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. GEOGRAPHY IS DELIBERATELY CONSERVATIVE, AND THE MEASUREMENT IS WHY.
 * ---------------------------------------------------------------------------------------------
 * Measured over the six live board captures, 515 rows: the title rules alone take the BI lane to 7
 * rows and the AI lane to 10, and the window then takes those to 1 and 3. So geography is deciding
 * a handful of rows per run, while a location field that is free text in five different shapes is
 * the single easiest place in this lane to lose a real job by accident. The rule therefore drops
 * only what it can name, and every geography drop is reported with the string that caused it, so a
 * bad rule is visible on the first run instead of never.
 *
 *   - a location with no geographic content at all (empty, "Remote", "Hybrid", "N/A") is UNKNOWN
 *     and is KEPT and counted. It is not evidence of anywhere.
 *   - a location carrying one of the positive tokens for the settings `locations` is KEPT.
 *   - anything else names somewhere, and none of it is anywhere Shaheen asked for, so it DROPS.
 *   - a LinkedIn row carries `_collect.location_setting`, which means the SEARCH was already aimed
 *     at one of his locations, so it skips the geography rule the same way it skips the window.
 *
 * Geography also RESOLVES THE SCOPE a row sits in, which is new and is what rule 3b needs. Scopes
 * nest (the Gulf is inside EMEA, the EU is inside Europe is inside EMEA), so a row can match more
 * than one and the answer has to be chosen rather than stumbled into. GEO_PRECEDENCE declares the
 * order and it is MOST SPECIFIC FIRST. It used to be the order of the settings cell, which meant a
 * rule's outcome depended on how somebody typed a list.
 *
 * geo_rule and language_rule prose from the settings tab is carried into the report and is NOT
 * interpreted here. Language is never a filter, by his own rule: a Swedish-fluency requirement is a
 * red flag for the scorer, not a reason to drop.
 *
 * ---------------------------------------------------------------------------------------------
 * 3b. WORK TYPE, AND THE BURDEN OF PROOF SITS ON THE DROP.
 * ---------------------------------------------------------------------------------------------
 * Each scope declares whether it takes any work type or remote only:
 *   Sweden, Gulf, Non-EU Europe, Remote EMEA   onsite, hybrid and remote
 *   Remote EU, Remote UK                       remote only
 * A remote-only scope drops a row ONLY on evidence that it is genuinely not remote, and an absent
 * work type is never that evidence. The sources are the reason: six boards hardcode remote:true and
 * can never say otherwise, Arbeitnow is the only one that measures it per row, and LinkedIn has no
 * remote field at all so the value is inferred from the request and is null whenever the query sent
 * no f_WT. The new Gulf and non-EU Europe queries send no f_WT by design, so every row they collect
 * arrives with remote null. Treating null as onsite would throw all of them away and the run report
 * would show a healthy collection and an empty sheet.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE CAP IS NOT IN THIS NODE, AND THE BRIEF SAID IT WOULD BE.
 * ---------------------------------------------------------------------------------------------
 * max_scored_per_run caps what reaches the SCORER, and between this node and the scorer sits Remove
 * Known, which deletes every row Shaheen has already seen. Capping here would spend the twenty
 * slots on rows that are about to be deleted. Worse, it makes the backlog undrainable: a run where
 * the cap bit must not advance last_run_at, so the next run sees the same window, and if the cap is
 * applied BEFORE Remove Known that next run caps to the same twenty rows, removes all twenty as
 * known, and emits nothing, forever. The cap is applied in Remove Known, after the known rows are
 * gone. This node reports how many rows survived so the gap between the two numbers is visible.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THE STREAM CONTRACT.
 * ---------------------------------------------------------------------------------------------
 * IN:  `_kind: 'job'` rows and `_kind: 'source_report'` items, from all three collectors via Merge.
 * OUT: the surviving jobs, EVERY source_report untouched, one synthesised `source_report` per
 *      SWITCHED-OFF source (verdict `disabled`, reported_by Filter), and one `_kind: 'stage_report'`.
 *      The disabled rows close the gap Stage B flagged and Stages C and D restated: a source whose
 *      branch never runs has no collector to speak for it, so without them Stage F cannot tell "off"
 *      from "ran and found nothing". This node is the first one downstream that always executes and
 *      it already holds the plan's disabled list, so it is the cheapest honest place to say it.
 * The reports pass through for two reasons. Stage F needs every one of them to write the run
 * verdict, and they are also what guarantees this node and the two after it have input at all: a
 * run where every job is filtered out still carries the reports, and an n8n node with empty input
 * is skipped entirely, which would take Read Known Jobs and Remove Known with it and lose the
 * evidence of exactly the run that most needs explaining.
 */

const { lane, sources, settingsSchema } = require('./_lane');
const L = lane();
const CONTRACT = sources();

// The rule keys this node reads off `filters`. Read back out of Plan Queries' generated code below,
// so a rule that stops being carried fails HERE, at build time, rather than arriving as undefined
// and quietly filtering nothing.
const REQUIRED_FILTER_KEYS = [
  'keep_if_title_has', 'always_drop', 'locations', 'match_rule', 'geo_rule', 'language_rule',
  'max_scored_per_run',
];

// ---------------------------------------------------------------------------------------------
// THE GEOGRAPHY VOCABULARY.
//
// Keyed by the EXACT strings the settings tab's `locations` list uses, the same way Plan Queries
// keys LINKEDIN_TARGETS, and asserted against that map at build time so the two can never drift.
// A location in the sheet that this map does not know THROWS at run time rather than being ignored,
// because a location added to the sheet and quietly skipped is invisible in every run report.
//
// Tokens are matched on TOKEN BOUNDARIES, case insensitively, against both the raw location string
// and a diacritic-folded copy of it, so Malmo matches the Swedish spelling and vice versa.
// ---------------------------------------------------------------------------------------------
const GEO_TARGETS = {
  'Sweden': {
    why: 'his home market. Onsite has always been fine here. It is no longer the ONLY place: as of 2026-09-15 the Gulf and non-EU Europe accept it too, on his instruction.',
    work_types: 'any',
    tokens: [
      'sweden', 'sverige', 'swedish', 'svensk', 'nordic', 'nordics', 'norden', 'scandinavia',
      'scandinavian', 'skandinavien',
      // The dozen largest Swedish labour markets. This list is a CONVENIENCE, not a claim of
      // completeness: a town it does not know is a town whose row falls through to the drop branch,
      // which is why every geography drop is reported with its location string. Board feeds name
      // countries and regions, not towns, so in practice this only ever fires on the two boards
      // that publish free-text city strings.
      'stockholm', 'goteborg', 'gothenburg', 'malmo', 'uppsala', 'linkoping', 'vasteras', 'orebro',
      'lund', 'helsingborg', 'umea', 'norrkoping', 'jonkoping', 'solna', 'kista', 'sundbyberg',
    ],
  },
  // ============================================================================================
  // THE FOUR NAMED REMOTE COUNTRIES, 2026-09-17. THEY REPLACE 'Remote EU', THEY DO NOT NARROW IT.
  // ============================================================================================
  // This is the half of the change that decides whether a job LIVES. Only LinkedIn and Jobicy take a
  // request-side geography at all, so for six of the eight live sources a scope exists ONLY as a
  // token list here, and a row this file cannot name is dropped.
  //
  // WHAT LEAVING 'Remote EU' OUT ACTUALLY DOES, measured before he decided rather than after. On the
  // 2026-09-17 runs, 22 of 60 surviving BI rows and 13 of 43 AI rows came through 'Remote EU', and
  // only 2 and 4 of those named a country on his new list. The rest were Portugal x10, Lithuania x4,
  // Poland, France, Romania, Czechia, Italy and Finland, every one of them REMOTE. Asked whether
  // those should stop arriving, he answered "strict: only the five I named". So they stop. A board
  // row whose location says only "Europe", "EU" or "CET" now matches nothing and is dropped on
  // geography, which the run report already counts and samples (dropped_geo, geoDropSamples).
  //
  // NATIONS, LANGUAGES AND THE MAJOR CITIES, and the cities earn their place here for a reason the
  // UK list did not have. A UK row always carries the "united kingdom" tail. These four do not
  // always: the live probes returned "Limburg, Netherlands" and "North Holland, Netherlands" (which
  // do name the country) but also "Sant Joan Despi, Catalonia, Spain" and "County Westmeath,
  // Ireland" where a region sits between the town and the country. A city list is what catches a
  // board row that prints only "Barcelona" or "Amsterdam", which both do.
  //
  // THE OVERLAP WITH 'Remote UK' IS DELIBERATE AND IS THE ONE PLACE THESE LISTS ARE NOT DISJOINT.
  // 'ireland' matches inside "Northern Ireland", which belongs to the UK. GEO_PRECEDENCE puts
  // Remote UK BEFORE Remote Ireland so a Belfast row is judged as UK, and because both scopes carry
  // the SAME remote-only rule the verdict is identical either way: only the label differs. Removing
  // 'ireland' instead was considered and refused, because LinkedIn prints "County Westmeath,
  // Ireland" with no city this list would otherwise catch.
  //
  // TOKENS CONSIDERED AND REFUSED, each for a real collision:
  //   'ie', 'de', 'nl', 'es'  two letters. 'de' is a Spanish and Portuguese preposition and appears
  //                           in half the Iberian location strings; 'es' is a Spanish word ending.
  //   'holland'               KEPT, it is unambiguous and boards print it.
  //   'eire'                  KEPT, rare but unambiguous.
  //   'dach'                  the DACH region is Germany plus Austria plus Switzerland, and Austria
  //                           is not on his list while Switzerland has its own scope with a
  //                           different work-type rule. A DACH row would be claimed by Germany and
  //                           granted remote-only, which is the conservative reading, but it would
  //                           also silently admit a market he did not name. Refused.
  //   'iberia', 'benelux'     same shape: they name a region wider than the country he listed.
  //                           Benelux is Belgium plus the Netherlands plus Luxembourg, and he named
  //                           only the Netherlands.
  'Remote Ireland': {
    work_types: 'remote_only',
    why: 'named by him 2026-09-17, in the remote-only group. He has no Irish right to work, so an onsite Dublin job is not a job he can take; the collector enforces it with f_WT=2 and every board here is remote only, and this list is the geography half.',
    tokens: [
      'ireland', 'irish', 'eire', 'republic of ireland',
      'dublin', 'cork', 'galway', 'limerick', 'waterford',
    ],
  },
  'Remote Germany': {
    work_types: 'remote_only',
    // The probe figure that used to sit in this string named one of his live search terms, and the
    // leak scanner in test-stage-a.js caught it: these node files are TRACKED and the repo is
    // PUBLIC, so a search term here is a search term published. The number lives in the gitignored
    // contract under geo_ids.verified.Germany.volume_note instead.
    why: 'named by him 2026-09-17, in the remote-only group. The largest of the four by market size and the thinnest on the pre-ship probe, which is a fact about one probe and not about the market.',
    tokens: [
      'germany', 'german', 'deutschland',
      'berlin', 'munich', 'munchen', 'hamburg', 'frankfurt', 'cologne', 'koln',
      'stuttgart', 'dusseldorf', 'dortmund', 'leipzig', 'bavaria', 'nordrhein',
    ],
  },
  'Remote Netherlands': {
    work_types: 'remote_only',
    why: 'named by him 2026-09-17, in the remote-only group.',
    tokens: [
      'netherlands', 'dutch', 'holland', 'nederland',
      'amsterdam', 'rotterdam', 'utrecht', 'the hague', 'den haag', 'eindhoven',
      'groningen', 'noord-holland', 'north holland', 'limburg', 'overijssel',
    ],
  },
  'Remote Spain': {
    work_types: 'remote_only',
    why: 'named by him 2026-09-17, in the remote-only group.',
    tokens: [
      'spain', 'spanish', 'espana',
      'madrid', 'barcelona', 'valencia', 'seville', 'sevilla', 'bilbao',
      'malaga', 'zaragoza', 'catalonia', 'cataluna', 'andalusia',
    ],
  },
  // Added 2026-09-14 with the UK scope, and this entry is the half of that change that actually
  // delivers jobs. UK rows already ARRIVE at this lane every weekday and are thrown away here:
  // measured on the live Jobicy europe page that morning, 25 of 100 rows named the UK in jobGeo
  // and 19 of those 25 were dropped, because no list above holds uk, united kingdom, england,
  // scotland or wales. The shipped classifier also dropped all ten LinkedIn UK cards from the
  // geoId probe. So the collector side was never the bottleneck.
  //
  // WHY THE NATIONS AND NOT THE CITIES. Board feeds name countries and regions; LinkedIn names
  // towns. The four nations plus the obvious UK spellings cover every string seen on a real
  // response, and a London or Manchester row still matches on the "united kingdom" tail that
  // LinkedIn always appends. The Sweden list keeps its town names because his home market is the
  // one place onsite is allowed and a Swedish town string is therefore a KEEP signal on its own.
  // Here every kept row is remote by the query (f_WT=2) or by the board being remote only, so a
  // town name adds nothing a nation name does not already say.
  //
  // THREE THINGS ARE DELIBERATELY ABSENT and each one was considered rather than forgotten.
  // 'gb'      two letters, matched on token boundaries, and it collides with initialisms in the
  //           free text location fields two boards publish. 'uk' is short too, but it is the string
  //           the boards actually print, 25 times on one Jobicy page, so it earns the risk.
  // 'gmt'     the Remote EU list carries 'cet' on the reasoning that two boards state a timezone
  //           instead of a region, so the shape is established. It is refused HERE because 'gmt+2'
  //           and 'gmt+3' are Eastern Europe and Africa and they match on a token boundary, so the
  //           token would quietly widen a UK scope into an EMEA one. 'bst' is refused with it.
  // 'english' a language, not a place, and "English speaking" is a real value in a free text
  //           location field. It would keep a worldwide English speaking role as if it were British.
  'Remote UK': {
    work_types: 'remote_only',
    why: 'his own addition, 2026-09-14. REMOTE only: he has no UK right to work, so an onsite London job is not a job he can take. Collection enforces that with f_WT=2 on the LinkedIn side and by every board here being remote only; this list is the geography half.',
    tokens: [
      'uk', 'u.k.', 'united kingdom', 'great britain', 'britain',
      'england', 'scotland', 'wales', 'northern ireland',
    ],
  },
  // Added 2026-09-15 on his words, "the gulf and non EU europe, and stop dropping them". THE FIRST
  // SCOPE OTHER THAN SWEDEN THAT ACCEPTS ONSITE WORK, which is the whole point of it: his own
  // 2026-06-16 sourcing config already said "Gulf (Dubai/Doha/Riyadh) on-site+hybrid", so this is a
  // preference being honoured again rather than a new one being invented.
  //
  // COUNTRIES AND THEIR MAJOR CITIES, and the cities earn their place here in a way they did not in
  // the UK list. A UK row always carries the "united kingdom" tail, so nation names were enough.
  // Gulf rows do not: the live probe returned "Dubai, United Arab Emirates" but also a bare
  // "Doha Metropolitan Area" and a bare "Riyadh Region", neither of which names its country at all.
  // A nation-only list would drop both.
  //
  // SIX TOKENS WERE CONSIDERED AND REFUSED, each for a collision that is real rather than imagined:
  // 'sa'    two letters, and it is South Africa at least as often as Saudi Arabia. Both are inside
  //         EMEA, so the collision is not even distant.
  // 'qa'    Qatar's code, and also QUALITY ASSURANCE, which is one of the most common words in tech
  //         hiring. A location field reading "QA" is a job function far more often than a country.
  // 'ksa'   Kingdom of Saudi Arabia, and also Knowledge, Skills and Abilities, which is standard HR
  //         vocabulary. Real Saudi postings say Saudi Arabia or Riyadh, so the token buys nothing.
  // 'gulf'  LinkedIn's OWN typeahead resolves "Gulf" to Gulfport Mississippi, Gulf Breeze Florida
  //         and Gulf Shores Alabama before anything Arabian. Measured, not guessed.
  // 'gcc'   the Gulf Cooperation Council, and also the GNU Compiler Collection.
  // 'ae'    two letters, no free-text location field ever carries it alone.
  'Gulf': {
    why: 'his own words 2026-09-15, and his 2026-06-16 config before that. ONSITE, HYBRID AND REMOTE all three, which is the difference from every scope except Sweden. He has worked the region and a Dubai or Riyadh onsite role is a job he can actually take.',
    work_types: 'any',
    tokens: [
      'uae', 'u.a.e.', 'united arab emirates', 'emirates', 'dubai', 'abu dhabi', 'sharjah',
      'qatar', 'doha', 'lusail',
      'saudi', 'saudi arabia', 'riyadh', 'jeddah', 'jiddah', 'dammam', 'khobar',
      'arabian gulf', 'persian gulf',
    ],
  },
  // The other half of the same instruction, and the market list is a PROPOSAL rather than a record:
  // nothing in the vault has ever named a non-EU European market. Switzerland and Norway, for the
  // reasons written against the matching target in 05-plan-queries.js. The UK is also non-EU and is
  // deliberately NOT here, because he named it separately and as remote only.
  //
  // FOUR TOKENS REFUSED, and two of them are the sharpest examples in this whole file because they
  // came out of the live probe rather than out of caution:
  // 'fully'  "Fully, Valais" is a real Swiss municipality and it was 1 of the 10 cards the Swiss
  //          geoId returned. As a token it would match "fully remote" on every board this lane reads.
  // 'time'   "Time, Rogaland" is a real Norwegian municipality and it was 1 of the 10 Norwegian
  //          cards. As a token it would match "full time" and "part time".
  // 'bergen' Norway's second city, and also Bergen op Zoom in the Netherlands and Bergen in Germany,
  //          both of which are EU and would be pulled into an any-work-type scope by mistake.
  // 'no'     Norway's country code and an ordinary English word. 'ch' is refused with it.
  'Non-EU Europe': {
    why: 'his own words 2026-09-15, "the gulf and non EU europe". ONSITE, HYBRID AND REMOTE. Switzerland and Norway: both outside the EU so the Remote EU scope does not already cover them, both real markets for this lane, and Norway is Nordic so the working culture is the closest fit to home that is not home.',
    work_types: 'any',
    tokens: [
      'switzerland', 'swiss', 'suisse', 'schweiz', 'svizzera',
      'zurich', 'geneva', 'geneve', 'basel', 'bern', 'lausanne', 'lugano',
      'norway', 'norwegian', 'norge', 'oslo', 'trondheim', 'stavanger',
    ],
  },
  // 'Remote EMEA' was here and it is GONE (2026-09-17). It was the widest residual, the scope that
  // caught a row whose location said only "EMEA", "Middle East" or "Africa", and it is precisely
  // what Shaheen removed by choosing the strict named list. Its work_types was 'any', which is why
  // it had to be evaluated LAST: it was the one scope that would grant onsite to a row naming no
  // country. A Gulf row still survives, on the Gulf scope, which names its countries and cities.
};

// ---------------------------------------------------------------------------------------------
// THE PRECEDENCE RULE, because scopes overlap by construction and a row can match two of them.
//
// The scopes are nested in real life: the Gulf is inside the Middle East is inside EMEA, and the EU
// is inside Europe is inside EMEA. So "which scope is this row in" has more than one true answer and
// the lane has to pick one, because the WORK TYPE rule hangs off the answer and the two rules he
// gave are opposites: the EU is remote only, EMEA takes anything.
//
// MOST SPECIFIC PLACE WINS. A row that names a country is judged by that country's rule; only a row
// that names nothing more precise than a region falls through to the region's rule. Concretely:
//   "Dubai, United Arab Emirates" onsite   -> Gulf      -> any work type   -> KEPT
//   "Zurich, Switzerland" hybrid           -> Non-EU EU -> any work type   -> KEPT
//   "Europe" onsite                        -> Remote EU -> remote only     -> DROPPED
//   "EMEA" onsite                          -> EMEA      -> any work type   -> KEPT
//
// AND THE CASE THE ORDER EXISTS TO SETTLE, a posting whose location spells out
// "Europe, Middle East and Africa". It carries 'europe' and it carries 'middle east'. Remote EU is
// evaluated before Remote EMEA, so it is judged as a European job and the remote-only rule applies.
// That is the conservative reading and it is the right one: the only geography that posting actually
// asserts about itself is that Europe is in scope, and onsite in Europe outside Sweden is the one
// thing his rule refuses. A posting that really is an onsite Gulf job names the Gulf, and then the
// Gulf entry matches first and keeps it. Nothing about this order can drop a REMOTE row; it only
// decides which rule an onsite row is judged by.
//
// Declared here rather than inherited from the order of the settings cell, which is what used to
// decide it. A rule whose answer depends on how somebody typed a spreadsheet cell is not a rule.
const GEO_PRECEDENCE = [
  'Sweden',             // his home country, and the first scope where onsite was ever allowed
  'Gulf',               // named countries and cities, any work type
  'Non-EU Europe',      // named countries, any work type. KEPT on his explicit answer 2026-09-17
                        // when his new list omitted Switzerland and Norway.
  // The five remote-only countries. Order inside this group decides only the LABEL, because all
  // five carry the same rule, with ONE case where it matters: 'ireland' matches inside "Northern
  // Ireland", so Remote UK is tested first and a Belfast row is judged as UK.
  'Remote UK',
  'Remote Ireland',
  'Remote Germany',
  'Remote Netherlands',
  'Remote Spain',
  // 'Remote EU' and 'Remote EMEA' were the last two entries and both are GONE (2026-09-17). They
  // were the residuals: the scopes that judged a row naming nothing more precise than a region.
  // With them removed there IS no residual, which is the strict list working as chosen. A row whose
  // location says only "Europe" or "EMEA" now falls off the end of this list and is dropped on
  // geography, counted and sampled on the run report.
];

// Evidence that a row is NOT remote. Deliberately short and deliberately explicit: each of these is
// a word a posting uses to say the work happens somewhere, and none of them is an inference.
const NON_REMOTE_TOKENS = [
  'hybrid', 'on-site', 'onsite', 'on site', 'in office', 'in-office', 'office based', 'office-based',
];
// Evidence that it IS remote. Only used to CANCEL the tokens above, never on its own: a location
// reading "Hybrid remote" or "Remote or hybrid" says both, and a row that says both has not
// demonstrated anything, so it is kept.
const REMOTE_TOKENS = [
  'remote', 'remotely', 'fully remote', 'work from home', 'wfh', 'telecommute', 'distributed',
];

// Always positive, whatever the locations list says, because a job open to everywhere is open to
// everywhere he named.
const WORLDWIDE_TOKENS = [
  'worldwide', 'world wide', 'world-wide', 'global', 'globally', 'anywhere', 'international',
  'any location', 'any country', 'everywhere', 'fully distributed',
];

// Words that describe an ARRANGEMENT, not a place. A location made of nothing but these carries no
// geographic information and the row is kept as unknown rather than dropped on an empty inference.
const NO_INFO_TOKENS = [
  'remote', 'remotely', 'hybrid', 'onsite', 'on site', 'on-site', 'office', 'home office',
  'work from home', 'wfh', 'telecommute', 'distributed', 'flexible', 'various',
  'multiple locations', 'n/a', 'na', 'none', 'unknown', 'tbd', 'any', 'other',
];

// ---------------------------------------------------------------------------------------------
// Build-time assertions. Every one of these runs on this machine before a byte reaches the box.
// ---------------------------------------------------------------------------------------------
const PLAN_CODE = require('./05-plan-queries.js').parameters.jsCode;

(function assertAgainstUpstream() {
  // 1. The rule block still carries every rule this node reads.
  const m = /const filters = \{([\s\S]*?)\n\};/.exec(PLAN_CODE);
  if (!m) {
    throw new Error(
      'Filter: could not find the `filters` block in 05-plan-queries.js. That block is how every\n' +
      '  rule in the settings tab reaches this node. If it was renamed, rename it in both files in\n' +
      '  the same edit.'
    );
  }
  const carried = [];
  const keyLine = /^\s*([a-z_]+):/gm;
  let hit;
  while ((hit = keyLine.exec(m[1])) !== null) carried.push(hit[1]);
  const missing = REQUIRED_FILTER_KEYS.filter((k) => carried.indexOf(k) === -1);
  if (missing.length) {
    throw new Error(
      'Filter: Plan Queries no longer carries ' + missing.join(', ') + ' on `filters`.\n' +
      '  It carries: ' + carried.join(', ') + '.\n' +
      '  A rule that stops being carried arrives here as undefined, and an undefined list filters\n' +
      '  nothing at all while the run reports a perfectly healthy number.'
    );
  }

  // 2. The geography map and Plan Queries' LinkedIn map answer to the SAME settings strings.
  const t = /^const LINKEDIN_TARGETS = (\{.*\});$/m.exec(PLAN_CODE);
  if (!t) throw new Error('Filter: could not read LINKEDIN_TARGETS out of 05-plan-queries.js. That map is the other half of the location contract.');
  const planLocations = Object.keys(JSON.parse(t[1])).slice().sort();
  const mine = Object.keys(GEO_TARGETS).slice().sort();
  if (planLocations.length !== mine.length || planLocations.some((k, i) => k !== mine[i])) {
    throw new Error(
      'Filter: the geography map and Plan Queries disagree about which locations exist.\n' +
      '  Plan Queries knows: ' + planLocations.join(' | ') + '\n' +
      '  this node knows:    ' + mine.join(' | ') + '\n' +
      '  Both are keyed by the settings tab\'s `locations` strings. A location one of them knows and\n' +
      '  the other does not is a location that is searched and never filtered, or filtered and never\n' +
      '  searched.'
    );
  }

  // 3. Every geography target has at least one token, and no token is blank or mixed case. A blank
  // token would match every string and turn the drop branch off for the whole run.
  for (const k of Object.keys(GEO_TARGETS)) {
    const toks = GEO_TARGETS[k].tokens;
    if (!Array.isArray(toks) || !toks.length) throw new Error('Filter: geography target ' + k + ' has no tokens, so it can never keep a row.');
    for (const tok of toks) {
      if (typeof tok !== 'string' || tok.trim() === '') throw new Error('Filter: geography target ' + k + ' has a blank token, which would match every location string.');
      if (tok !== tok.toLowerCase()) throw new Error('Filter: geography token ' + JSON.stringify(tok) + ' is not lowercase, and matching is done on a lowercased string.');
    }
  }
  for (const list of [WORLDWIDE_TOKENS, NO_INFO_TOKENS, NON_REMOTE_TOKENS, REMOTE_TOKENS]) {
    for (const tok of list) {
      if (typeof tok !== 'string' || tok.trim() === '' || tok !== tok.toLowerCase()) {
        throw new Error('Filter: ' + JSON.stringify(tok) + ' is not a usable lowercase token.');
      }
    }
  }

  // 3a. EVERY SCOPE DECLARES ITS WORK TYPE RULE, and it must be one of the two words the runtime
  // switches on. A scope with no rule would fall through to "not remote_only" and silently accept
  // onsite work, which for Remote EU and Remote UK is precisely the thing he asked to be refused.
  for (const k of Object.keys(GEO_TARGETS)) {
    const wt = GEO_TARGETS[k].work_types;
    if (wt !== 'any' && wt !== 'remote_only') {
      throw new Error(
        'Filter: geography target ' + JSON.stringify(k) + ' declares work_types ' + JSON.stringify(wt) + '.\n' +
        '  It must be "any" or "remote_only". A missing value would read as "not remote only" and the\n' +
        '  scope would accept onsite work without anybody choosing that.'
      );
    }
  }

  // 3b. THE TOKEN LISTS ARE DISJOINT. This is the check that keeps the precedence rule honest.
  // While 'emea' sat in Remote EU and 'europe' sat in Remote EMEA, one string matched two scopes
  // with OPPOSITE work type rules, and which one won came down to the order of a spreadsheet cell.
  // Overlap is not banned because it is untidy, it is banned because the rule stops being decidable.
  {
    const owner = {};
    const clashes = [];
    for (const k of Object.keys(GEO_TARGETS)) {
      for (const tok of GEO_TARGETS[k].tokens) {
        if (owner[tok] !== undefined && owner[tok] !== k) clashes.push(JSON.stringify(tok) + ' is in both ' + owner[tok] + ' and ' + k);
        owner[tok] = k;
      }
    }
    if (clashes.length) {
      throw new Error(
        'Filter: ' + clashes.length + ' geography token(s) belong to more than one scope:\n  - ' + clashes.join('\n  - ') + '\n' +
        '  Two scopes can hold opposite work type rules, so a row matching both has no defined answer.\n' +
        '  Either the token belongs to exactly one scope, or the scopes are not really different.'
      );
    }
    // A token that is ALSO an arrangement word would be stripped as "no geographic information"
    // before it could ever match, so the scope would look populated and match nothing.
    const arrangement = NO_INFO_TOKENS.concat(NON_REMOTE_TOKENS, REMOTE_TOKENS);
    const ghosts = Object.keys(owner).filter((t) => arrangement.indexOf(t) !== -1);
    if (ghosts.length) {
      throw new Error(
        'Filter: geography token(s) ' + JSON.stringify(ghosts) + ' are also arrangement words.\n' +
        '  stripNoInfo removes those before the geography test runs, so the token could never fire and\n' +
        '  the scope would silently be narrower than it reads.'
      );
    }
  }

  // 3c. THE PRECEDENCE LIST COVERS EVERY SCOPE EXACTLY ONCE. A scope missing from it would be
  // unreachable at run time no matter how many tokens it carries, which is the most expensive kind
  // of silent: the settings tab lists it, the plan searches it, and the filter never keeps a row for
  // it. A duplicate would make the second copy dead and say nothing.
  {
    const want = Object.keys(GEO_TARGETS).slice().sort();
    const have = GEO_PRECEDENCE.slice().sort();
    const dupes = GEO_PRECEDENCE.filter((k, i) => GEO_PRECEDENCE.indexOf(k) !== i);
    if (dupes.length) throw new Error('Filter: GEO_PRECEDENCE lists ' + JSON.stringify(dupes) + ' more than once.');
    if (want.length !== have.length || want.some((k, i) => k !== have[i])) {
      throw new Error(
        'Filter: GEO_PRECEDENCE and GEO_TARGETS do not cover the same scopes.\n' +
        '  targets:    ' + want.join(' | ') + '\n' +
        '  precedence: ' + have.join(' | ') + '\n' +
        '  A scope absent from the precedence list is never evaluated and can never keep a row.'
      );
    }
  }

  // 3d. THE TWO NODES AGREE ABOUT WORK TYPE. Plan Queries decides what LinkedIn is ASKED for
  // (f_WT or no f_WT) and this node decides what is KEPT. They are two halves of one rule, written
  // in two files, and they drift in a way no run reports: a scope asked for remote only but filtered
  // as any collects nothing but remote and looks like a market with no onsite work in it, and the
  // reverse collects onsite jobs and then throws them away after paying for the call.
  {
    const t = /^const LINKEDIN_TARGETS = (\{.*\});$/m.exec(PLAN_CODE);
    const planTargets = JSON.parse(t[1]);
    const bad = [];
    for (const k of Object.keys(GEO_TARGETS)) {
      const mine = GEO_TARGETS[k].work_types;
      const theirs = planTargets[k] && planTargets[k].work_types_accepted;
      if (theirs === undefined) { bad.push(k + ': Plan Queries carries no work_types_accepted'); continue; }
      if (mine !== theirs) bad.push(k + ': this node says ' + JSON.stringify(mine) + ', Plan Queries says ' + JSON.stringify(theirs));
    }
    if (bad.length) {
      throw new Error(
        'Filter: the two nodes disagree about which work types a scope accepts:\n  - ' + bad.join('\n  - ') + '\n' +
        '  Plan Queries sends the f_WT and this node enforces the rule. They have to be the same rule.'
      );
    }
  }

  // 4. The two item kinds this node sorts on are the ones the collectors actually emit.
  for (const f of ['08-extract-linkedin.js', '16-extract-indeed-jobs.js', '18-extract-board-jobs.js']) {
    const code = require('./' + f).parameters.jsCode;
    if (code.indexOf("_kind: 'job'") === -1 || code.indexOf("_kind: 'source_report'") === -1) {
      throw new Error(
        'Filter: ' + f + ' no longer emits both _kind values this node routes on. Filtering on a\n' +
        '  kind nobody emits silently drops every row, or silently filters every report.'
      );
    }
  }

  // 5. The row shape this node preserves is the contract's, unchanged. This node adds and removes
  // no sheet column; it only decides which rows live.
  if (!Array.isArray(CONTRACT.shared_row_shape) || CONTRACT.shared_row_shape.indexOf('posted_at') === -1) {
    throw new Error('Filter: the contract has no posted_at column, and this node normalises it.');
  }

  // 6. The settings schema still calls max_scored_per_run a number and the two title lists lists.
  const S = settingsSchema();
  if (S.number.indexOf('max_scored_per_run') === -1) throw new Error('Filter: max_scored_per_run is no longer a number in the settings schema, and the cap arithmetic assumes it is.');
  for (const k of ['keep_if_title_has', 'always_drop', 'locations']) {
    if (S.list.indexOf(k) === -1) throw new Error('Filter: ' + k + ' is no longer a list in the settings schema.');
  }
  for (const k of ['keep_if_title_has', 'always_drop']) {
    if (S.lowercase_lists.indexOf(k) === -1) {
      throw new Error('Filter: ' + k + ' is no longer validated as lowercase, and this node matches against a lowercased title. An uppercase term in the cell would silently never match.');
    }
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Filter. Title, geography, freshness. The reports ride through untouched.
// ---------------------------------------------------------------------------
const items = $input.all();

let plannedAll;
try {
  plannedAll = $('Plan Queries').all().map((i) => i.json);
} catch (e) {
  throw new Error('Filter: cannot reach Plan Queries (' + e.message + '). Every rule this node applies comes from there, and filtering with no rules would pass everything through and look like a good day.');
}
if (!plannedAll.length) throw new Error('Filter: Plan Queries emitted nothing, so there are no rules to filter with.');

const run = plannedAll[0].run || {};
const F = plannedAll[0].filters || {};
const problems = [];
for (const k of REQUIRED_FILTER_KEYS) {
  if (F[k] === undefined || F[k] === null) problems.push(k + ' is missing from filters');
}
for (const k of ['keep_if_title_has', 'always_drop', 'locations']) {
  if (F[k] !== undefined && !Array.isArray(F[k])) problems.push(k + ' is not a list');
  else if (Array.isArray(F[k]) && F[k].length === 0) problems.push(k + ' is empty, and an empty filter list is not "everything", it is a run that keeps nothing or keeps everything depending on which list it is');
}
if (!isFinite(Number(F.max_scored_per_run)) || Number(F.max_scored_per_run) < 1) {
  problems.push('max_scored_per_run is ' + JSON.stringify(F.max_scored_per_run) + ', which is not a usable cap');
}
if (problems.length) {
  throw new Error('Filter: the rule set from the settings tab is unusable:\\n  - ' + problems.join('\\n  - ') +
    '\\nThis stops the run rather than filtering with half a rule set, because a half-applied filter is indistinguishable from a quiet day.');
}

// --- matching ---------------------------------------------------------------
const WORD_CHAR = /[\\p{L}\\p{N}]/u;
const HAS_CONTENT = /[\\p{L}\\p{N}]/u;

// Token-boundary containment, BY INDEX. Not the regex \\b: these terms carry . - and &, and \\b is
// defined against \\w, which puts a boundary in the middle of every one of them.
function tokenMatch(hay, term) {
  if (!term) return false;
  const h = String(hay);
  const t = String(term);
  if (!t.length) return false;
  let i = h.indexOf(t);
  while (i !== -1) {
    const before = i === 0 ? '' : h.charAt(i - 1);
    const after = (i + t.length >= h.length) ? '' : h.charAt(i + t.length);
    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) return true;
    i = h.indexOf(t, i + 1);
  }
  return false;
}
function substrMatch(hay, term) {
  if (!term) return false;
  return String(hay).indexOf(String(term)) !== -1;
}
// Drop the diacritics so a Swedish spelling matches an English one and the other way round.
function fold(s) {
  let out = String(s);
  try { out = out.normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); } catch (e) { /* normalize is standard; if it is ever absent the raw string still matches */ }
  return out.replace(/\\u00F8/g, 'o').replace(/\\u00E6/g, 'ae').replace(/\\u00DF/g, 'ss');
}

// --- posted_at, one column, one format --------------------------------------
// Accepts exactly two shapes and refuses everything else on purpose. A date-TIME with no offset is
// read by JavaScript as LOCAL time, which silently adopts whatever timezone the n8n process has and
// moves a job across the window boundary by an hour or two. The board collector already normalises
// to UTC, so one arriving here means that normalisation broke, and the honest answer is to say so
// rather than to guess the offset.
const RE_DATE_ONLY = /^(\\d{4})-(\\d{2})-(\\d{2})$/;
const RE_INSTANT = /^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})$/;
function normalisePostedAt(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { iso: null, precision: 'none', problem: 'no posted_at on the row' };
  }
  const s = String(raw).trim();
  if (RE_DATE_ONLY.test(s)) {
    // Start of day UTC, declared. There is no time in the source, so any instant is a convention;
    // this one is the only convention that does not also depend on which side of a DST change the
    // date falls. precision 'day' travels with the row so nothing downstream reads midnight as a
    // measurement.
    return { iso: s + 'T00:00:00.000Z', precision: 'day', problem: null };
  }
  if (RE_INSTANT.test(s)) {
    const ms = Date.parse(s);
    if (!isFinite(ms)) return { iso: null, precision: 'none', problem: 'looks like an instant and does not parse: ' + s };
    return { iso: new Date(ms).toISOString(), precision: 'instant', problem: null };
  }
  return {
    iso: null,
    precision: 'none',
    problem: 'unrecognised date ' + JSON.stringify(s.slice(0, 40)) +
      '. This node accepts YYYY-MM-DD or a full ISO instant carrying Z or an offset, and nothing else, ' +
      'because a date-time with no offset is read as local time and moves the row across the window by hours.',
  };
}

// --- geography --------------------------------------------------------------
// LONGEST TOKEN FIRST, and it is not cosmetic. Stripping in declared order lets a short token eat
// the head of a longer one: with 'office' removed first, 'home office' no longer matches and the
// leftover word 'home' reads as a place name, so a row whose location says nothing at all gets
// dropped as if it named somewhere.
const NO_INFO_SORTED = NO_INFO_TOKENS.slice().sort((a, b) => b.length - a.length);
function stripNoInfo(s) {
  let out = s;
  for (const tok of NO_INFO_SORTED) {
    let guard = 0;
    while (tokenMatch(out, tok) && guard < 20) {
      const i = out.indexOf(tok);
      if (i === -1) break;
      const before = i === 0 ? '' : out.charAt(i - 1);
      const after = (i + tok.length >= out.length) ? '' : out.charAt(i + tok.length);
      if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) {
        out = out.slice(0, i) + ' ' + out.slice(i + tok.length);
      } else {
        break;
      }
      guard += 1;
    }
  }
  return out;
}

function geoDecide(locationRaw, remote) {
  const raw = locationRaw === null || locationRaw === undefined ? '' : String(locationRaw);
  const low = raw.toLowerCase();
  const folded = fold(low);
  if (!HAS_CONTENT.test(low)) {
    return { verdict: 'unknown', why: 'no location on the row', token: null, scope: null };
  }
  // ACTIVE_GEO_KEYS is ordered by GEO_PRECEDENCE, not by the settings cell, so the scope a row is
  // judged in is the most SPECIFIC one it matches rather than whichever the sheet happened to list
  // first. That matters because the scope decides the work type rule and two scopes can hold
  // opposite ones.
  for (const key of ACTIVE_GEO_KEYS) {
    for (const tok of GEO_TARGETS[key].tokens) {
      if (tokenMatch(low, tok) || tokenMatch(folded, tok)) {
        return { verdict: 'keep', why: 'matches the settings location ' + key, token: tok, scope: key };
      }
    }
  }
  for (const tok of WORLDWIDE_TOKENS) {
    if (tokenMatch(low, tok) || tokenMatch(folded, tok)) {
      // Deliberately carries NO scope. A job open to everywhere is open to Sweden, and Sweden
      // accepts every work type, so there is no remote-only rule that could honestly be applied to
      // it. Handing it a scope would mean picking one of his locations arbitrarily and then
      // enforcing that location's work type rule on a posting that named no location at all.
      return { verdict: 'keep', why: 'open to everywhere, which includes every location in the settings tab', token: tok, scope: null };
    }
  }
  const left = stripNoInfo(folded);
  if (!HAS_CONTENT.test(left)) {
    return { verdict: 'unknown', why: 'the location says how the work is done, not where, so it is not evidence of anywhere', token: null, scope: null };
  }
  return {
    verdict: 'drop',
    why: remote === true
      ? 'a remote job restricted to somewhere that is not in the settings locations'
      : 'names a place that is not in the settings locations',
    token: null,
    scope: null,
  };
}

// --- work type --------------------------------------------------------------
// THE RULE HE ASKED FOR ON 2026-09-15, and the half of it that matters is what it REFUSES to do.
//
// "stop dropping them" is the instruction, so the burden of proof sits on the drop. A scope that
// accepts any work type never drops. A remote-only scope drops a row ONLY on evidence that the row
// is actually not remote, and an ABSENT work type is not that evidence.
//
// That asymmetry is not caution for its own sake, it is forced by what the sources actually carry:
//   six boards hardcode remote:true, so they can never state otherwise;
//   arbeitnow is the only board that measures it per row, and its extractor returns null rather
//     than false when the field is missing, so a false here was really measured;
//   LinkedIn has no remote field at all and the value is INFERRED FROM THE REQUEST, true when the
//     query carried f_WT=2 and null otherwise. The new Gulf and non-EU Europe scopes send no f_WT
//     on purpose, so every row they collect arrives with remote null.
// If null were treated as onsite, those two brand new scopes would collect rows all morning and
// this node would throw every one of them away, and the run report would show a healthy collection
// and an empty sheet. That is the exact failure the rule is written against.
//
// THE THREE THINGS THAT COUNT AS EVIDENCE, and nothing else does:
//   E1  the row states remote === false, which only a source that measures it per row can produce.
//   E2  the location string carries an arrangement word that means somewhere ("hybrid", "on-site")
//       and does NOT also carry a remote word. A string saying both has demonstrated nothing.
//   E3  the query itself asked for onsite or hybrid (f_WT 1 or 3). No scope sends those today, so
//       this is a guard against a future setting rather than a live rule, and it is here because a
//       rule that only handles today's values is how the next change ships a hole.
function workTypeDecide(row, scopeKey) {
  if (!scopeKey || !GEO_TARGETS[scopeKey]) {
    return { verdict: 'keep', why: 'no scope was resolved for this row, so there is no work type rule to apply', evidence: null };
  }
  const rule = GEO_TARGETS[scopeKey].work_types;
  if (rule !== 'remote_only') {
    return { verdict: 'keep', why: 'the scope ' + scopeKey + ' accepts every work type', evidence: null };
  }
  const c = row._collect || {};
  const loc = fold(String(row.location === null || row.location === undefined ? '' : row.location).toLowerCase());

  if (row.remote === false) {
    return { verdict: 'drop', why: scopeKey + ' is remote only and the source states this row is not remote', evidence: 'remote===false, stated per row by the source' };
  }
  let said = null;
  for (const tok of NON_REMOTE_TOKENS) { if (tokenMatch(loc, tok)) { said = tok; break; } }
  if (said) {
    let cancels = null;
    for (const tok of REMOTE_TOKENS) { if (tokenMatch(loc, tok)) { cancels = tok; break; } }
    if (!cancels) {
      return { verdict: 'drop', why: scopeKey + ' is remote only and the location says ' + JSON.stringify(said), evidence: 'location token ' + JSON.stringify(said) + ' with no remote word beside it' };
    }
  }
  if (c.work_type === '1' || c.work_type === '3') {
    return { verdict: 'drop', why: scopeKey + ' is remote only and the query asked LinkedIn for f_WT=' + c.work_type, evidence: 'f_WT=' + c.work_type + ' is onsite or hybrid' };
  }
  return {
    verdict: 'keep',
    why: scopeKey + ' is remote only and nothing on this row demonstrates it is not remote, so it is kept rather than dropped on an absent inference',
    evidence: null,
  };
}

// --- sort the stream --------------------------------------------------------
const jobs = [];
const reports = [];
const strays = [];
for (const it of items) {
  const j = (it && it.json) || {};
  if (j._kind === 'job') jobs.push(it);
  else if (j._kind === 'source_report') reports.push(it);
  else strays.push(j);
}

// --- the sources that were never asked to run -------------------------------
// A SWITCHED-OFF SOURCE HAS NO COLLECTOR TO REPORT FOR IT, and until now it produced no report at
// all. That gap was flagged in Stage B, restated in Extract Indeed Jobs and again in Extract Board
// Jobs, and it is a real one: with no row of its own, "switched off" and "ran and found nothing"
// look identical to Stage F, and the second of those is a fault while the first is a decision.
//
// The report is synthesised HERE and not in a collector, deliberately. A disabled source's branch
// never executes, so no node on that branch can speak for it. This node always runs: Plan Queries
// refuses an empty plan, every collector emits one source_report unconditionally, so Combine always
// carries at least one item and this node is always reached. It also already holds the run block,
// which carries the whole disabled list, so nothing new has to be fetched or wired to produce it.
//
// The verdict is its own word, 'disabled', never 'ok' with zero rows and never 'down'. It is not
// down, nobody called it. reported_by says Filter so a reader is never misled into thinking a
// collector ran. source_down is false and status_token null on purpose: an off switch must not
// page anyone.
const disabledSources = (run.plan && run.plan.disabled_sources) || [];
const reportedSources = {};
for (const r of reports) reportedSources[((r && r.json) || {}).source] = true;
const disabledReports = [];
for (const d of disabledSources) {
  const key = d && d.source;
  if (!key) continue;
  // A source that somehow reported for itself keeps its own report. Two reports for one source
  // would make every per-source count in Stage F double.
  if (reportedSources[key]) continue;
  reportedSources[key] = true;
  disabledReports.push({
    json: {
      _kind: 'source_report',
      source: key,
      lane: LANE_NUMBER,
      reported_by: 'Filter',
      run_started_at: run.run_started_at || null,
      window_start: run.window_start || null,
      window_end: run.window_end || null,
      verdict: 'disabled',
      source_down: false,
      status_token: null,
      reason: (d && d.reason) || 'switched off in the settings tab',
      planned_queries: 0,
      planned_calls: 0,
      calls_made: 0,
      responses_received: 0,
      rows_emitted: 0,
      warnings: [],
      note: 'This source was switched OFF for this run and cost zero calls. Its branch never executed, so no collector could report for it and this row is synthesised from the plan. Zero rows here is a decision, not a fault, and it is NOT the same as a source that ran and found nothing.',
    },
    pairedItem: { item: 0 },
  });
}

const ACTIVE_GEO_KEYS = [];
for (const loc of F.locations) {
  if (!GEO_TARGETS[loc]) {
    throw new Error(
      'Filter: the settings tab lists location ' + JSON.stringify(loc) + ' and this node has no geography ' +
      'vocabulary for it, so every row would be judged against the OTHER locations only and the new one ' +
      'would do nothing.\\n  Known: ' + Object.keys(GEO_TARGETS).join(' | ') +
      '\\n  Add it here and in LINKEDIN_TARGETS in Plan Queries, in the same edit.'
    );
  }
  ACTIVE_GEO_KEYS.push(loc);
}
// ORDERED BY GEO_PRECEDENCE, never by the settings cell. The sheet decides WHICH scopes are active;
// this file decides in what order they are tested, because the order settles what happens to a row
// that matches two of them and those two can carry opposite work type rules. Sorting here rather
// than trusting the cell is what makes "most specific place wins" a property of the code instead of
// a property of how somebody typed a list.
ACTIVE_GEO_KEYS.sort((a, b) => GEO_PRECEDENCE.indexOf(a) - GEO_PRECEDENCE.indexOf(b));

// --- the four rules ---------------------------------------------------------
const counts = {
  jobs_in: jobs.length,
  kept: 0,
  dropped_always_drop: 0,
  dropped_no_keep_term: 0,
  dropped_no_title: 0,
  dropped_geo: 0,
  dropped_work_type: 0,
  dropped_too_old: 0,
};
const dropTermHits = {};
const keepTermHits = {};
const geoDropSamples = {};
const workTypeDropSamples = {};
const workTypeDropEvidence = {};
let workTypeKeptUnproven = 0;
const perSourceIn = {};
const perSourceKept = {};
let keptUndated = 0;
let windowSkippedServerSide = 0;
let geoSkippedServerSide = 0;
let geoUnknownKept = 0;
let dateProblems = 0;
const dateProblemSamples = [];
let precisionDay = 0;
let precisionInstant = 0;

const kept = [];

for (const it of jobs) {
  const row = Object.assign({}, it.json);
  const c = row._collect || {};
  const src = row.source || c.source || 'unknown';
  perSourceIn[src] = (perSourceIn[src] || 0) + 1;

  // posted_at first: the window rule and the cap both read the normalised value.
  const posted = normalisePostedAt(row.posted_at);
  row.posted_at = posted.iso;
  if (posted.precision === 'day') precisionDay += 1;
  if (posted.precision === 'instant') precisionInstant += 1;
  if (posted.problem && row.posted_at === null && c.posted_at_problem === undefined && String(it.json.posted_at || '').trim() !== '') {
    dateProblems += 1;
    if (dateProblemSamples.length < 5) dateProblemSamples.push({ source: src, job_id: row.job_id, raw: it.json.posted_at, problem: posted.problem });
  }

  const title = String(row.title === null || row.title === undefined ? '' : row.title).toLowerCase();
  const f = {
    posted_at_raw: it.json.posted_at === undefined ? null : it.json.posted_at,
    posted_at_precision: posted.precision,
    posted_at_problem: posted.problem,
    window_start_effective: c.window_start_effective || c.window_start || run.window_start || null,
    verdict: null,
    reason: null,
    detail: null,
  };

  // 1. always_drop, on token boundaries, and it wins.
  let dropHit = null;
  for (const t of F.always_drop) { if (tokenMatch(title, t)) { dropHit = t; break; } }
  if (dropHit) {
    counts.dropped_always_drop += 1;
    dropTermHits[dropHit] = (dropTermHits[dropHit] || 0) + 1;
    continue;
  }

  // 2. keep_if_title_has, plain substring, the settings tab's own match_rule.
  if (!HAS_CONTENT.test(title)) {
    counts.dropped_no_title += 1;
    continue;
  }
  let keepHit = null;
  for (const t of F.keep_if_title_has) { if (substrMatch(title, t)) { keepHit = t; break; } }
  if (!keepHit) {
    counts.dropped_no_keep_term += 1;
    continue;
  }
  keepTermHits[keepHit] = (keepTermHits[keepHit] || 0) + 1;

  // 3. geography. It also RESOLVES THE SCOPE, which rule 3b then judges the work type against.
  let scopeKey = null;
  const serverGeo = typeof c.location_setting === 'string' && GEO_TARGETS[c.location_setting] !== undefined;
  if (serverGeo) {
    geoSkippedServerSide += 1;
    scopeKey = c.location_setting;
    f.detail = 'geography was applied at the source, the search was aimed at ' + c.location_setting;
  } else {
    const g = geoDecide(row.location, row.remote);
    if (g.verdict === 'drop') {
      counts.dropped_geo += 1;
      const keyLoc = String(row.location === null || row.location === undefined ? '(none)' : row.location).slice(0, 60);
      geoDropSamples[keyLoc] = (geoDropSamples[keyLoc] || 0) + 1;
      continue;
    }
    if (g.verdict === 'unknown') geoUnknownKept += 1;
    scopeKey = g.scope;
    f.detail = g.why;
  }
  f.scope = scopeKey;

  // 3b. WORK TYPE, new 2026-09-15. The scope resolved above says which work types he will take
  // there, and a row is dropped only on real evidence that it is not remote in a scope that is
  // remote only. Everything unproven is KEPT and counted, because dropping on an absent inference
  // is how a lane quietly collects nothing.
  const wt = workTypeDecide(row, scopeKey);
  f.work_type_rule = scopeKey && GEO_TARGETS[scopeKey] ? GEO_TARGETS[scopeKey].work_types : null;
  if (wt.verdict === 'drop') {
    counts.dropped_work_type += 1;
    workTypeDropSamples[scopeKey] = (workTypeDropSamples[scopeKey] || 0) + 1;
    const ev = wt.evidence || 'unstated';
    workTypeDropEvidence[ev] = (workTypeDropEvidence[ev] || 0) + 1;
    continue;
  }
  if (wt.evidence === null && f.work_type_rule === 'remote_only' && row.remote !== true) {
    // Kept in a remote-only scope without being able to show it is remote. Counted so the size of
    // the benefit of the doubt is readable rather than assumed.
    workTypeKeptUnproven += 1;
  }
  f.work_type_detail = wt.why;

  // 4. freshness, on the window the plan computed.
  if (c.window_filtered_server_side === true) {
    windowSkippedServerSide += 1;
  } else if (posted.iso === null) {
    keptUndated += 1;
  } else {
    const cut = f.window_start_effective ? Date.parse(f.window_start_effective) : null;
    if (cut !== null && isFinite(cut) && Date.parse(posted.iso) < cut) {
      counts.dropped_too_old += 1;
      continue;
    }
  }

  f.verdict = 'kept';
  f.reason = 'title matched ' + JSON.stringify(keepHit);
  row._filter = f;
  counts.kept += 1;
  perSourceKept[src] = (perSourceKept[src] || 0) + 1;
  kept.push({ json: row, pairedItem: { item: 0 } });
}

// --- the stage report -------------------------------------------------------
const warnings = [];
if (strays.length) {
  warnings.push(
    strays.length + ' item(s) arrived carrying neither _kind job nor _kind source_report and were NOT passed on. ' +
    'Every collector tags what it emits, so an untagged item means something else is wired into Combine. ' +
    'First keys seen: ' + JSON.stringify(strays.slice(0, 3).map((s) => Object.keys(s).slice(0, 8)))
  );
}
if (dateProblems > 0) {
  warnings.push(
    dateProblems + ' row(s) carried a posted_at this node refused. It accepts YYYY-MM-DD or a full ISO instant ' +
    'with Z or an offset. A date-time with NO offset is read as local time by JavaScript and moves a job across ' +
    'the window by an hour or two, which is far too small to notice and exactly big enough to matter. Those rows ' +
    'are kept with posted_at null rather than with a guess. Samples: ' + JSON.stringify(dateProblemSamples)
  );
}
if (keptUndated > 0) {
  warnings.push(
    keptUndated + ' row(s) have no usable posted_at and were KEPT rather than dropped, because losing a date must ' +
    'not lose a job. They sort LAST for the per-run cap, deliberately and not by accident, so a dated row is never ' +
    'displaced by one whose age nobody knows.'
  );
}
if (counts.dropped_geo > 0) {
  warnings.push(
    counts.dropped_geo + ' row(s) were dropped on GEOGRAPHY, and the location strings that caused it are listed in ' +
    'geo.dropped_locations. Location is free text in five different shapes across these sources, so this is the ' +
    'easiest rule in the lane to get wrong. Read that list on the first few runs: a string that should have been ' +
    'kept is a missing token in the geography vocabulary, which is one line in nodes/20-filter.js.'
  );
}
if (counts.dropped_work_type > 0) {
  warnings.push(
    counts.dropped_work_type + ' row(s) were dropped on WORK TYPE: they landed in a scope that is remote only and ' +
    'carried real evidence of not being remote. The evidence that did it is in work_type.dropped_on_evidence. ' +
    'Nothing is dropped here for an UNKNOWN work type, so this count can only grow when a source actually says so.'
  );
}
if (workTypeKeptUnproven > 0) {
  warnings.push(
    workTypeKeptUnproven + ' row(s) were KEPT in a remote-only scope without being able to prove they are remote. ' +
    'That is the rule working as written rather than a gap: dropping on an absent inference is how a lane quietly ' +
    'collects nothing. Read this number beside work_type.dropped if the sheet starts carrying onsite jobs he cannot take.'
  );
}
if (counts.jobs_in > 0 && counts.kept === 0) {
  warnings.push(
    'every one of the ' + counts.jobs_in + ' collected row(s) was filtered out. That is a real possible outcome on a ' +
    'quiet day and it is also what a broken rule set looks like, so the per-rule counts above are the thing to read. ' +
    'Nothing here distinguishes the two on its own.'
  );
}
if (!reports.length) {
  warnings.push(
    'no source_report reached this node at all. Each collector emits one unconditionally, so zero of them means no ' +
    'collector ran, which in turn means Combine fired on an empty stream. Stage F has nothing to write a verdict from.'
  );
}

const stageReport = {
  _kind: 'stage_report',
  stage: 'filter',
  lane: LANE_NUMBER,
  run_started_at: run.run_started_at || null,
  window_start: run.window_start || null,
  window_end: run.window_end || null,
  first_run: run.first_run === true,
  counts: counts,
  per_source_in: perSourceIn,
  per_source_kept: perSourceKept,
  reports_passed_through: reports.length,
  // Synthesised here, one per source that was switched off, so Stage F can tell an off switch from
  // a source that ran and found nothing. Counted separately from the ones a collector produced,
  // because conflating them would hide the difference this row exists to make visible.
  disabled_reports_added: disabledReports.length,
  disabled_sources: disabledReports.map((r) => r.json.source),
  strays_dropped: strays.length,
  title: {
    rule: F.match_rule || null,
    always_drop_terms: F.always_drop.length,
    keep_terms: F.keep_if_title_has.length,
    always_drop_matching: 'token boundary, by index, case insensitive, title only',
    keep_matching: 'plain substring, case insensitive, title only',
    always_drop_hits: dropTermHits,
    keep_hits: keepTermHits,
  },
  geo: {
    rule: F.geo_rule || null,
    locations: F.locations,
    precedence: ACTIVE_GEO_KEYS.slice(),
    precedence_why: 'most specific place first. A row matching two scopes is judged in the narrower one, because the scope decides the work type rule and two scopes can hold opposite rules. Declared in the node, never inherited from the order of the settings cell.',
    skipped_filtered_at_source: geoSkippedServerSide,
    kept_unknown_location: geoUnknownKept,
    dropped: counts.dropped_geo,
    dropped_locations: geoDropSamples,
  },
  work_type: {
    rule: 'per scope. Sweden, Gulf, Non-EU Europe and Remote EMEA accept onsite, hybrid and remote. Remote EU and Remote UK are remote only.',
    per_scope: (function () {
      const o = {};
      for (const k of ACTIVE_GEO_KEYS) o[k] = GEO_TARGETS[k].work_types;
      return o;
    }()),
    dropped: counts.dropped_work_type,
    dropped_by_scope: workTypeDropSamples,
    dropped_on_evidence: workTypeDropEvidence,
    kept_unproven_in_remote_only_scope: workTypeKeptUnproven,
    burden_of_proof: 'on the DROP. A row is dropped only where the source states remote===false, or the location names an arrangement that means somewhere with no remote word beside it, or the query itself asked for onsite or hybrid. An unknown work type is KEPT, because six of the eight sources cannot state it at all and LinkedIn only infers it from the request.',
  },
  language: {
    rule: F.language_rule || null,
    applied: false,
    why: 'language is never a filter in this lane. A Swedish fluency requirement is a red flag for the scorer, not a reason to drop.',
  },
  freshness: {
    window_start: run.window_start || null,
    window_hours: run.window_hours === undefined ? null : run.window_hours,
    window_reason: run.window_reason || null,
    dropped_too_old: counts.dropped_too_old,
    skipped_filtered_at_source: windowSkippedServerSide,
    kept_undated: keptUndated,
  },
  posted_at: {
    normalised_to: 'ISO 8601 UTC, one column one format',
    day_precision_rows: precisionDay,
    instant_precision_rows: precisionInstant,
    refused: dateProblems,
    day_precision_convention: 'a bare YYYY-MM-DD becomes T00:00:00.000Z and carries posted_at_precision day, so nothing downstream reads midnight as a measurement',
  },
  cap: {
    applied_here: false,
    applied_in: 'Remove Known',
    why: 'the cap limits what reaches the SCORER, and Remove Known sits between this node and the scorer. Capping before the known rows are removed spends the slots on rows that are about to be deleted, and it makes a capped backlog undrainable.',
    max_scored_per_run: Number(F.max_scored_per_run),
  },
  warnings: warnings,
};

// The reports ride through untouched, and they always go, even on a run where nothing survived.
// A Code node returning [] ends the branch, which would take Read Known Jobs and Remove Known with
// it and delete the evidence of exactly the run that most needs explaining.
return kept.concat(reports, disabledReports, [{ json: stageReport, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/20-filter.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const REQUIRED_FILTER_KEYS = ${JSON.stringify(REQUIRED_FILTER_KEYS)};`,
  `const GEO_TARGETS = ${JSON.stringify(GEO_TARGETS)};`,
  `const WORLDWIDE_TOKENS = ${JSON.stringify(WORLDWIDE_TOKENS)};`,
  `const NO_INFO_TOKENS = ${JSON.stringify(NO_INFO_TOKENS)};`,
  `const GEO_PRECEDENCE = ${JSON.stringify(GEO_PRECEDENCE)};`,
  `const NON_REMOTE_TOKENS = ${JSON.stringify(NON_REMOTE_TOKENS)};`,
  `const REMOTE_TOKENS = ${JSON.stringify(REMOTE_TOKENS)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Filter',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [3640, 160],
  connectFrom: 'Combine',
  notes: 'always_drop on token boundaries wins over keep_if_title_has as a substring, then geography, then the window the plan computed. Source reports ride through untouched. The per-run cap is in Remove Known, not here.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};
