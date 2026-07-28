// QA failure -> needs_review row. Never silently drop.
//
// F03: a QA-failed job has already paid for BOTH the match and the writer call, and
// neither reached run_log. Stage 4 spend is logged here so the ledger accounts for it.
// Stage 2 spend for the same job is already on its processed_jobs row, so summing the
// two tabs double-counts nothing.

__RATES_LIB__

const j = $json;
return { json: {
  date: new Date().toISOString().slice(0, 10),
  stage: 'stage5',
  job_posting_id: j.job_posting_id || '',
  job_title: j.job_title || '',
  company_name: j.company_name || '',
  job_location: j.job_location || '',
  url: j.url || '',
  fit_score: j.fit_score == null ? '' : j.fit_score,
  interest_score: j.interest_score == null ? '' : j.interest_score,
  rank_score: j.rank_score == null ? '' : j.rank_score,
  reasons: (j.qa_reasons || []).join('; '),
  stage4_input_tokens: j.stage4_input_tokens == null ? '' : j.stage4_input_tokens,
  stage4_output_tokens: j.stage4_output_tokens == null ? '' : j.stage4_output_tokens,
  stage4_cache_write_tokens: j.stage4_cache_write_tokens == null ? '' : j.stage4_cache_write_tokens,
  stage4_cache_read_tokens: j.stage4_cache_read_tokens == null ? '' : j.stage4_cache_read_tokens,
  stage4_model: j.stage4_model || '',
  stage4_cost: costOf(usageFrom(j, 'stage4'), j.stage4_model)
} };
