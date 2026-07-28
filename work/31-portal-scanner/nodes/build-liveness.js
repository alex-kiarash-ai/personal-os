// Portal Scanner - Build Liveness Payload (runOnceForAllItems).
// Collapses every scan attempt into ONE Sheets values:batchUpdate body that stamps
// last_scanned (col H) + last_status (col I) on company_portals.
//
// One batched range update rather than a write per company: the Sheets write quota
// is 60/min/user and a per-company node would also fire once per input item.
//
// Status vocabulary (matches the plan): ok / empty / http_4xx / error.

const plans = $('Plan Scan').all();
const responses = $input.all();
const today = new Date().toISOString().slice(0, 19).replace('T', ' ');

const byCompany = new Map();
for (let i = 0; i < responses.length; i++) {
  const plan = (plans[i] && plans[i].json) || {};
  const res = responses[i].json || {};
  const company = plan.company || '(unknown)';
  if (!byCompany.has(company)) byCompany.set(company, { row: plan.rowNumber, attempts: [] });

  const status = Number(res.statusCode);
  let body = res.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }

  let count = 0;
  if (status === 200) {
    if (Array.isArray(body)) count = body.length;
    else if (body && Array.isArray(body.jobs)) count = body.jobs.length;
  }
  byCompany.get(company).attempts.push({ status: status, count: count });
}

const data = [];
for (const [, entry] of byCompany) {
  if (!entry.row) continue;
  let status = 'error';
  const ok = entry.attempts.find((a) => a.count > 0);
  if (ok) {
    status = 'ok';
  } else if (entry.attempts.some((a) => a.status === 200)) {
    status = 'empty';
  } else {
    const first4xx = entry.attempts.find((a) => a.status >= 400 && a.status < 500);
    const first5xx = entry.attempts.find((a) => a.status >= 500);
    if (first4xx) status = 'http_' + first4xx.status;
    else if (first5xx) status = 'http_' + first5xx.status;
  }
  data.push({
    range: 'company_portals!H' + entry.row + ':I' + entry.row,
    values: [[today, status]]
  });
}

if (data.length === 0) return [{ json: { valueInputOption: 'RAW', data: [] } }];
return [{ json: { valueInputOption: 'RAW', data: data } }];
