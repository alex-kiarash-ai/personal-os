// Every SCORED job goes to the processed log exactly once, pass or fail, so tomorrow's
// run never re-buys a Claude call for it.
//
// F03: stage 2 spend is logged HERE because this node fires exactly once for every
// scored job, including the ones that fail the gate. Append Run Log sits only on the
// QA-pass path, so before this change every gate-failed job's match tokens were spent
// and never counted, and the published "total AI spend" was bought partly by not
// counting failures. Writer spend cannot be logged here (this runs before the writer),
// so it goes on run_log for passes and on the S5 review row for QA failures.
//
// Reporting definition, also recorded in the sheet:
//   total spend = sum(processed_jobs.stage2_cost)
//               + sum(run_log.stage4_cost)
//               + sum(needs_review.stage4_cost where stage = stage5)

__RATES_LIB__

const j = $json;
return { json: {
  job_posting_id: j.job_posting_id || '',
  date: new Date().toISOString().slice(0, 10),
  company_name: j.company_name || '',
  job_title: j.job_title || '',
  gate_status: j.gate_status || '',
  stage2_input_tokens: j.stage2_input_tokens == null ? '' : j.stage2_input_tokens,
  stage2_output_tokens: j.stage2_output_tokens == null ? '' : j.stage2_output_tokens,
  stage2_cache_write_tokens: j.stage2_cache_write_tokens == null ? '' : j.stage2_cache_write_tokens,
  stage2_cache_read_tokens: j.stage2_cache_read_tokens == null ? '' : j.stage2_cache_read_tokens,
  stage2_model: j.stage2_model || '',
  stage2_cost: costOf(usageFrom(j, 'stage2'), j.stage2_model)
} };
