'use strict';
/*
 * system/recall/lib/db.js - the one place the recall spine opens facts.db and owns its schema.
 *
 * Zero new dependencies: node:sqlite is built into Node (v22.5+), so "SQLite only, already in the
 * stack" (the vault FTS5 index proves SQLite is in-stack; this adds no native build, no npm, no
 * package.json). The Recall Spine upgrade plan (2026-07-24) named better-sqlite3; node:sqlite is the
 * faithful zero-infra substitute and the deliberate deviation is recorded in the plan record
 * (vault/research/alex-recall-spine.md) and system/recall/README.md.
 *
 * facts.db is GITIGNORED (mirrors the vault FTS5 index) and rides the 21:45 encrypted vault backup,
 * so it never reaches the public repo and is fully regenerable from the sources it mirrors.
 *
 * The bi-temporal model is Graphiti's, implemented at Alex scale (Zep paper arXiv 2501.13956): every
 * fact carries t_valid/t_invalid; supersession stamps the old row and links superseded_by, never
 * DELETEs. The `current_fact` partial unique index is the supersession engine in one line - only one
 * row per (subject,predicate) may have t_invalid NULL, so a contradiction is unrepresentable.
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = process.env.ALEX_FACTS_DB || path.join(REPO, 'system', 'recall', 'facts.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facts (
  id            INTEGER PRIMARY KEY,
  subject       TEXT NOT NULL,
  predicate     TEXT NOT NULL,
  object        TEXT NOT NULL,
  t_valid       TEXT NOT NULL,
  t_invalid     TEXT,
  superseded_by INTEGER REFERENCES facts(id),
  source        TEXT NOT NULL,
  harvester     TEXT NOT NULL,
  confidence    TEXT NOT NULL DEFAULT 'machine',
  ingested_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS current_fact ON facts(subject, predicate) WHERE t_invalid IS NULL;
CREATE INDEX IF NOT EXISTS facts_subject ON facts(subject);

CREATE TABLE IF NOT EXISTS lessons (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,
  source_runid  TEXT,
  class         TEXT NOT NULL,
  lesson        TEXT NOT NULL,
  norm          TEXT NOT NULL,          -- normalized lesson text, for dedup + hit counting
  evidence      TEXT,
  hits          INTEGER NOT NULL DEFAULT 1,
  t_valid       TEXT NOT NULL,
  t_invalid     TEXT,
  superseded_by INTEGER REFERENCES lessons(id)
);
-- P1.8* provenance + quarantine columns (2026-08-23, run-47 merged plan) are added by MIGRATIONS
-- below, not here: this CREATE runs only on a fresh DB, and the live table predates them.
CREATE UNIQUE INDEX IF NOT EXISTS lesson_norm_current ON lessons(norm) WHERE t_invalid IS NULL;

-- Subject alias table (Phase 2 retrieval): maps a lowercase token that may appear in a prompt to a
-- fact subject, so injection is exact-match (no embeddings). Populated by the harvesters.
CREATE TABLE IF NOT EXISTS subject_alias (
  alias   TEXT NOT NULL,
  subject TEXT NOT NULL,
  PRIMARY KEY (alias, subject)
);
`;

/*
 * MIGRATIONS (additive only, idempotent). node:sqlite has no ALTER-IF-NOT-EXISTS, and
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so new columns land here.
 * Additive columns are supersession-safe: existing rows keep their history and read NULL/0.
 */
const MIGRATIONS = [
  // P1.8* (2026-08-23, run-47 merged plan): lesson provenance + quarantine. Closes run-46 N6, the
  // persistent prompt-injection vector - inbound email text sits verbatim in harvested logs, so an
  // L-shaped string in any log line became a trusted lessons row that recall-inject later injected
  // into future prompts. Provenance makes an audit O(1); quarantine makes the untrusted class inert
  // without DELETING anything (nothing in this ledger is ever deleted).
  { table: 'lessons', column: 'quarantined',  ddl: 'ALTER TABLE lessons ADD COLUMN quarantined INTEGER NOT NULL DEFAULT 0' },
  { table: 'lessons', column: 'source_file',  ddl: 'ALTER TABLE lessons ADD COLUMN source_file TEXT' },
  { table: 'lessons', column: 'source_line',  ddl: 'ALTER TABLE lessons ADD COLUMN source_line INTEGER' },
  { table: 'lessons', column: 'harvested_at', ddl: 'ALTER TABLE lessons ADD COLUMN harvested_at TEXT' },
  { table: 'lessons', column: 'origin',       ddl: "ALTER TABLE lessons ADD COLUMN origin TEXT" },
  // P1.7* exactly-once promotion. The old trigger was `hits === 3`, which fires only on the exact
  // crossing, so when the threshold moved to 2 the one live row ALREADY at 2 would have sailed past
  // to 3 and never queued: a lesson stranded by the very change meant to free it. Stamping the queue
  // time makes promotion idempotent and threshold-change-proof forever.
  { table: 'lessons', column: 'promoted_at',  ddl: 'ALTER TABLE lessons ADD COLUMN promoted_at TEXT' },
];

function migrate(db) {
  for (const m of MIGRATIONS) {
    let cols;
    try { cols = db.prepare(`PRAGMA table_info(${m.table})`).all().map((r) => r.name); }
    catch (_) { continue; } // table not created yet on this handle; SCHEMA above owns that
    if (!cols.length || cols.includes(m.column)) continue;
    try { db.exec(m.ddl); } catch (e) { /* additive-only: a failed add must never block a run */ }
  }
}

/**
 * Open facts.db (creating + migrating the schema if needed) and return the handle.
 * WAL keeps the per-prompt reader (recall-inject) from blocking the nightly writer.
 *
 * busy_timeout (P1.3, 2026-08-23): measured before the fix, a second writer arriving during a
 * BEGIN IMMEDIATE threw `database is locked` INSTANTLY with no wait, so an interactive session
 * overlapping the 21:35 nightly chain lost its write. Five seconds is the correct behavior for a
 * chain that shares one small DB with an occasional interactive writer. Set on readers too: a
 * reader can hit the lock during a writer's commit, and recall-inject fails open on error anyway.
 */
function openDb(readonly = false) {
  const db = new DatabaseSync(DB_PATH, { readOnly: readonly && require('fs').existsSync(DB_PATH) });
  try { db.exec('PRAGMA busy_timeout = 5000;'); } catch (_) {}
  if (!readonly) {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA);
    migrate(db);
  }
  return db;
}

module.exports = { openDb, DB_PATH, REPO, SCHEMA, migrate };
