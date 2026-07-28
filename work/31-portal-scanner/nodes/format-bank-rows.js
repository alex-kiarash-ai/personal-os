// Portal Scanner - Format Bank Rows (runOnceForAllItems).
// Emits the EXACT 6-key bank row shape the pipeline's drain lane expects. Any 7th
// key would silently create a ragged column via autoMapInputData +
// insertInNewColumn (break B4), so 'source' and every other field Match / Gate /
// Writer reads travels inside payload_json, which IS the job after drain.
//
// Input to this node is the processed_jobs read (executeOnce + alwaysOutputData);
// the scanned jobs come from Map + Prefilter + Cap by reference. That mirrors how
// the live engine wires Parse Jobs -> Read Processed Log -> Dedup Against Log.
//
// The scanner runs daily against boards that keep listing the same roles, so
// skipping ids already present in processed_jobs is what stops the bank (and the
// drain set) from growing a duplicate every morning.

// Soft-key dedup, added 2026-07-27 after the first live measurement. ATS boards post
// one row PER LOCATION with a distinct job id, so exact-id dedup alone let the same
// role bank repeatedly and burn a Match call each time: Lighthouse's "Account
// Executive - Business Intelligence" x5, Appfire's "Senior Data Analytics Engineer"
// x2. The soft key collapses them.
//
// Accepted false positive (plan ruling D1): two genuinely different roles at one
// company that normalize to the same string collapse into one. Bounded for a startup
// seed; add origin_country to the key when the seed grows to multi-city enterprises.
const normalize = (s) => String(s || '').toLowerCase()
  // Some boards suffix the location onto the title itself ("Reporting analyst |
  // SEB, Vilnius"), which defeats the key unless the suffix is cut first.
  .split('|')[0]
  .replace(/\((remote|hybrid|on-?site)\)/g, '')
  .replace(/\b(senior|junior|lead|principal|sr|jr)\b/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const softKey = (company, title) => normalize(company) + '|' + normalize(title);

const known = new Set();
const knownSoft = new Set();
for (const li of $input.all()) {
  const r = li.json || {};
  const id = String(r.job_posting_id || '');
  if (id) known.add(id);
  if (r.company_name && r.job_title) knownSoft.add(softKey(r.company_name, r.job_title));
}

const rows = [];
for (const it of $('Map + Prefilter + Cap').all()) {
  const job = { ...(it.json || {}) };
  const id = String(job.job_posting_id || '');
  if (!id || known.has(id)) continue;
  const sk = softKey(job.company_name, job.job_title);
  if (knownSoft.has(sk)) continue;
  known.add(id);
  knownSoft.add(sk);
  rows.push({ json: {
    job_posting_id: id,
    date: new Date().toISOString().slice(0, 10),
    company_name: job.company_name || '',
    job_title: job.job_title || '',
    gate_status: 'sourced_unscored',
    payload_json: JSON.stringify(job)
  } });
}

// Nothing new (every scanned role already banked): emit a marker so the IF has an
// item to route and the run still ends cleanly instead of dead-ending.
if (rows.length === 0) return [{ json: { _noop: true } }];
return rows;
