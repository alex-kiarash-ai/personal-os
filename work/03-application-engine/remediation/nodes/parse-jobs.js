// Flatten snapshot responses into one item per REAL job, carrying origin-row context.
// Input items are fullResponse blobs ({statusCode, body, ...}); unwrap .body.
//
// F01/F02 rework: the origin search row now arrives on the item as _ctx, attached by
// Poll Gate. The previous version resolved it with
// $('Attach Row Context').itemMatching(i), a paired-item lookup across the poll loop
// that the node's own comment admitted was fragile, and which the old per-item IF
// split could run more than once per execution. Only ready snapshots reach this node
// now; timed-out ones are routed to a needs_review row instead of being parsed into
// silence.
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const ctx = (item.json && item.json._ctx) || {};
  let body = (item.json && item.json.body !== undefined) ? item.json.body : item.json;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = []; } }
  let jobs;
  if (Array.isArray(body)) jobs = body;
  else if (body && Array.isArray(body.data)) jobs = body.data;
  else jobs = [body];
  for (const j of jobs) {
    if (!j || j.error) continue;
    if (!j.job_title && !j.url) continue;
    out.push({ json: {
      job_posting_id: j.job_posting_id || null,
      job_title: j.job_title || null,
      company_name: j.company_name || null,
      job_location: j.job_location || null,
      seniority: j.job_seniority_level || null,
      employment_type: j.job_employment_type || null,
      description: j.job_description_formatted || j.job_summary || null,
      url: j.url || null,
      job_posted_date: j.job_posted_date || null,
      work_conditions: ctx.work_conditions || null,
      origin_location: ctx.location || null,
      origin_country: ctx.country || null
    }});
  }
}
return out;
