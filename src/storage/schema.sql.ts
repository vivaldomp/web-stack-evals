// Rep-keyed SQLite schema (STORE-01, D-13/14/18/19/20/21/25).
// Static DDL only — no interpolated values, ever (T-1-SQL-01/02).
// Guarded by SCHEMA_VERSION via the `user_version` pragma (D-17): a single
// idempotent init, no migration framework in v1.

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
-- Registries (D-18): reusable name + resolved spec snapshot. Runs FK to these
-- but also carry their own immutable manifest snapshot, so editing a
-- registry entry later never rewrites run history.
CREATE TABLE IF NOT EXISTS stacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  spec JSON NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  spec JSON NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  spec JSON NOT NULL,
  created_at INTEGER NOT NULL
);

-- runs (D-14/18/19/21/26): rep-keyed, immutable manifest snapshot, fingerprint,
-- status/failed_stage outcome, composite score stored alongside its weights.
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  stack_id INTEGER REFERENCES stacks(id),
  model_id INTEGER REFERENCES models(id),
  scenario_id INTEGER REFERENCES scenarios(id),
  rep_index INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  failed_stage TEXT,
  manifest JSON,
  fingerprint TEXT,
  fingerprint_components JSON,
  version_stamp JSON,
  composite_score REAL,
  composite_weights JSON,
  started_at INTEGER,
  finished_at INTEGER
);

-- events (D-13/16): the canonical append-only log. Generic payload + a few
-- promoted/indexed columns for hot metric folds (tool_name; run_id+type).
-- Append order (seq) is authoritative (D-04).
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  tool_name TEXT,
  payload JSON NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_events_run_type ON events(run_id, type);
CREATE INDEX IF NOT EXISTS idx_events_tool_name ON events(tool_name);

-- artifacts (D-15): DB stores a relative path only, never blobs.
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  sha TEXT,
  created_at INTEGER NOT NULL
);

-- screenshots (D-25): specializes artifacts, no double-storing of bytes/paths.
CREATE TABLE IF NOT EXISTS screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id),
  role TEXT NOT NULL, -- expected | generated | diff
  viewport JSON,
  dpr REAL
);

-- evaluations (D-20): one row per (run, rep, evaluator); new evaluator = new
-- rows, no schema change.
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  rep_index INTEGER NOT NULL DEFAULT 0,
  evaluator_name TEXT NOT NULL,
  raw_score REAL,
  detail JSON,
  UNIQUE(run_id, rep_index, evaluator_name)
);

-- metrics / tool_calls / iterations (D-24): materialized projections folded
-- from the events log; events remain the source of truth.
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL,
  unit TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  call_count INTEGER,
  error_count INTEGER
);

CREATE TABLE IF NOT EXISTS iterations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  iteration_index INTEGER,
  correction_count INTEGER
);
`;
