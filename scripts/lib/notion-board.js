// scripts/lib/notion-board.js
// Deterministic, zero-Claude access to the Progress Tracker board for the sprint-tracker core.
//
// WHY: the old read path was a page-ID table hand-maintained in status.md, fetched one row at a
// time, because notion-fetch returns schema-only and the semantic search caps at 25 < 43 rows.
// This module replaces that with a real paginated Notion REST query (no cap, no hand-kept list),
// and keeps a cache-parser fallback so the core still runs (degraded) when the token is absent.
//
// CREDENTIALS: a Notion internal-integration token, shared to the Progress Tracker DB, read from
// work/01-sprint-tracker/config/notion-token.txt (gitignored). Never hard-coded, never logged.
//
// API: POST /v1/data_sources/{data_source_id}/query with cursor pagination (Notion-Version
// 2025-09-03, the data-sources API). Falls back to POST /v1/databases/{database_id}/query
// (Notion-Version 2022-06-28) if the data-sources endpoint is unavailable to the integration.
// Verified against developers.notion.com/reference/query-a-data-source (context7, 2026-07-10).

const fs = require('fs');
const path = require('path');

const NOTION_API = 'https://api.notion.com';
const DS_VERSION = '2025-09-03';   // data-sources API
const DB_VERSION = '2022-06-28';   // classic database-query fallback

function readToken(tokenPath) {
  try {
    const t = fs.readFileSync(tokenPath, 'utf8').trim();
    return t || null;
  } catch { return null; }
}

// --- property extraction: tolerate Status-type OR Select-type for the Status/Project columns ---
function propText(p) {
  if (!p) return '';
  if (Array.isArray(p.title)) return p.title.map(t => t.plain_text).join('').trim();
  if (Array.isArray(p.rich_text)) return p.rich_text.map(t => t.plain_text).join('').trim();
  return '';
}
function propChoice(p) {
  if (!p) return '';
  if (p.status && p.status.name) return p.status.name;
  if (p.select && p.select.name) return p.select.name;
  return '';
}
function propNumber(p) {
  if (!p || p.number === null || p.number === undefined) return null;
  return p.number;
}

function normalizeRow(page) {
  const props = page.properties || {};
  return {
    pageId: page.id,
    task: propText(props.Task) || propText(props.Name) || '(untitled)',
    status: propChoice(props.Status),
    project: propChoice(props.Project),
    order: propNumber(props.Order),
  };
}

async function queryOnce(url, version, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': version,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Notion ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Page through EVERY row. Returns [{pageId, task, status, project, order}].
async function readBoardLive({ token, dataSourceId, dbId }) {
  const attempts = [];
  if (dataSourceId) attempts.push({ url: `${NOTION_API}/v1/data_sources/${dataSourceId}/query`, version: DS_VERSION });
  if (dbId) attempts.push({ url: `${NOTION_API}/v1/databases/${dbId}/query`, version: DB_VERSION });

  let lastErr;
  for (const { url, version } of attempts) {
    try {
      const rows = [];
      let cursor;
      // hard stop at 50 pages (5000 rows) so a cursor bug can never spin forever
      for (let i = 0; i < 50; i++) {
        const body = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const data = await queryOnce(url, version, token, body);
        const results = data.results || data.page_or_data_source || [];
        for (const pg of results) if ((pg.object === 'page') || pg.properties) rows.push(normalizeRow(pg));
        if (!data.has_more) return rows;
        cursor = data.next_cursor;
        if (!cursor) return rows;
      }
      return rows;
    } catch (e) {
      lastErr = e;
      // 404 on the data-sources endpoint => integration is on the old API; try the db fallback.
      if (e.status === 404 || e.status === 400) continue;
      throw e;
    }
  }
  throw lastErr || new Error('readBoardLive: no dataSourceId or dbId given');
}

// FALLBACK read: parse the board snapshot table out of status.md when the token is absent.
// Table columns: | # | Task | Status | Since | Page ID |
function parseSnapshotCache(statusMdText) {
  const rows = [];
  const lines = statusMdText.split(/\r?\n/);
  const rowRe = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([0-9a-fA-F-]{8,})\s*\|\s*$/;
  for (const ln of lines) {
    const m = ln.match(rowRe);
    if (!m) continue;
    const [, sortKey, task, status, since, pageId] = m;
    if (/^-+$/.test(sortKey) || sortKey === '#') continue;         // separator / header
    // Status may carry a parenthetical note e.g. "Done (dropped 07-04...)"; take the leading word(s).
    const cleanStatus = status.replace(/\s*\(.*$/, '').trim();
    rows.push({
      pageId: pageId.trim(),
      task: task.trim(),
      status: cleanStatus,
      since: since.trim(),
      sortKey: sortKey.trim(),
      project: '',
    });
  }
  return rows;
}

// Create a Progress Tracker row (the /new contract fix). Token-gated; caller checks first.
async function upsertRow({ token, dataSourceId, task, status, project, order, notes }) {
  const url = `${NOTION_API}/v1/pages`;
  const properties = {
    Task: { title: [{ text: { content: task } }] },
    Status: { status: { name: status } },
    Project: { select: { name: project } },
  };
  if (order !== null && order !== undefined) properties.Order = { number: order };
  if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };
  const body = { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': DS_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Notion upsert ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = { readToken, readBoardLive, parseSnapshotCache, upsertRow, normalizeRow };
