// Stage 2: parse Claude's JSON reply, merge with job fields, capture token usage.
//
// F07: the old extractor only stripped markdown fences at the string edges, so a
// single preamble line ("Here is the analysis:") failed the parse, dumped a good job
// into needs_review and threw away the tokens already paid for. extractJson now tries
// the cleaned string, then the assistant-prefill form (the build node appends an
// assistant turn opening with "{", so the reply comes back WITHOUT it), then the
// widest brace-to-brace substring. Order matters: it must work both before and after
// the prefill lands.
//
// F04/F05: cache token fields are captured so cached calls are billed correctly.
// F14: scores are clamped to 0-100 here, before the gate ranks on them.

const resp = $json;
let txt = '';
try { txt = resp.content[0].text; } catch (e) { txt = ''; }

function extractJson(raw) {
  let s = String(raw == null ? '' : raw).trim()
    .replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  try { return { ok: true, value: JSON.parse(s) }; } catch (e) {}
  if (s && s[0] !== '{') { try { return { ok: true, value: JSON.parse('{' + s) }; } catch (e) {} }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return { ok: true, value: JSON.parse(s.slice(a, b + 1)) }; } catch (e) {} }
  return { ok: false, value: null };
}

const ex = extractJson(txt);
const parsed = ex.ok ? ex.value : null;
const parse_error = ex.ok ? null : 'JSON parse failed after fence, prefill and substring recovery';

const job = $('Build Match Request').item.json;
const usage = (resp && resp.usage) ? resp.usage : {};

// F14: a malformed 830 would sail through the gate's isFinite check and poison rank
// ordering. Clamp at the boundary, immediately after parsing.
const clamp = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Math.min(100, Math.max(0, n));
};
if (parsed && parsed.fit_score !== undefined) parsed.fit_score = clamp(parsed.fit_score);
if (parsed && parsed.interest_score !== undefined) parsed.interest_score = clamp(parsed.interest_score);

return { json: Object.assign({
  job_posting_id: job.job_posting_id || null,
  job_title: job.job_title || null,
  company_name: job.company_name || null,
  job_location: job.job_location || null,
  url: job.url || null,
  work_conditions_required: job.work_conditions || null,
  origin_location: job.origin_location || null,
  origin_country: job.origin_country || null
}, parsed || {}, {
  stage2_parse_error: parse_error,
  stage2_input_tokens: usage.input_tokens || null,
  stage2_output_tokens: usage.output_tokens || null,
  stage2_cache_write_tokens: usage.cache_creation_input_tokens || null,
  stage2_cache_read_tokens: usage.cache_read_input_tokens || null,
  stage2_model: (resp && resp.model) || null
}) };
