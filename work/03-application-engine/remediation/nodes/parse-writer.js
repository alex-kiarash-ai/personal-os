// Stage 4: parse the writer JSON, merge with the job + gate context, capture tokens.
//
// F16: the dash sanitizers (deEm / deDashProse) are GONE from this node. They ran a
// slightly different rule set to the QA node's stripProse / stripRange, which then ran
// again over the already-cleaned text, so behaviour was path-dependent and editing one
// silently changed the other. Worse, the dashes_stripped ledger counter, the whole
// signal for how well the no-dash prompt rule works, undercounted because most dashes
// were already removed before QA counted them. QA is the final gate before render and
// already claims ownership in its own comment, so it keeps the logic and this node
// hands over raw model output.
//
// F07: same three-stage extractor as Parse Match (fence, assistant-prefill, substring).
// F03/F04: stage4_model is now captured (it was missing entirely, so a per-stage cost
// could not be priced), along with the cache token fields.

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

let prev = {};
try { prev = $('Stage 3 Gate').item.json; } catch (e) { prev = {}; }
const usage = (resp && resp.usage) ? resp.usage : {};

return { json: Object.assign({}, prev, {
  role_line: parsed ? parsed.role_line : null,
  profile: parsed ? parsed.profile : null,
  experience: parsed ? parsed.experience : null,
  skills: parsed ? parsed.skills : null,
  cover_letter: parsed ? parsed.cover_letter : null,
  stage4_parse_error: parse_error,
  stage4_input_tokens: usage.input_tokens || null,
  stage4_output_tokens: usage.output_tokens || null,
  stage4_cache_write_tokens: usage.cache_creation_input_tokens || null,
  stage4_cache_read_tokens: usage.cache_read_input_tokens || null,
  stage4_model: (resp && resp.model) || null
}) };
