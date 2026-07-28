// F01: a snapshot that never became ready inside the poll budget, or a trigger that
// never produced a snapshot_id, becomes a LOUD needs_review row instead of an empty
// successful run. The row carries the snapshot_id so the discoveries can be recovered
// by re-polling rather than re-bought.
//
// Shape matches the needs_review tab exactly (same 11 columns as Format Review Row
// S3/S5) so the append stays consistent; stage is 'stage1' to distinguish it.

const rows = [];
for (const it of $input.all()) {
  const j = it.json || {};
  const ctx = j._ctx || {};
  const reason = j._timeout_reason || 'snapshot_timeout';

  const detail = [
    reason,
    j._snapshot_id ? 'snapshot_id=' + j._snapshot_id : 'snapshot_id=none',
    ctx.keyword ? 'keyword=' + ctx.keyword : '',
    ctx.location ? 'location=' + ctx.location : '',
    ctx.country ? 'country=' + ctx.country : '',
    'polls=' + (j._polls == null ? '?' : j._polls),
    'last_status=' + (j._status == null ? 'none' : j._status)
  ].filter(Boolean).join('; ');

  rows.push({ json: {
    date: new Date().toISOString().slice(0, 10),
    stage: 'stage1',
    // Namespaced so it can never collide with a real LinkedIn job_posting_id.
    job_posting_id: 'snapshot:' + (j._snapshot_id || 'none'),
    job_title: '',
    company_name: '',
    job_location: ctx.location || '',
    url: '',
    fit_score: '',
    interest_score: '',
    rank_score: '',
    reasons: detail
  } });
}

// Nothing timed out: emit no items so the append node does not fire at all.
return rows;
