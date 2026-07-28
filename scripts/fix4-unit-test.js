// Fix4 logic proof: pull the LIVE #03 Dedup Against Log code, apply the seenErrored/suppressDrain
// guard, and run the three scenarios as pure functions (mocked node inputs). The one that matters:
// seen_ids read ERRORS while the bank is full -> the guard must prevent the whole-bank re-drain
// AND still process this run's genuinely-new jobs.
const fs = require('fs');
const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';

const FIX4_FIND = "for (const id of done) drainable.delete(id);";
const FIX4_REPLACE = "for (const id of done) drainable.delete(id);\n// Fix4: if the seen_ids read ERRORED (fail-open on Read Processed Log), the done set is\n// untrustworthy - never re-drain the historical bank; still process + bank new items below.\nlet seenErrored = false;\ntry { seenErrored = $('Seen Ids Failed').all().some(i => i.json && i.json.__seen_ids_error); } catch (e) { seenErrored = false; }\nif (seenErrored) drainable.clear();";

function makeDollar(state) {
  const mk = (rows) => ({ all: () => rows.map(r => ({ json: r })) });
  return (name) => {
    if (name === 'Read Processed Log') return mk(state.seen);
    if (name === 'Read Bank') return mk(state.bank);
    if (name === 'Read Sibling Log') return mk(state.sibling || []);
    if (name === 'Parse Jobs') return mk(state.parse);
    if (name === 'Seen Ids Failed') { if (state.seenFailedThrows) throw new Error('node not executed'); return mk(state.seenFailed || []); }
    throw new Error('unknown node ' + name);
  };
}

(async () => {
  const g = await fetch(`${BASE}/workflows/9XuIEfxS71DEetVR`, { headers: { 'X-N8N-API-KEY': KEY } });
  const wf = await g.json();
  const dedup = wf.nodes.find(n => n.name === 'Dedup Against Log');
  let code = dedup.parameters.jsCode;
  // sanity: DRAIN_CAP (Fix5a) is already live; assert then apply Fix4.
  if (!code.includes('DRAIN_CAP')) { console.log('WARN: DRAIN_CAP not present - Fix5a expected live'); }
  const hits = code.split(FIX4_FIND).length - 1;
  if (hits !== 1) { console.log(`ABORT: Fix4 find matched ${hits}x (expected 1)`); return; }
  code = code.split(FIX4_FIND).join(FIX4_REPLACE);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  try { new AsyncFunction(code); } catch (e) { console.log('ABORT: Fix4 Dedup syntax error: ' + e.message); return; }
  const fn = new Function('$', code); // runOnceForAllItems, uses only $('...') refs

  const bankPayload = (id) => JSON.stringify({ job_posting_id: id, job_title: 'T'+id, company_name: 'Co'+id, description: 'd', url: 'u' });
  const scenarios = [
    { name: 'A healthy: completed X in seen, banked Y in bank, new Z from parse',
      state: { seen: [{ job_posting_id: 'X', gate_status: 'pass' }], bank: [{ job_posting_id: 'Y', payload_json: bankPayload('Y') }], parse: [{ job_posting_id: 'Z', job_title: 'Znew' }], seenFailedThrows: true },
      expect: (out) => { const ids = out.map(o => o.json.job_posting_id); return ids.includes('Z') && ids.includes('Y') && !ids.includes('X'); },
      why: 'Z (new) + Y (drained); X not re-drained (in done). Normal.' },
    { name: 'B seen_ids ERRORED: seen empty, bank has X(completed)+Y, marker present, new Z',
      state: { seen: [], bank: [{ job_posting_id: 'X', payload_json: bankPayload('X') }, { job_posting_id: 'Y', payload_json: bankPayload('Y') }], parse: [{ job_posting_id: 'Z', job_title: 'Znew' }], seenFailed: [{ __seen_ids_error: true }] },
      expect: (out) => { const ids = out.map(o => o.json.job_posting_id); const drained = ids.filter(i => i === 'X' || i === 'Y'); return ids.includes('Z') && drained.length === 0; },
      why: 'GUARD FIRES: no bank re-drain (X,Y suppressed) but Z still processed. THIS is the mass-respend prevention.' },
    { name: 'C bank ERRORED: seen has X(completed), bank empty, new Z',
      state: { seen: [{ job_posting_id: 'X', gate_status: 'pass' }], bank: [], parse: [{ job_posting_id: 'Z', job_title: 'Znew' }], seenFailedThrows: true },
      expect: (out) => { const ids = out.map(o => o.json.job_posting_id); return ids.includes('Z') && ids.length === 1; },
      why: 'drainable empty -> no drain; Z processed. Safe (bank rows persist for next run).' },
    { name: 'D control (no guard would re-drain): same as B but proves the danger the guard removes',
      state: { seen: [], bank: [{ job_posting_id: 'X', payload_json: bankPayload('X') }, { job_posting_id: 'Y', payload_json: bankPayload('Y') }], parse: [{ job_posting_id: 'Z', job_title: 'Znew' }], seenFailed: [] , note: 'marker ABSENT -> guard does NOT fire (simulates the un-guarded bug)'},
      expect: (out) => { const ids = out.map(o => o.json.job_posting_id); const drained = ids.filter(i => i === 'X' || i === 'Y'); return drained.length === 2; },
      why: 'With NO error-marker, X+Y DO re-drain = the exact bug. Confirms the guard is what prevents it.' },
  ];

  let pass = 0;
  for (const s of scenarios) {
    let out, ok;
    try { out = fn(makeDollar(s.state)); ok = s.expect(out); }
    catch (e) { out = null; ok = false; console.log(`  ${s.name}\n    ERROR: ${e.message}`); continue; }
    if (ok) pass++;
    const ids = out.map(o => o.json.job_posting_id);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${s.name}\n        out ids=[${ids}] :: ${s.why}`);
  }
  console.log(`\n${pass}/${scenarios.length} Fix4 logic scenarios correct`);
})();
