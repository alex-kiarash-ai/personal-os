// Portal Scanner - Plan Scan (runOnceForAllItems).
// Turns company_portals rows into ONE ITEM PER CANDIDATE ENDPOINT.
//
// Why candidate endpoints instead of the plan's Switch + 3 HTTP branches: Phase 0
// proved that EU-hosted boards (Lighthouse, RemotePeople, SEB) only answer on the
// .eu API host. A Switch branch pins exactly one host, so it would silently miss
// them. Emitting both hosts as separate items lets ONE hardened HTTP node try each,
// and Map + Prefilter + Cap picks the first host that actually returned jobs.
//
// Row order from the Sheets read matches the sheet, so row number = index + 2
// (header is row 1). That number is what Stamp Liveness writes back to.
//
// v1 feeds the BI gate only (ruling D7: portal-to-BI ships first), so companies
// tracked 'ai' are skipped here rather than banked and burned on a gate rejection.

const ATS_HOSTS = {
  greenhouse: (s) => [
    'https://boards-api.greenhouse.io/v1/boards/' + s + '/jobs?content=true',
    'https://boards-api.eu.greenhouse.io/v1/boards/' + s + '/jobs?content=true'
  ],
  lever: (s) => [
    'https://api.lever.co/v0/postings/' + s + '?mode=json',
    'https://api.eu.lever.co/v0/postings/' + s + '?mode=json'
  ],
  ashby: (s) => ['https://api.ashbyhq.com/posting-api/job-board/' + s + '?includeCompensation=true']
};

const truthy = (v) => {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
};

const rows = $input.all();
const out = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i].json || {};
  const company = String(r.company || '').trim();
  if (!company) continue;

  const rowNumber = i + 2;
  const ats = String(r.ats_type || '').trim().toLowerCase();
  const slug = String(r.ats_slug || '').trim();
  const track = String(r.track || 'bi').trim().toLowerCase();
  const maxRolesRaw = Number(r.max_roles);
  const maxRoles = Number.isFinite(maxRolesRaw) && maxRolesRaw > 0 ? maxRolesRaw : 15;

  if (!truthy(r.active)) continue;
  if (track !== 'bi' && track !== 'both') continue;

  const build = ATS_HOSTS[ats];
  if (!build || !slug) continue;

  const urls = build(slug);
  for (let k = 0; k < urls.length; k++) {
    out.push({ json: {
      company: company,
      rowNumber: rowNumber,
      ats: ats,
      slug: slug,
      track: track,
      maxRoles: maxRoles,
      _url: urls[k],
      _hostIndex: k,
      _hostCount: urls.length
    } });
  }
}

return out;
