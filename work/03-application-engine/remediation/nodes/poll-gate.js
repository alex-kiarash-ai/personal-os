// F02 hold-all + F01 partition. Runs once for ALL items, after Poll Fetch Snapshot.
//
// F02: the old design put a per-item IF straight after the fetch, so with several
// active search rows the ready snapshots ran on down the pipeline while the rest were
// still looping. That let a later wave's Read Processed Log observe an earlier wave's
// freshly banked sourced_unscored rows and drain them a second time inside one
// execution: same job matched twice, double AI spend, duplicate processed rows.
// The whole batch now advances together, so the pipeline below runs exactly once.
//
// Because every item loops the same number of times under hold-all, this node's own
// $runIndex IS the poll count. That was not true of the old per-item design, which is
// why the plan warned against trusting runIndex.
//
// F01: a non-200 that has run out of poll budget must NOT be allowed to flow into
// Parse Jobs, where the defensive parse silently turns it into zero jobs and the run
// completes green having lost paid discoveries for good (discover_new never returns
// the same posting twice). Items are tagged _ready / _exhausted here and routed apart
// downstream.
//
// Also attaches the origin search-row context onto each item as _ctx, so Parse Jobs no
// longer has to resolve it through itemMatching across the poll loop, which its own
// comment admitted was fragile.

const MAX_POLLS = 20;
const polls = $runIndex + 1;

const ctxAll = $('Attach Row Context').all();
const items = $input.all();

const rows = [];
let allResolved = true;

for (let i = 0; i < items.length; i++) {
  const j = items[i].json || {};
  const ctx = (ctxAll[i] && ctxAll[i].json) || {};

  const status = Number(j.statusCode);

  // A 200 can still be a "snapshot is building" status envelope rather than the job
  // array. Treat that as not-ready so the budget keeps running instead of parsing it
  // into zero jobs.
  let body = j.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const isEnvelope = body && !Array.isArray(body) && typeof body === 'object';
  const building = isEnvelope && /building|running|collecting|pending/i.test(String(body.status || ''));

  const ready = status === 200 && !building;
  const exhausted = polls >= MAX_POLLS;
  if (!ready && !exhausted) allResolved = false;

  rows.push({
    ...j,
    _polls: polls,
    _ready: ready,
    _exhausted: exhausted,
    _status: Number.isFinite(status) ? status : null,
    _snapshot_id: ctx.snapshot_id || null,
    _timeout_reason: ready ? '' : (ctx.snapshot_id ? 'snapshot_timeout' : 'trigger_failed'),
    _ctx: ctx
  });
}

// Every item carries the batch verdict so the IF after this node routes the whole
// batch one way or the other.
//
// pairedItem is set explicitly: a run-once-for-all-items Code node that returns newly
// constructed items drops the linkage, and this node sits INSIDE the poll loop, so on
// the second iteration any downstream $('...').item lookup would fail to resolve.
// Poll Fetch Snapshot additionally reads _snapshot_id off the item itself rather than
// depending on this linkage at all.
return rows.map((r, i) => ({ json: { ...r, _allResolved: allResolved }, pairedItem: { item: i } }));
