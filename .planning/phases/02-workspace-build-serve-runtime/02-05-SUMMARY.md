---
phase: 02-workspace-build-serve-runtime
plan: 05
subsystem: infra
tags: [execa, playwright, node-fetch, pipeline, orchestration]

# Dependency graph
requires:
  - phase: 02-workspace-build-serve-runtime (02-02/02-03/02-04)
    provides: copyWorkspace/cleanupWorkspace (workspace), buildAllowlistedEnv/runStage/startServer/killProcessTree (runtime), createStoragePort (storage), createPlaywrightRenderer/RenderPort (render), StackSchema per-stage timeout fields (02-01)
provides:
  - "runStack(stack, runId, storage): Promise<RunOutcome> — the pure D2-20 pipeline entrypoint wiring copy → install → build → (lint/test, non-fatal) → start → wait-ready → screenshot → teardown"
  - "waitForHttp200(url, timeoutMs) — the HTTP-poll half of the D2-10 layered readiness gate"
affects: [02-06 (integration tests against the real Angular fixture), Phase 5 (CLI-01 orchestrator calls runStack unchanged)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared runAndRecordStage() helper emits StageStarted/Completed/Failed + writes the stage log for every stage that runs (fatal or non-fatal), avoiding duplicated event-emission logic between install/build/lint/test"
    - "Promise.race between waitForHttp200(...).then/catch and the subprocess's own settlement to distinguish start_failed (process died before answering) from timeout (never answered, may still be running)"
    - "Single try/finally around the start-through-screenshot block guarantees killProcessTree runs exactly once on every exit path (success, start_failed, timeout, or an unexpected throw), instead of repeating the kill call at each early return"

key-files:
  created: [src/runtime/readiness.ts, src/pipeline/runStack.ts, tests/readiness.test.ts, tests/runStack.test.ts]
  modified: []

key-decisions:
  - "runStack never imports the 'playwright' package directly — only createPlaywrightRenderer() from src/render/playwrightRenderer.ts, keeping RenderPort the sole seam (D2-21, D-23)"
  - "Lint/test share the same runAndRecordStage() helper as install/build, differing only by never triggering a fatal early return — kept the pipeline body short instead of duplicating event-emission code per stage"
  - "meta.json is written up to 3 times per run (start-failure, screenshot-failure, success) with progressively more data (distBytes only vs distBytes+pageErrors) rather than deferred to a single end-of-run write, so a partial run still leaves a queryable artifact"

requirements-completed: [BUILD-01, BUILD-02, WORK-04]

coverage:
  - id: D1
    description: "runStack short-circuits to a scored RunOutcome (build_failed/timeout) + terminal BenchmarkFinishedEvent on any install or build failure/timeout, keeping the workspace for post-mortem, without ever throwing"
    requirement: BUILD-01
    verification:
      - kind: unit
        ref: "tests/runStack.test.ts#runStack — fatal install/build paths"
        status: pass
    human_judgment: false
  - id: D2
    description: "Lint/test are recorded as non-fatal stage events (pass or fail) and never block the completed path; both are skipped entirely (no events) when absent from the stack spec"
    requirement: BUILD-02
    verification:
      - kind: unit
        ref: "tests/runStack.test.ts#runStack — non-fatal lint/test, dist size, readiness, screenshot, teardown > records failing lint/test as non-fatal..."
        status: pass
      - kind: unit
        ref: "tests/runStack.test.ts#runStack — non-fatal lint/test, dist size, readiness, screenshot, teardown > skips lint/test entirely..."
        status: pass
    human_judgment: false
  - id: D3
    description: "dist/ build output size is captured in a meta.json artifact (kind=meta) whenever build succeeds, alongside page-error signals on full success"
    requirement: BUILD-02
    verification:
      - kind: unit
        ref: "tests/runStack.test.ts#...records failing lint/test as non-fatal, still reaches completed with a screenshot + meta.json"
        status: pass
    human_judgment: false
  - id: D4
    description: "start_failed (process died before answering) vs timeout (never answered, may still be running) are classified distinctly, and the start subprocess is guaranteed killed exactly once via a finally block on every exit path from start-through-screenshot"
    requirement: WORK-04
    verification:
      - kind: unit
        ref: "tests/runStack.test.ts#...returns start_failed when the start process exits..."
        status: pass
      - kind: unit
        ref: "tests/runStack.test.ts#...returns timeout/start and kills the subprocess..."
        status: pass
    human_judgment: false
  - id: D5
    description: "waitForHttp200 polls a URL until HTTP 200 with a 250ms backoff and throws once its deadline passes, using only native fetch/AbortSignal.timeout"
    verification:
      - kind: unit
        ref: "tests/readiness.test.ts#waitForHttp200"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-02
status: complete
---

# Phase 02 Plan 05: Assemble runStack() Summary

**`runStack(stack, runId, storage)` — the pure D2-20 pipeline entrypoint wiring copy → install → build → (lint/test, non-fatal) → start → readiness → screenshot → teardown through the Plan 02-02/02-03/02-04 primitives, with every fatal stage/timeout mapped to a scored `RunOutcome` and guaranteed-once process-group teardown.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-02
- **Tasks:** 2
- **Files modified:** 4 (2 source, 2 test — both new)

## Accomplishments

- `src/runtime/readiness.ts` exports `waitForHttp200(url, timeoutMs)` — the native-`fetch` HTTP-poll half of the D2-10 layered readiness gate.
- `src/pipeline/runStack.ts` exports `runStack(stack, runId, storage): Promise<RunOutcome>` and `RunOutcome`, the exact 3-argument D2-20 entrypoint.
- Install/build failures and timeouts short-circuit to a scored `RunOutcome` (`build_failed`/`timeout`) with a terminal `BenchmarkFinishedEvent`, the workspace kept for post-mortem (D2-05/D2-13) — the promise never rejects.
- Lint/test run only when declared, are recorded as non-fatal `stage_completed`/`stage_failed` events, and never block reaching the screenshot when build+start succeed (D2-14/D2-16).
- `dist/` build output size is summed generically (stack-agnostic) and written to a `meta.json` artifact, along with Playwright's page-error signals (console errors, uncaught exceptions, failed requests) on full success (D2-15/D2-18).
- The start subprocess is raced against `waitForHttp200` to distinguish `start_failed` (process died before ever answering) from `timeout` (never answered, may still be running) — both kill the process tree and emit a terminal event.
- `killProcessTree` runs exactly once, inside a single `finally` covering the entire start-through-screenshot sequence — success, start_failed, timeout, or an unexpected throw all guarantee teardown (WORK-04, T-2-03).
- `cleanupWorkspace` is called with `keep:false` only on the `"completed"` path and `keep:true` on every other exit path (D2-05).

## Task Commits

Each task followed RED → GREEN:

1. **Task 1: Happy-path + fatal-stage short-circuit (install/build)**
   - `ad20db8` test: failing tests for readiness poll + install/build fatal paths
   - `a562310` feat: `waitForHttp200` + `runStack`'s install/build short-circuit
2. **Task 2: Non-fatal lint/test, dist size, readiness, screenshot, teardown**
   - `7eefce5` test: failing tests for non-fatal lint/test, dist size, start classification
   - `6165c12` feat: complete `runStack` — dist size, non-fatal lint/test, start classification, screenshot, teardown

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/runtime/readiness.ts` — `waitForHttp200(url, timeoutMs)`, the HTTP-poll half of D2-10's layered readiness gate.
- `src/pipeline/runStack.ts` — `runStack(stack, runId, storage)` and `RunOutcome`, the full D2-20 pipeline.
- `tests/readiness.test.ts` — unit tests for `waitForHttp200` (resolves on 200, throws on deadline).
- `tests/runStack.test.ts` — unit tests for `runStack` covering all 4 status branches (`build_failed`, `timeout`×2 variants, `start_failed`, `completed`), D-06 event ordering, D2-05 workspace retention, and WORK-04 subprocess teardown — using lightweight fake node-script stack commands and a fake in-memory `StoragePort`, per this plan's guidance to defer the real Angular end-to-end run to Plan 02-06.

## Decisions Made

- `runStack` never imports `"playwright"` — only `createPlaywrightRenderer()` from `src/render/playwrightRenderer.ts`, keeping `RenderPort` the sole seam between the pipeline and the concrete renderer (D2-21/D-23), matching this plan's success criteria.
- Install/build/lint/test all funnel through one `runAndRecordStage()` closure that emits `StageStarted`/`Completed`/`Failed` + writes the stage log; only install/build additionally check the outcome for a fatal early return. This kept the four-stage event-emission logic in one place instead of four near-duplicate blocks.
- The start/screenshot race uses three string-literal outcomes (`"ready" | "readyTimeout" | "exited"`) rather than nested `Promise.race`/`try-catch` branching, so the "process died" vs "never answered" distinction required by the plan's `<behavior>` block falls out of a single `Promise.race` instead of manual bookkeeping.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test-fixture hang script used an unsettled top-level `await`, which Node 24 treats as an intentional process exit (code 13)**
- **Found during:** Task 2 GREEN verification (`timeout/start` test failing with `status: "start_failed"` instead of `"timeout"`)
- **Issue:** The test's `HANG_SCRIPT` fixture (meant to simulate a start command that never answers) used `await new Promise(() => {})` at the top level. Node 24's runtime detects an unsettled top-level await with nothing else keeping the event loop alive and exits the module with code 13 and a `Warning: Detected unsettled top-level await` — so the fixture process exited almost immediately instead of hanging, making `runStack` correctly (but misleadingly, from the test's perspective) classify it as `start_failed`.
- **Fix:** Switched the fixture to `setInterval(function(){}, 1000);`, the same event-loop-keepalive idiom already used by `tests/stage.test.ts`'s existing grandchild-kill fixture, verified empirically via a standalone `tsx` repro before and after the fix.
- **Files modified:** `tests/runStack.test.ts` (test fixture only — no `runStack.ts` change was needed; the implementation's classification logic was already correct)
- **Verification:** `npx vitest run tests/runStack.test.ts` — all 10 tests pass.
- **Committed in:** `6165c12` (Task 2 feat commit)

---

**Total deviations:** 1 auto-fixed (1 bug, test-fixture only — no production code affected)
**Impact on plan:** Zero impact on `runStack.ts`'s actual behavior; the fix was entirely within the test's own fixture script. No scope creep.

## Issues Encountered

- `npx tsc --noEmit` intentionally failed after Task 1's commit (`TS2366: Function lacks ending return statement`) because Task 1's `<action>` deliberately leaves `runStack` incomplete pending Task 2's continuation, per the plan's own acceptance-criteria note ("Task 2 completes the file to a fully valid module before this criterion is checked in the wave's final verification"). Resolved immediately by Task 2; `npx tsc --noEmit` and the full `npx vitest run` suite (51/51) are both clean as of the final commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `runStack(stack, runId, storage)` exists as the single, fully-tested D2-20 pipeline entrypoint. Plan 02-06 can now exercise it directly against the real committed Angular template end-to-end (real `npm ci`/`ng build`/`sirv` start, real Playwright screenshot) without touching `runStack.ts` itself.
- All fatal/non-fatal/timeout classification branches, D-06 event shapes, D2-05 workspace retention, and WORK-04 process-tree teardown are covered by fast unit tests (fake node-script stack commands + fake `StoragePort`) — Plan 02-06's job is the real-Angular integration proof, not re-deriving this logic.
- No blockers. The `stacks/angular.yaml` template's `@angular/cli` engine constraint (Node ≥24.15.0) is unaffected by this plan since no test here spawns the real Angular toolchain — that remains Plan 02-06's concern, as scoped.

## Self-Check: PASSED

All created files and task commit hashes verified present on disk / in git history.

---
*Phase: 02-workspace-build-serve-runtime*
*Completed: 2026-07-02*
