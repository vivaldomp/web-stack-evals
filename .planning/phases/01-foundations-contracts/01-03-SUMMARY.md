---
phase: 01-foundations-contracts
plan: "03"
subsystem: database
tags: [sqlite, better-sqlite3, wal, schema, event-log]

requires:
  - phase: 01-foundations-contracts (01-01)
    provides: AgentEvent discriminated union (src/core/events.ts), StoragePort interface
provides:
  - Rep-keyed 11-table SQLite schema (SCHEMA_SQL, SCHEMA_VERSION)
  - openDb: WAL mode + idempotent user_version-guarded init
  - appendEvent / readEvents: prepared-statement append-only event log
affects: [phase-2-workspace-runtime, phase-4-agent-adapter, phase-5-orchestrator-reports]

tech-stack:
  added: []
  patterns:
    - "Idempotent schema init guarded by PRAGMA user_version — no migration framework (D-17)"
    - "events table as the single canonical append-only log; tool_name promoted+indexed for hot folds (D-13/16)"
    - "Registries (stacks/models/scenarios) store name + JSON spec snapshot + created_at (D-18)"

key-files:
  created:
    - src/storage/schema.sql.ts
    - src/storage/db.ts
    - tests/db.test.ts
  modified: []

key-decisions:
  - "Registry tables (stacks/models/scenarios) store the resolved spec as a single JSON column rather than exploding it into typed columns — exact field names were left to executor discretion (RESEARCH A1) and JSON keeps the registry schema stable as spec shapes evolve"
  - "appendEvent wraps its single INSERT in db.transaction() per the plan's instruction, even though one statement is already atomic in SQLite — keeps the call shape ready for a future batch-append variant with no signature change"

patterns-established:
  - "Prepared statements only for row reads/writes; SCHEMA_SQL is the only raw .exec() and contains zero interpolated values (T-1-SQL-01)"

requirements-completed: [STORE-01, TEL-01]

coverage:
  - id: D1
    description: "Rep-keyed 11-table schema (runs, stacks, models, scenarios, artifacts, events, metrics, screenshots, tool_calls, iterations, evaluations) created via idempotent CREATE TABLE IF NOT EXISTS"
    requirement: "STORE-01"
    verification:
      - kind: unit
        ref: "tests/db.test.ts#openDb > creates every SC#4 table"
        status: pass
      - kind: unit
        ref: "tests/db.test.ts#openDb > is idempotent — re-opening an existing DB does not throw or duplicate tables"
        status: pass
    human_judgment: false
  - id: D2
    description: "openDb enables WAL journal mode on a fresh DB"
    requirement: "STORE-01"
    verification:
      - kind: unit
        ref: "tests/db.test.ts#openDb > enables WAL mode on a fresh DB"
        status: pass
    human_judgment: false
  - id: D3
    description: "Append-only event log: appendEvent/readEvents round-trip every AgentEvent variant losslessly in seq order via prepared statements; duplicate (run_id, seq) rejected"
    requirement: "TEL-01"
    verification:
      - kind: unit
        ref: "tests/db.test.ts#appendEvent / readEvents > reads back every appended event, seq-ordered and deep-equal to the original"
        status: pass
      - kind: unit
        ref: "tests/db.test.ts#appendEvent / readEvents > rejects a second event with a duplicate (run_id, seq) — append order is authoritative"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-01
status: complete
---

# Phase 1 Plan 3: SQLite Results DB Summary

**Rep-keyed 11-table SQLite schema with WAL mode, idempotent user_version-guarded init, and a prepared-statement append-only event log that round-trips every AgentEvent variant losslessly.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-01T21:38:00Z
- **Completed:** 2026-07-01T21:41:48Z
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 test file created)

## Accomplishments
- `src/storage/schema.sql.ts` defines all 11 tables required by Success Criterion #4 (9 named tables + models + scenarios registries), rep-keyed per D-14, with the generic `events` log promoting `tool_name` and indexed for hot metric folds
- `src/storage/db.ts` opens the DB in WAL mode, sets a defensive `busy_timeout`, and idempotently inits the schema guarded by `PRAGMA user_version` — re-opening never re-runs DDL or duplicates tables
- `appendEvent`/`readEvents` round-trip every one of the 7 `AgentEvent` union variants byte-identically (via `JSON.stringify`/`JSON.parse`) in strict seq order, using only prepared statements with bound params — no string-concatenated SQL anywhere outside the static DDL
- Full TDD cycle: RED (failing test against a non-existent module) → GREEN (implementation, 5/5 new tests pass) — no refactor needed, code was already minimal

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the rep-keyed SQL schema** - `3c7815e` (feat)
2. **Task 2: openDb + append-only event log** - RED `2b5e562` (test) → GREEN `eef8679` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/storage/schema.sql.ts` - `SCHEMA_SQL` (11 `CREATE TABLE IF NOT EXISTS` statements + 2 indexes) and `SCHEMA_VERSION = 1`
- `src/storage/db.ts` - `openDb`, `appendEvent`, `readEvents`
- `tests/db.test.ts` - WAL check, all-tables check, idempotent-reopen check, lossless round-trip of all 7 event variants, duplicate-seq rejection

## Decisions Made
- Registry tables (`stacks`/`models`/`scenarios`) store the resolved spec as a single `spec JSON` column rather than typed columns per field — exact column names were explicitly left to executor discretion (RESEARCH.md Assumptions A1); JSON keeps the registry stable as `stack.yaml`/`scenario.yaml`/model-config shapes evolve in later phases without a schema migration
- `appendEvent` wraps its single prepared INSERT in `db.transaction()` as the plan instructed, even though a lone statement is already atomic in SQLite by itself — this keeps the call shape stable if a future batch-append variant is added, at zero extra cost today

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The results DB is ready for Phase 2 (workspace/build runtime) to write `stage_started`/`stage_completed`/`stage_failed` events and Phase 4 (Pi adapter) to write `tool_call`/`file_mutation` events through this same `openDb`/`appendEvent` seam
- `StoragePort` (src/core/ports.ts, from 01-01) is not yet implemented against `db.ts` — that concrete adapter wiring belongs to whichever later plan first needs to satisfy the port (no blocker for this phase's success criteria)
- No blockers or concerns carried forward from this plan

---
*Phase: 01-foundations-contracts*
*Completed: 2026-07-01*
