---
phase: 05-orchestrator-metrics-projector-reports
plan: 04
subsystem: testing
tags: [telemetry, metrics, projection, sqlite, better-sqlite3, event-log, vitest, tdd]

# Dependency graph
requires:
  - phase: 05-01
    provides: stage_completed{stage:'start'|'render'} events (startup_ms/render_ms) the projector folds
  - phase: 04-02
    provides: storage-owned seq assignment + readEvents (ORDER BY seq ASC) the fold reads
  - phase: 01-03
    provides: metrics/tool_calls/iterations projection tables + appendEvent/readEvents storage seam
provides:
  - projectMetrics(db, runId) — pure fold of the append-only event log into metrics/tool_calls/iterations
  - Golden-fixture + property test suite proving every TEL-03/04/05/06 fold value
  - projection-not-inline invariant test (TEL-02 / D-24)
affects: [orchestrator, report, cli, verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Metric projector: single seq-ordered read → single-pass fold → delete-then-insert in one transaction (idempotent, no UNIQUE key needed)"
    - "Data-driven <stage>_ms metric naming: every stage_completed/failed folds to `${stage}_ms` uniformly (start/build/render/install/lint/test)"
    - "Timestamp-derived backoff pairing (auto_retry_start/end) — robust to Pi field renames (A2)"

key-files:
  created:
    - src/telemetry/projectMetrics.ts
    - tests/projector.test.ts
    - tests/projectionNotInline.test.ts
  modified: []

key-decisions:
  - "backoff_wait_ms / engineering / *_ms / cost_usd rows are emitted only when their source events exist; iteration_count + correction_density are always emitted (0/0 valid)"
  - "Correction clamp uses min(iterationIndex, iterationCount-1) so post-last-turn corrections land on the final iterations row, conserving Σ"
  - "Table name in projectionNotInline count() helper is a hard-coded literal from a closed set — never user input (no injection surface)"

patterns-established:
  - "Projection fold: readEvents once (already seq-ordered) → accumulate in one pass → delete+insert under db.transaction with bound named params only"
  - "correction density keys off stored seq (readEvents order), never event ts — proven by an order-invariance property test"

requirements-completed: [TEL-02, TEL-03, TEL-04, TEL-05, TEL-06]

coverage:
  - id: D1
    description: "TEL-03 performance fold — ttft_ms/start_ms/build_ms/render_ms/wall_ms/cost_usd + token sums fold to exact VALIDATION values (data-driven <stage>_ms proves startup+render, D5-13)"
    requirement: "TEL-03"
    verification:
      - kind: unit
        ref: "tests/projector.test.ts#folds ttft/start/build/render/wall/cost/tokens to the exact VALIDATION values"
        status: pass
    human_judgment: false
  - id: D2
    description: "backoff_wait_ms = Σ(auto_retry_end.ts − auto_retry_start.ts), attributed separately (D5-12)"
    requirement: "TEL-03"
    verification:
      - kind: unit
        ref: "tests/projector.test.ts#sums paired auto_retry start/end deltas into backoff_wait_ms"
        status: pass
    human_judgment: false
  - id: D3
    description: "TEL-04 engineering fold — files_created/edited + lines_added/removed from file_mutation"
    requirement: "TEL-04"
    verification:
      - kind: unit
        ref: "tests/projector.test.ts#folds files_created/edited + lines_added/removed"
        status: pass
    human_judgment: false
  - id: D4
    description: "TEL-05 iterations + correction density (D5-11) — seq-keyed, clamped, sum-conserving, order-invariant"
    requirement: "TEL-05"
    verification:
      - kind: unit
        ref: "tests/projector.test.ts#counts iterations by usage and attributes corrections by seq"
        status: pass
      - kind: unit
        ref: "tests/projector.test.ts#keys corrections off seq, not ts (later seq carries earlier ts)"
        status: pass
      - kind: unit
        ref: "tests/projector.test.ts#Σ per-iteration corrections == density × count == standalone recount"
        status: pass
    human_judgment: false
  - id: D5
    description: "TEL-06 tool_call grouped by toolName → tool_calls(call_count, error_count)"
    requirement: "TEL-06"
    verification:
      - kind: unit
        ref: "tests/projector.test.ts#groups tool_call by toolName with error counts"
        status: pass
    human_judgment: false
  - id: D6
    description: "TEL-02/D-24 projection-not-inline — the three tables are empty until projectMetrics runs; delete-then-insert makes re-run idempotent; partial logs never throw (D5-05)"
    requirement: "TEL-02"
    verification:
      - kind: unit
        ref: "tests/projectionNotInline.test.ts#projection tables are empty until projectMetrics populates them"
        status: pass
      - kind: unit
        ref: "tests/projector.test.ts#running twice yields byte-identical rows (no double-insert)"
        status: pass
      - kind: unit
        ref: "tests/projector.test.ts#folds what exists without session_started; wall_ms falls back to max-min ts"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-03
status: complete
---

# Phase 5 Plan 04: Metrics Projector Summary

**`projectMetrics(db, runId)` — a pure, idempotent fold of the append-only event log into the metrics/tool_calls/iterations projection tables, proven by 10 golden-fixture + property tests (TEL-02…06).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-03T11:05:00Z
- **Completed:** 2026-07-03T11:11:00Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 3 created

## Accomplishments
- `projectMetrics` folds performance (data-driven `<stage>_ms` covering start/build/render, ttft_ms, wall_ms with max−min fallback), cost/tokens, `backoff_wait_ms` (D5-12), engineering (files/lines), and iteration_count + correction_density (D5-11) in a single seq-ordered pass.
- Idempotent by construction: delete-then-insert inside one `db.transaction` (the tables carry no UNIQUE key), so re-running yields byte-identical rows.
- TEL-02/D-24 proven live: `projectionNotInline.test.ts` asserts the three projection tables are empty until `projectMetrics` runs — nothing is computed inline during the append stream.
- Correction fold keys off stored `seq`, not `ts`, proven by an order-invariance property (later seq carries earlier ts) plus sum-conservation (Σ per-iteration == density × count == standalone recount).

## Task Commits

1. **Task 1: RED — projector golden fixtures + property tests** - `7946ff7` (test)
2. **Task 2: GREEN — implement projectMetrics fold** - `0877406` (feat)

_TDD plan: test (RED) → feat (GREEN), no refactor commit needed._

## Files Created/Modified
- `src/telemetry/projectMetrics.ts` - The projector: reads readEvents once, folds all metric families, delete-then-inserts under one transaction with bound named params (storage-tier only; no Pi/Playwright import).
- `tests/projector.test.ts` - Golden fixture per metric family (verbatim VALIDATION values) + determinism/sum-conservation/order-invariance properties + partial-never-crash.
- `tests/projectionNotInline.test.ts` - TEL-02/D-24 tables-empty-until-projectMetrics invariant.

## Decisions Made
- Metric rows are emitted only when their source events exist (absent stage → no `<stage>_ms` row; no usage → no cost/token rows; no retry → no backoff row). `iteration_count` and `correction_density` are always emitted (0 and 0 are valid values, not missing data).
- Correction attribution clamps to `min(iterationIndex, iterationCount − 1)` so a correction after the last turn still lands on the final iterations row, keeping Σ conserved.
- Followed the established storage-writer style (module-level prepared-SQL constants, `db.prepare(sql).run({named})`) mirroring `evaluations.ts` — no new dependency, no new pattern.

## Deviations from Plan

None - plan executed exactly as written. Two minor lazy simplifications (not deviations): dropped the unused `AgentEvent` type import (readEvents already returns typed events) and did not create a refactor commit (GREEN implementation needed no cleanup pass).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `projectMetrics(db, runId)` is ready for the orchestrator (sibling plan) to call after `runStack` + `evaluateRun`, and for `report`/`cli` to read the folded rows.
- Full suite green (146 tests, 28 files), `tsc --noEmit` clean, no Pi/Playwright import in the storage tier.

---
*Phase: 05-orchestrator-metrics-projector-reports*
*Completed: 2026-07-03*
