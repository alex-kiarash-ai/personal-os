// Portal Scanner - Map + Prefilter + Cap (runOnceForAllItems).
// Parses each ATS response into the pipeline's ground-truth job shape, picks the
// winning host per company, applies the title/location prefilter, then caps at the
// company's max_roles.
//
// Field shape is taken field-for-field from the live 'Parse Jobs' node, with the
// plan's D2 corrections applied:
//   - emit 'url', NOT 'job_url'                    (break B1)
//   - emit NON-EMPTY 'work_conditions'             (break B2: an empty allow-list
//     makes the Stage 3 gate skip its work-condition check entirely)
//   - omit seniority / employment_type / job_posted_date (nothing downstream reads them)
//   - 'source' lives INSIDE payload_json only, never as a top-level bank column (B4)
//
// The prefilter keyword lists are the ones Phase 0's detector proved against the
// real boards; keep them in sync with portal-detector.js.

// TIGHTENED 2026-07-27 after the first live measurement: 66 of 67 sourced roles
// scored 'target_role_neither' (1.5% pass rate vs #03's ~11%). The old list was the
// Phase 0 DETECTOR list, which is deliberately broad because its job was to answer
// "is there anything here at all". As a production prefilter it was wrong: bare
// 'agent', 'analytics', 'automation' and 'ai ' pulled in product-manager and
// platform-engineering roles wholesale, and 'business intelligence' matched
// Lighthouse's "Account Executive - Business Intelligence", a SALES job, five times.
//
// This lane feeds the BI gate only (ruling D7), so the include list is now BI /
// reporting / analytics head-nouns and the AI keywords are gone. When an AI-track
// pipeline is added, give it its own include list keyed off the company's track
// rather than widening this one.
const TITLE_INCLUDE = [
  'power bi', 'powerbi', 'business intelligence',
  'bi developer', 'bi analyst', 'bi consultant', 'bi engineer', 'bi specialist',
  'data analyst', 'data analytics', 'analytics engineer', 'analytics consultant',
  'analytics manager', 'analytics lead', 'insight analyst', 'insights analyst',
  'reporting analyst', 'reporting developer', 'reporting specialist',
  'data engineer', 'data warehouse', 'dwh', 'etl developer',
  'tableau', 'looker', 'qlik', 'dashboard'
];

// Applied AFTER the include list. An exclusion always wins, so a title only has to
// contain one of these to be dropped even if it also matched an include term. This
// is what kills the "Account Executive - Business Intelligence" class.
const TITLE_EXCLUDE = [
  // commercial / go-to-market
  'account executive', 'account manager', 'sales', 'business development',
  'bdr', 'sdr', 'partnerships', 'customer success', 'pre-sales', 'presales',
  // product / delivery management
  'product manager', 'product owner', 'program manager', 'project manager',
  'scrum master', 'delivery manager',
  // engineering disciplines that are not this CV
  'devops', 'sre', 'site reliability', 'quality assurance', 'qa automation',
  'magento', 'fullstack', 'full-stack', 'full stack', 'frontend', 'front-end',
  'backend', 'back-end', 'mobile', 'android', 'ios ', 'security',
  'machine learning engineer', 'ml engineer', 'data scientist',
  // seniority bands outside the target
  'director', 'head of', 'vp ', 'vice president', 'chief', 'intern', 'graduate',
  'apprentice', 'working student', 'recruiter', 'talent'
];

const LOCATION_KEYWORDS = [
  'remote', 'anywhere', 'global', 'worldwide', 'hybrid',
  'europe', 'emea', 'eu ', 'eu,', 'eu)', 'united kingdom', 'uk', 'uk&i', 'ireland',
  'sweden', 'stockholm', 'nordic', 'denmark', 'copenhagen', 'norway', 'oslo',
  'finland', 'helsinki', 'gothenburg', 'malmo',
  'london', 'dublin', 'madrid', 'spain', 'lisbon', 'portugal', 'barcelona',
  'amsterdam', 'netherlands', 'berlin', 'germany', 'munich', 'paris', 'france',
  'warsaw', 'poland', 'tallinn', 'estonia', 'vilnius', 'lithuania', 'riga', 'latvia',
  'dubai', 'qatar', 'saudi', 'uae', 'gulf', 'abu dhabi', 'doha', 'riyadh'
];

// The allow-list the Stage 3 gate checks 'work_condition_detected' against. The v1
// seed is remote-friendly EU / Nordic startups, so all three are acceptable; the
// point of setting it is that the gate performs the check instead of skipping it.
// When the seed grows past remote-friendly startups, promote this to a per-company
// 'work_conditions' column on company_portals.
const WORK_CONDITIONS = 'remote,hybrid,on-site';

// Recency window (Shaheen's call 2026-07-27): only consider roles posted in the last
// 72 hours. Before this the scanner had NO time filter and swept each board's whole
// back catalogue, relying on dedup alone to avoid reprocessing.
//
// Set to 100 (was 72) on 2026-07-27 to close a measured coverage hole. The cadence is
// Tue + Thu, so the Thu -> Tue gap is 96 hours. At 72h the Thu run covered Mon->Thu and
// the Tue run covered Sat->Tue, leaving Thu->Sat covered by neither; because the window
// is absolute those roles could never be picked up on a later run. Measured cost of
// that hole against the live boards: ~4-6 matching roles per week.
// 100 = the 96h worst-case gap plus 4h of margin. #03 hit the same problem from the
// other side and widened "Past 24 hours" to "Past week" for the same reason.
const MAX_AGE_HOURS = 100;

// Greenhouse's updated_at is NOT a recency signal (boards re-touch every row; all 99
// Xebia jobs read 0-3 days), so first_published is the field that means anything.
const ageHours = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
};

const COUNTRY_HINTS = [
  ['sweden', 'SE'], ['stockholm', 'SE'], ['gothenburg', 'SE'], ['malmo', 'SE'],
  ['denmark', 'DK'], ['copenhagen', 'DK'], ['norway', 'NO'], ['oslo', 'NO'],
  ['finland', 'FI'], ['helsinki', 'FI'],
  ['united kingdom', 'GB'], ['london', 'GB'], ['england', 'GB'], ['scotland', 'GB'],
  ['ireland', 'IE'], ['dublin', 'IE'],
  ['spain', 'ES'], ['madrid', 'ES'], ['barcelona', 'ES'],
  ['portugal', 'PT'], ['lisbon', 'PT'],
  ['netherlands', 'NL'], ['amsterdam', 'NL'],
  ['germany', 'DE'], ['berlin', 'DE'], ['munich', 'DE'],
  ['france', 'FR'], ['paris', 'FR'],
  ['poland', 'PL'], ['warsaw', 'PL'],
  ['estonia', 'EE'], ['lithuania', 'LT'], ['latvia', 'LV'],
  ['uae', 'AE'], ['dubai', 'AE'], ['abu dhabi', 'AE'],
  ['qatar', 'QA'], ['doha', 'QA'], ['saudi', 'SA'], ['riyadh', 'SA']
];

// Greenhouse ships its content field as ESCAPED html (&lt;div&gt;...), so entities
// must be decoded BEFORE tags are stripped. Doing it the other way round leaves the
// markup intact and feeds raw html into the Match prompt (caught on the first live
// scan, 2026-07-27). Decode, strip, then decode again for entities that were
// themselves escaped inside the markup. '&amp;' is always decoded last so
// '&amp;lt;' cannot turn into a '<'.
const decode = (s) => String(s == null ? '' : s)
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
  .replace(/&amp;/g, '&');

const stripHtml = (raw) => {
  let s = decode(raw);
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decode(s);
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const PARSERS = {
  greenhouse: (b) => (b && Array.isArray(b.jobs) ? b.jobs : []).map((j) => ({
    id: String(j.id || ''),
    title: j.title || '',
    location: (j.location && j.location.name) || '',
    url: j.absolute_url || '',
    posted_at: j.first_published || j.updated_at || '',
    description: stripHtml(j.content || '')
  })),
  lever: (b) => (Array.isArray(b) ? b : []).map((j) => ({
    id: String(j.id || ''),
    title: j.text || '',
    location: (j.categories && j.categories.location) || '',
    url: j.hostedUrl || '',
    posted_at: Number.isFinite(Number(j.createdAt)) ? new Date(Number(j.createdAt)).toISOString() : '',
    description: stripHtml(j.descriptionPlain || j.description || '')
  })),
  ashby: (b) => (b && Array.isArray(b.jobs) ? b.jobs : []).map((j) => ({
    id: String(j.id || ''),
    title: j.title || '',
    location: j.location || (j.address && j.address.postalAddress && j.address.postalAddress.addressLocality) || '',
    url: j.jobUrl || '',
    posted_at: j.publishedAt || '',
    description: stripHtml(j.descriptionPlain || j.descriptionHtml || '')
  }))
};

const titlePasses = (t) => {
  const s = String(t || '').toLowerCase();
  if (TITLE_EXCLUDE.some((k) => s.indexOf(k) !== -1)) return false;
  return TITLE_INCLUDE.some((k) => s.indexOf(k) !== -1);
};
const locationPasses = (l) => {
  const s = String(l || '').toLowerCase().trim();
  if (!s) return true; // missing location: never silently drop
  return LOCATION_KEYWORDS.some((k) => s.indexOf(k) !== -1);
};
const countryOf = (l) => {
  const s = String(l || '').toLowerCase();
  for (const pair of COUNTRY_HINTS) if (s.indexOf(pair[0]) !== -1) return pair[1];
  return '';
};

const plans = $('Plan Scan').all();
const responses = $input.all();

// Group each response with its originating plan item (order is 1:1).
const byCompany = new Map();
for (let i = 0; i < responses.length; i++) {
  const plan = (plans[i] && plans[i].json) || {};
  const res = responses[i].json || {};
  const company = plan.company || '(unknown)';
  if (!byCompany.has(company)) byCompany.set(company, { plan: plan, attempts: [] });
  const status = Number(res.statusCode);
  let body = res.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const parser = PARSERS[plan.ats];
  const jobs = (status === 200 && parser) ? parser(body) : [];
  byCompany.get(company).attempts.push({ status: status, jobs: jobs, url: plan._url });
}

const out = [];
for (const [company, entry] of byCompany) {
  const plan = entry.plan;
  // Winning host = the first attempt that actually returned postings.
  const win = entry.attempts.find((a) => a.jobs.length > 0);
  if (!win) continue;

  const kept = win.jobs
    .filter((j) => titlePasses(j.title))
    .filter((j) => locationPasses(j.location))
    .filter((j) => {
      const age = ageHours(j.posted_at);
      // A board that omits a date is kept rather than silently dropped, same policy
      // as a missing location. All three Tier A ATSes do supply one.
      if (age === null) return true;
      return age <= MAX_AGE_HOURS;
    });

  // Sort newest-first BEFORE capping. The previous code sliced in raw board order on
  // the assumption that boards return newest-first, which was never verified; on a
  // busy board (Xebia lists 99 roles and hit the cap exactly on the first scan) that
  // silently dropped roles in arbitrary order.
  kept.sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0));
  const capped = kept.slice(0, plan.maxRoles || 15);

  for (const j of capped) {
    if (!j.id || !j.title) continue;
    out.push({ json: {
      job_posting_id: 'portal:' + plan.ats + ':' + j.id,
      job_title: j.title,
      company_name: company,
      job_location: j.location || '',
      description: j.description || '',
      url: j.url || '',
      work_conditions: WORK_CONDITIONS,
      origin_location: j.location || '',
      origin_country: countryOf(j.location),
      // Banked so earliness (Phase 4 kill-criterion a) is measurable at all. The
      // pipeline does not read it; the measurement does.
      job_posted_date: j.posted_at || '',
      source: 'portal:' + plan.ats
    } });
  }
}

return out;
