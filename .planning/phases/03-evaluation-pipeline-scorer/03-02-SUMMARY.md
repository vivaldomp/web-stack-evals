---
phase: 03-evaluation-pipeline-scorer
plan: 02
subsystem: evaluation-pipeline
tags: [playwright, vitest, scoring, composite]

requires:
  - phase: 02-runtime-execution-render
    provides: playwrightRenderer.ts (browser/context/page setup, bounded-navigation Promise.race pattern, page-error listener wiring) and determinism.ts (installDeterminismControls/blockExternalFonts) that renderWithPage reuses
provides:
  - "renderWithPage(input) -> LiveRenderResult: a render pass that keeps the Playwright page open (page + close()) instead of tearing it down before returning"
  - "composeScore(): pure weighted-mean composite with drop-and-renormalize semantics, DEFAULT_EVALUATOR_WEIGHTS, EvaluatorOutcome/CompositeResult types"
affects: [03-04-PLAN.md (axe/DOM evaluators consume renderWithPage's page), 03-05-PLAN.md (evaluateRun feeds composeScore real evaluator outcomes)]

tech-stack:
  added: []
  patterns:
    - "Render seams that need an open Page (evaluators) get a sibling file to playwrightRenderer.ts, not a modification of RenderPort/core/ports.ts"
    - "Composite/aggregation logic stays a pure function with zero I/O and zero knowledge of concrete evaluators, decoupled from persistence and from which evaluators ran"

key-files:
  created:
    - src/render/renderWithPage.ts
    - tests/renderWithPage.integration.test.ts
    - src/pipeline/composite.ts
    - tests/composite.test.ts
  modified: []

key-decisions:
  - "[Phase 03-02] renderWithPage.ts redefines NAVIGATION_BUDGET_MS/SETTLE_MS locally (same values as playwrightRenderer.ts) rather than importing them, since playwrightRenderer.ts is out of this task's declared file scope and does not export them"
  - "[Phase 03-02] renderWithPage.ts closes browser/context on setup/navigation failure (catch-and-rethrow), even though the success path deliberately leaves teardown to the caller's close() -- a thrown error means no LiveRenderResult (and thus no close()) is ever handed back, so skipping this would leak a Chromium process per failed render"

patterns-established:
  - "Pattern: sibling-file render seam -- a second explicitly-named file may import 'playwright' for a variant render contract (open page) without touching RenderPort or core/ports.ts"

requirements-completed: [SCORE-01]

coverage:
  - id: D1
    description: "renderWithPage() resolves with a non-empty png and returns a live, still-open Page; caller-invoked close() tears it down"
    requirement: SCORE-01
    verification:
      - kind: integration
        ref: "tests/renderWithPage.integration.test.ts#resolves with a non-empty png and a still-open page"
        status: pass
      - kind: integration
        ref: "tests/renderWithPage.integration.test.ts#close() tears down the browser/context so page.isClosed() becomes true"
        status: pass
    human_judgment: false
  - id: D2
    description: "renderWithPage() rejects within the bounded navigation budget (does not hang) when navigation never resolves -- DoS mitigation carried over from playwrightRenderer.ts"
    requirement: SCORE-01
    verification:
      - kind: integration
        ref: "tests/renderWithPage.integration.test.ts#rejects within the bounded navigation budget when navigation never resolves"
        status: pass
    human_judgment: false
  - id: D3
    description: "composeScore() computes the weighted mean over all survivors and renormalizes when an evaluator drops, never counting it as 0"
    requirement: SCORE-01
    verification:
      - kind: unit
        ref: "tests/composite.test.ts#computes the plain weighted mean when all four evaluators survive at equal default weights"
        status: pass
      - kind: unit
        ref: "tests/composite.test.ts#renormalizes survivor weights when judge drops, matching the research worked example"
        status: pass
      - kind: unit
        ref: "tests/composite.test.ts#honors a scenario-supplied custom weight map over the default"
        status: pass
    human_judgment: false
  - id: D4
    description: "composeScore() returns compositeScore: null (never 0 or NaN) when every evaluator drops"
    requirement: SCORE-01
    verification:
      - kind: unit
        ref: "tests/composite.test.ts#returns null (never 0 or NaN) when every evaluator drops"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-02
status: complete
---

# Phase 3 Plan 2: Render-with-open-page seam + weighted-mean composite scorer Summary

**`renderWithPage()` keeps a Playwright page open past the screenshot (for axe/DOM evaluators) and `composeScore()` implements the drop-and-renormalize weighted-mean composite (SCORE-01) — both pure infrastructure with zero dependency on concrete evaluators.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-02T13:36:40-03:00
- **Completed:** 2026-07-02T13:45:54-03:00
- **Tasks:** 2
- **Files modified:** 4 (all new)

## Accomplishments
- `src/render/renderWithPage.ts` — sibling to `playwrightRenderer.ts`, reuses `installDeterminismControls`/`blockExternalFonts` and the identical bounded `Promise.race` navigation-timeout pattern; returns `LiveRenderResult` (`RenderResult` + `page` + `close()`), leaving teardown to the caller on success
- `src/pipeline/composite.ts` — `composeScore()` pure weighted-mean composite with drop-and-renormalize semantics; all-dropped short-circuits to `null` before any division (Pitfall 5)
- `core/ports.ts` untouched (verified via `git diff --stat` — empty) — RenderPort/RenderResult remain exactly as Phase 2 left them (D-23)

## Task Commits

Each task was committed atomically:

1. **Task 1: renderWithPage() — shared render pass that stays open (D3-17)** - `28915ba` (feat)
2. **Task 2: composeScore() — weighted-mean composite with drop-and-renormalize (D3-01, D3-03, D3-04, SCORE-01)** - `046ceff` (feat)

**Plan metadata:** (this commit)

_Note: Both tasks are `tdd="true"`. RED was verified manually per task (implementation/composite module temporarily absent, confirmed the test suite failed with "Cannot find module") before GREEN (implementation added, full pass), then committed as a single `feat` commit per task rather than separate `test`/`feat` commits — this plan's frontmatter is `type: execute` (not `type: tdd`), so the plan-level RED/GREEN gate-commit sequence does not apply; atomic per-task commits were used instead._

## Files Created/Modified
- `src/render/renderWithPage.ts` - `renderWithPage(input)` returning `LiveRenderResult` (open page + `close()`)
- `tests/renderWithPage.integration.test.ts` - covers open-page, close()-teardown, and bounded-navigation-timeout behaviors (real Chromium, no mocks)
- `src/pipeline/composite.ts` - `composeScore`, `DEFAULT_EVALUATOR_WEIGHTS`, `EvalResult`/`DroppedResult`/`EvaluatorOutcome`, `CompositeResult`
- `tests/composite.test.ts` - covers equal-weights mean, renormalization on drop, all-dropped null short-circuit, and custom weight map

## Decisions Made
- `renderWithPage.ts` redefines `NAVIGATION_BUDGET_MS`/`SETTLE_MS` locally (same values as `playwrightRenderer.ts`) instead of importing them — `playwrightRenderer.ts` is outside this task's declared file scope (`files_modified` in frontmatter) and does not currently export these constants
- `renderWithPage.ts` closes the browser/context on setup/navigation failure (catch-and-rethrow around the navigation/screenshot steps), while still leaving teardown to the caller's `close()` on the success path, per the plan's explicit instruction

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Chromium process leak on renderWithPage() navigation/setup failure**
- **Found during:** Task 1, while verifying the "rejects within the bounded navigation budget" behavior case
- **Issue:** The plan's action text says not to wrap the browser/context open in `try/finally` (so the successful path can hand an open page + `close()` to the caller). Implemented literally, this also meant a thrown error (e.g. navigation timeout) propagated with the browser and context never closed — a leaked Chromium process per failed render. This surfaced concretely in testing: a `node:http` server that never responds correctly caused `renderWithPage()` to reject at ~12.2s (proving the DoS-mitigation budget was carried over), but the *test's* `server.close()` call then hung for the remaining ~18s of the test's 30s timeout, because the leaked browser's still-open TCP connection to the hanging server kept it from closing.
- **Fix:** Wrapped only the navigation/font-wait/screenshot steps (post page-listener wiring) in `try { ... } catch (err) { await context.close(); await browser.close(); throw err; }`. The success path is unchanged — it still returns the open page and a `close()` for the caller to invoke; only the failure path now guarantees teardown before rethrowing.
- **Files modified:** `src/render/renderWithPage.ts`
- **Verification:** Isolated the failure scenario in a standalone debug script (confirmed `renderWithPage()` itself correctly rejects at ~12.2s before the fix) and via `tests/renderWithPage.integration.test.ts` (all 3 cases pass after the fix, including the previously-hanging navigation-timeout case)
- **Committed in:** `28915ba` (part of Task 1 commit — fix was made before the task's single commit, so no separate fix commit exists)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for correctness — without it, every failed `renderWithPage()` call in the real pipeline (axe/DOM evaluators, 03-04-PLAN.md) would leak a Chromium process. No scope creep; fix is entirely contained within the task's own new file.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `renderWithPage()` is ready for the DOM-presence and axe evaluators (03-04-PLAN.md) to consume its `page`
- `composeScore()` is ready for `evaluateRun()` (03-05-PLAN.md) to feed it real evaluator outcomes
- Neither has any dependency on the concrete evaluators or on `core/ports.ts` changing (verified: `git diff --stat src/core/ports.ts` is empty)

---
*Phase: 03-evaluation-pipeline-scorer*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created files found on disk; both task commits (`28915ba`, `046ceff`) found in git log.
