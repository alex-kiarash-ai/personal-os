// Per-job cost + run-log row. Instrumented from run one, cost cannot be reconstructed
// later.
//
// F04: rates are no longer hardcoded constants for a single model applied to both
// stages. Each stage is priced with the model that actually served it, through the
// shared RATES map, and all four billable usage fields are counted (input, output,
// cache write at 1.25x, cache read at 0.1x). Before this, a cached call or a
// cheaper-model match stage silently produced a wrong number.
//
// F03: per-stage costs are also emitted explicitly so run_log is consistent with the
// processed_jobs and needs_review tabs, and the three can be summed without guessing
// which portion of total_cost belonged to which stage.

__RATES_LIB__

const j = $('Rebind PDFs').item.json;

const stage2_cost = costOf(usageFrom(j, 'stage2'), j.stage2_model);
const stage4_cost = costOf(usageFrom(j, 'stage4'), j.stage4_model);
const claude_cost = +(stage2_cost + stage4_cost).toFixed(6);

// Bright Data Web Scraper API: about $0.75 / 1k records => $0.00075 per job record.
const brightdata_cost = 0.00075;
const total_cost = +(claude_cost + brightdata_cost).toFixed(6);

const tin = (Number(j.stage2_input_tokens) || 0) + (Number(j.stage4_input_tokens) || 0);
const tout = (Number(j.stage2_output_tokens) || 0) + (Number(j.stage4_output_tokens) || 0);

return { json: {
  date: new Date().toISOString().slice(0, 10),
  job_posting_id: j.job_posting_id || '',
  company: j.company_name || '',
  location: j.job_location || '',
  country: j.origin_country || '',
  target_role: j.target_role || '',
  fit_score: j.fit_score == null ? '' : j.fit_score,
  interest_score: j.interest_score == null ? '' : j.interest_score,
  rank_score: j.rank_score == null ? '' : j.rank_score,
  model: j.stage2_model || '',
  input_tokens: tin,
  output_tokens: tout,
  claude_cost,
  brightdata_cost,
  total_cost,
  drive_folder_url: j.drive_folder_url || '',
  job_url: j.url || '',
  status: 'draft_ready',
  stage2_model: j.stage2_model || '',
  stage2_cost,
  stage4_model: j.stage4_model || '',
  stage4_cost
} };
