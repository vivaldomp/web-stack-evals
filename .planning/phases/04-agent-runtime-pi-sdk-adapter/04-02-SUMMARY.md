---
phase: 04-agent-runtime-pi-sdk-adapter
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, event-log, seq, discriminated-union, typescript]

# Dependency graph
requires:
  - phase: 04-01
    provides: "AgentEvent union extension + AgentEventDraft (seqless) alias"
  - phase: 01
    provides: "events table (PK run_id,seq), appendEvent/readEvents, StoragePort seam"
  - phase: 02
    provides: "runStack pipeline emitting stage/benchmark events"
provides:
  - "Storage-owned per-run monotonic seq: appendEvent stamps seq atomically (D4-26)"
  - "AgentEventDraft is now a *distributive* Omit — preserves discriminant narrowing"
  - "runStack emits seqless drafts; no local counter to collide with the agent adapter"
  - "Interleaved two-writer monotonicity proof (tests/seqOwnership.test.ts)"
affects: [04-05, 04-07, 04-08, phase-05-metrics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Storage-owned sequence: producers yield seqless drafts, append boundary stamps MAX(seq)+1 per run in-txn"
    - "Distributive Omit for discriminated-union derivation (bare Omit collapses to common keys)"

key-files:
  created:
    - tests/seqOwnership.test.ts
  modified:
    - src/core/ports.ts
    - src/core/events.ts
    - src/storage/db.ts
    - src/pipeline/runStack.ts
    - tests/db.test.ts
    - tests/storagePort.test.ts
    - tests/runStack.test.ts

key-decisions:
  - "seq is storage-owned (D4-26): appendEvent computes COALESCE(MAX(seq),-1)+1 WHERE run_id inside the existing db.transaction() — atomic MAX-read+INSERT under single-writer WAL, so two producers never collide."
  - "AgentEventDraft changed from bare Omit<AgentEvent,'seq'> to a distributive Omit — the bare form collapses the union to common keys and destroyed discriminant narrowing (e.type==='tool_call' lost toolName), blocking the appendEvent migration."
  - "Appending the same draft twice now SUCCEEDS with distinct consecutive seq (storage assigns) rather than throwing on a PK clash — the old caller-owned-seq collision test no longer models reality."

patterns-established:
  - "Producer→storage seq handoff: any future event producer (agent adapter, Plans 04-05/07/08) yields AgentEventDraft and never sets seq."
  - "Distributive Omit helper pattern for deriving producer shapes from discriminated-union event types."

requirements-completed: [AGENT-04]

coverage:
  - id: D1
    description: "StoragePort.appendEvent accepts a seqless draft and stamps the next per-run monotonic seq atomically (D4-26)"
    requirement: AGENT-04
    verification:
      - kind: unit
        ref: "tests/db.test.ts#stamps seq 0..N-1 in append order and reads each event back deep-equal to its draft"
        status: pass
      - kind: unit
        ref: "tests/storagePort.test.ts#appendEvent (seqless draft) + readEvents round-trips with a storage-stamped seq"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two interleaved writers on one run produce gap-free, collision-free, strictly-increasing, per-run-independent seq (D-04)"
    requirement: AGENT-04
    verification:
      - kind: unit
        ref: "tests/seqOwnership.test.ts#stamps gap-free, strictly-increasing seq under alternating writers on one run"
        status: pass
      - kind: unit
        ref: "tests/seqOwnership.test.ts#keeps seq per-run independent when a second run is interleaved (per-run, not global)"
        status: pass
    human_judgment: false
  - id: D3
    description: "runStack no longer owns a local seq counter; emits seqless drafts; full suite stays green"
    requirement: AGENT-04
    verification:
      - kind: unit
        ref: "tests/runStack.test.ts (all runStack fatal/non-fatal paths)"
        status: pass
      - kind: automated
        ref: "grep -nE 'seq *: *seq\\+\\+|let seq' src/pipeline/runStack.ts (empty)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-03
status: complete
---

# Phase 4 Plan 02: Storage-Owned Sequence Number Assignment Summary

**seq moved out of the caller into StoragePort.appendEvent — stamped atomically per run via COALESCE(MAX(seq),-1)+1 in-transaction, so the agent adapter and runStack can both append to one run's log without a shared counter; proven by an interleaved two-writer monotonicity test.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-03T00:39:47Z
- **Completed:** 2026-07-03T00:46:00Z
- **Tasks:** 2
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments
- `StoragePort.appendEvent` / `db.appendEvent` now take a seqless `AgentEventDraft` and stamp the next per-run monotonic `seq` inside the existing `db.transaction()` (atomic MAX-read + INSERT under single-writer WAL — collision/gap impossible). Stamped seq is embedded in the stored payload so `readEvents` round-trips a fully-formed `AgentEvent`.
- `runStack` lost its `let seq = 0` counter and every `seq: seq++`; it now yields drafts in call order and storage assigns the same order the counter used to.
- New `tests/seqOwnership.test.ts` proves that ~20 alternating appends from two writers to one run yield `seq` `0..N-1` (gap-free, no duplicates, strictly +1), append-order authoritative, and that a second interleaved run restarts at 0 (per-run, not global).
- Fixed a blocking type bug in the 04-01 `AgentEventDraft` alias (see Deviations).

## Task Commits

Each task was committed atomically:

1. **Task 1: Storage owns seq — port signature + SQLite stamping + adapter shim** - `62787aa` (feat)
2. **Task 2: Migrate runStack off its local counter + fix test doubles + prove interleaved monotonicity** - `6393151` (test)

**Plan metadata:** committed with STATE.md/ROADMAP.md/REQUIREMENTS.md update.

## Files Created/Modified
- `src/core/ports.ts` - `appendEvent(e: AgentEventDraft)` + `runSession(): AsyncIterable<AgentEventDraft>`; D-23 type-only imports preserved.
- `src/core/events.ts` - `AgentEventDraft` is now a distributive `Omit` (blocking-bug fix, see Deviations).
- `src/storage/db.ts` - `appendEvent` stamps `seq = COALESCE(MAX(seq),-1)+1 WHERE run_id` in-txn, embeds it in payload; `toolNameOf` retyped to draft.
- `src/pipeline/runStack.ts` - removed local seq counter; all event literals are seqless drafts.
- `tests/db.test.ts` - drafts in, seq 0..N-1 out; duplicate-draft append now succeeds with distinct seq.
- `tests/storagePort.test.ts` - round-trip constructs a draft, asserts read-back `seq: 0`.
- `tests/runStack.test.ts` - `fakeStorage` stamps a per-run seq to mirror storage ownership.
- `tests/seqOwnership.test.ts` - **new** interleaved two-writer monotonicity proof.

## Decisions Made
- **seq is storage-owned (D4-26)** via `COALESCE(MAX(seq),-1)+1` inside the pre-existing transaction — chosen over a per-run in-memory counter because it is stateless and survives a mid-run restart (marked with a `ponytail:` comment naming the upgrade path).
- **Duplicate-draft append succeeds** with distinct consecutive seq — the old "duplicate (run_id,seq) throws" test modeled caller-owned seq and no longer reflects the contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `AgentEventDraft` was a non-distributive `Omit`, breaking discriminant narrowing**
- **Found during:** Task 1 (db.ts appendEvent migration)
- **Issue:** Plan 04-01 defined `AgentEventDraft = Omit<AgentEvent, "seq">`. A bare `Omit` over a union collapses to the union's *common* keys, so `e.type === "tool_call"` no longer narrowed to expose `toolName` (`db.ts` `toolNameOf` failed with TS2339), and variant fields were lost. This blocked the entire seq-ownership migration.
- **Fix:** Redefined the alias with a distributive helper: `type DistributiveOmit<T,K> = T extends unknown ? Omit<T,K> : never;` `AgentEventDraft = DistributiveOmit<AgentEvent,"seq">`. Verified in isolation that the distributive form narrows `toolName` and accepts variant fields where the bare form required an `as any` cast.
- **Files modified:** src/core/events.ts
- **Verification:** `npm run typecheck` clean; full suite green.
- **Committed in:** `62787aa` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — blocking type error in a Wave-1 dependency)
**Impact on plan:** Necessary for correctness — the plan's own `AgentEventDraft`-based contract could not compile without it. Root-cause fix in one line at the alias definition; no scope creep. No new decisions beyond D4-26.

## Issues Encountered
- Task 1's whole-project `typecheck` is transiently red between the two commits: changing the port signature in Task 1 makes `runStack`'s old `seq: seq++` literals invalid until Task 2 migrates them. Inherent to splitting one atomic contract change across two per-task commits; the suite is fully green after Task 2.

## Self-Check: PASSED
- tests/seqOwnership.test.ts — FOUND
- Task 1 commit `62787aa` — FOUND
- Task 2 commit `6393151` — FOUND
- `npm test` — 18 files, 89 tests passed
- `npm run typecheck` — clean
- `grep 'let seq|seq: seq++' src/pipeline/runStack.ts` — empty (no local counter)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The append boundary is now multi-producer-safe: Plans 04-05/07/08 (Pi adapter) can yield `AgentEventDraft`s to the same run's log as `runStack` with no coordination.
- No blockers.

---
*Phase: 04-agent-runtime-pi-sdk-adapter*
*Completed: 2026-07-03*
