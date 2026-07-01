---
phase: 01-foundations-contracts
plan: 04
subsystem: storage
tags: [sqlite, better-sqlite3, node-crypto, node-fs, path-containment, artifacts]

requires:
  - phase: 01-foundations-contracts (01-03)
    provides: "openDb (WAL + idempotent schema init) and the artifacts table (id, run_id, kind, path, sha, created_at)"
provides:
  - "writeArtifact(db, runId, kind, filename, bytes, resultsRoot?) — writes bytes to results/<runId>/<filename> and links a relative path + sha256 in the artifacts table"
  - "getArtifactPath(db, id) — reads the stored relative path back via a prepared SELECT"
  - "V12 path-containment: a traversing filename is rejected before any mkdir/write/DB insert"
affects: [phase-05-reports-html, phase-02-workspace-build, phase-04-pi-adapter]

tech-stack:
  added: []
  patterns:
    - "Path-containment guard: resolve(runDir, filename) checked against resolve(resultsRoot, runId) + path.sep prefix before any filesystem or DB write (V12)"
    - "Artifact store stores relative-path + sha256 links only, never blobs (D-15), mirroring appendEvent's prepared-statement pattern from 01-03"

key-files:
  created:
    - src/storage/artifacts.ts
    - tests/artifacts.test.ts
  modified: []

key-decisions:
  - "writeArtifact takes an optional 6th resultsRoot param (default 'results' under cwd) so tests can point it at a tmp dir without changing the plan's documented 5-arg call shape"
  - "Relative path stored in the artifacts table is computed via node:path relative() against the resolved results root, not string concatenation, so normalization (e.g. an internal '../' that still resolves inside the run dir) is handled correctly"

patterns-established:
  - "V12 containment check: `targetPath !== runDir && !targetPath.startsWith(runDir + sep)` throws before mkdir/write — reusable shape for any future disk-write path that takes a caller-influenced filename"

requirements-completed: [STORE-03]

coverage:
  - id: D1
    description: "writeArtifact persists bytes under results/<run_id>/ and inserts a relative-path + sha256 artifacts row (never a blob)"
    requirement: "STORE-03"
    verification:
      - kind: unit
        ref: "tests/artifacts.test.ts#writes bytes under results/<runId>/ and links a relative path (not the bytes) in the DB"
        status: pass
    human_judgment: false
  - id: D2
    description: "Round-trip: write -> DB link (getArtifactPath) -> read on-disk bytes are identical to the input (SC#5)"
    requirement: "STORE-03"
    verification:
      - kind: unit
        ref: "tests/artifacts.test.ts#round-trips: write -> DB link -> read yields identical bytes (SC#5)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A traversing filename (../) is rejected before any write to disk or the DB (V12)"
    requirement: "STORE-03"
    verification:
      - kind: unit
        ref: "tests/artifacts.test.ts#rejects a traversing filename before writing anything to disk or the DB"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-01
status: complete
---

# Phase 1 Plan 4: On-Disk Artifact Store Summary

**On-disk artifact store (`writeArtifact`/`getArtifactPath`) that links results/<run_id>/ bytes to a relative-path artifacts row, with V12 path-containment rejecting traversal before any write.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-01T21:44:00Z
- **Completed:** 2026-07-01T21:52:25Z
- **Tasks:** 1 completed
- **Files modified:** 2

## Accomplishments
- `writeArtifact` writes bytes to `results/<runId>/<filename>`, computes a sha256, and inserts a relative-path artifacts row via a prepared statement (D-15) — no blob ever touches SQLite.
- Path-containment (V12): the resolved target is asserted to stay inside the resolved run dir before any `mkdir`/write/DB insert; a traversing filename throws and leaves no file or row behind (T-1-V12-01).
- `getArtifactPath` retrieves the stored relative path via a prepared `SELECT`; resolving it against the results root reproduces the exact bytes written (Success Criterion #5).

## Task Commits

1. **Task 1: On-disk artifact store with DB link + path containment** - `8e71263` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/storage/artifacts.ts` - `writeArtifact` (bytes -> results/<run_id>/ + artifacts row, with V12 containment) and `getArtifactPath` (id -> relative path)
- `tests/artifacts.test.ts` - round-trip (write -> DB link -> read), null lookup for an unknown id, and traversal-rejection coverage

## Decisions Made
- Added an optional `resultsRoot` parameter (defaulting to `results` under cwd) to `writeArtifact` purely for testability, keeping the plan's documented 5-argument call shape intact for real callers.
- Used `node:path relative()` to compute the stored relative path instead of string concatenation, so the path stored in the DB is always normalized relative to the results root.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None - this plan's V12 file-write surface is exactly what the threat model in 01-04-PLAN.md anticipated (T-1-V12-01, T-1-V12-02); no new surface introduced.

## Self-Check: PASSED
