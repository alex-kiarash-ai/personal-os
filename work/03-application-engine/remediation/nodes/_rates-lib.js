// ---- SHARED COST LIB (F04) -------------------------------------------------
// MASTER COPY: work/03-application-engine/remediation/nodes/_rates-lib.js
// Injected verbatim into Format Processed Row, Format Review Row S5 and Compute
// Costs. n8n Code nodes cannot import, so this is duplicated by design. Edit the
// master and re-run the applier; never hand-edit one copy.
//
// Replaces hardcoded single-model constants. Two reasons that broke:
//   1. after F06 the match and writer stages can run DIFFERENT models, so one pair
//      of rate constants cannot describe both;
//   2. with prompt caching (F05) the usage object carries cache_creation_input_tokens
//      (billed at 1.25x input) and cache_read_input_tokens (0.1x). Ignoring them
//      silently under-reports every cached call.
// Rates are USD per MILLION tokens.
const RATES = {
  'claude-opus-4-8':   { in: 5,  out: 25, cache_write: 6.25, cache_read: 0.5 },
  'claude-sonnet-4-6': { in: 3,  out: 15, cache_write: 3.75, cache_read: 0.3 },
  // kimi-k3 (Moonshot, OpenAI-compatible, live in all four job engines 2026-07-27).
  // Moonshot has no separate cache-WRITE premium: a cache miss is billed at the plain
  // input rate ($3/M) and a cache hit at $0.30/M. So cache_write == in here, and the
  // Parse nodes map prompt_tokens_details.cached_tokens -> cache_read, cache_write -> null.
  'kimi-k3':           { in: 3,  out: 15, cache_write: 3,    cache_read: 0.3 },
  // Fallback deliberately uses the MOST expensive known rates: an unpriced model
  // should over-report, never quietly under-report. Add new models here explicitly.
  _fallback:           { in: 5,  out: 25, cache_write: 6.25, cache_read: 0.5 }
};

function rateFor(model) {
  return RATES[String(model || '')] || RATES._fallback;
}

// cost(usage, model) covering all four billable usage fields.
function costOf(usage, model) {
  const r = rateFor(model);
  const u = usage || {};
  const tin = Number(u.input_tokens) || 0;
  const tout = Number(u.output_tokens) || 0;
  const cw = Number(u.cache_creation_input_tokens) || 0;
  const cr = Number(u.cache_read_input_tokens) || 0;
  return +(((tin * r.in) + (cw * r.cache_write) + (cr * r.cache_read) + (tout * r.out)) / 1e6).toFixed(6);
}

// Rebuild a usage object from the flat stageN_* fields carried on the item.
function usageFrom(j, stage) {
  return {
    input_tokens: j[stage + '_input_tokens'],
    output_tokens: j[stage + '_output_tokens'],
    cache_creation_input_tokens: j[stage + '_cache_write_tokens'],
    cache_read_input_tokens: j[stage + '_cache_read_tokens']
  };
}
// ---- END SHARED COST LIB ---------------------------------------------------
