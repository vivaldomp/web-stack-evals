---
phase: 02-workspace-build-serve-runtime
plan: 04
subsystem: render
tags: [playwright, chromium, screenshot, determinism, pixelmatch, pngjs]

requires:
  - phase: 02-workspace-build-serve-runtime (Plan 02-01)
    provides: "RenderPort/RenderInput/RenderResult interfaces in src/core/ports.ts"
provides:
  - "createPlaywrightRenderer(): RenderPort — headless Chromium screenshot at fixed viewport, deviceScaleFactor 1"
  - "installDeterminismControls/blockExternalFonts — D2-11 determinism controls (frozen Date/Math.random, killed CSS motion/caret, blocked font CDNs)"
  - "Passing BUILD-04 determinism self-test proving <=0.1% pixel drift"
affects: [02-05, 02-06, phase-3-evaluators]

tech-stack:
  added: []
  patterns:
    - "Only src/render/playwrightRenderer.ts imports the playwright package (D-23/D2-21 isolation seam)"
    - "Fresh browser launch + finally-block teardown per screenshot() call (v1 single-sequential, no pooling)"
    - "D2-15 non-fatal page-error capture: console/weberror/requestfailed collected but never block the screenshot"

key-files:
  created:
    - src/render/determinism.ts
    - src/render/playwrightRenderer.ts
    - tests/fixtures/render/index.html
    - tests/determinism.selftest.test.ts
  modified: []

key-decisions:
  - "pixelmatch's output-diff-image param passed as undefined, not null — the shipped index.d.ts types it as `Uint8Array | Uint8ClampedArray | void`, and TypeScript strict mode rejects null there even though pixelmatch's own JSDoc examples use null"
  - "Sequential (not concurrent) renderer.screenshot() calls in the self-test, matching the plan's literal two-calls behavior description and avoiding two simultaneous Chromium instances in a sandboxed CI environment"

patterns-established:
  - "Determinism controls are context-scoped (installDeterminismControls, 2x addInitScript) vs page-scoped (blockExternalFonts, page.route) — callers apply the former once per context and the latter once per page"

requirements-completed: [BUILD-03, BUILD-04]

coverage:
  - id: D1
    description: "createPlaywrightRenderer() implements RenderPort: fixed-viewport, deviceScaleFactor:1 PNG screenshot via headless bundled Chromium"
    requirement: "BUILD-03"
    verification:
      - kind: integration
        ref: "tests/determinism.selftest.test.ts#screenshotting the fixture twice yields <=0.1% differing pixels"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (RenderPort return-type assignability check)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D2-11 determinism controls (frozen Date/Math.random, killed CSS motion/caret, blocked external font CDNs) hold the self-test to <=0.1% pixel drift"
    requirement: "BUILD-04"
    verification:
      - kind: integration
        ref: "tests/determinism.selftest.test.ts#screenshotting the fixture twice yields <=0.1% differing pixels"
        status: pass
    human_judgment: false
  - id: D3
    description: "D2-15 non-fatal page-error capture (console errors, uncaught exceptions via weberror, failed requests) never blocks the screenshot"
    verification: []
    human_judgment: true
    rationale: "No dedicated test in this plan exercises a page that logs a console error / throws / has a failed request; the self-test fixture's own console/network paths are clean. Behavior is implemented per plan spec (listeners registered before navigation, collected into result fields, screenshot always proceeds) but not independently proven by an automated assertion in this plan."

duration: 15min
completed: 2026-07-02
status: complete
---

# Phase 2 Plan 4: Playwright RenderPort + Determinism Summary

**A `RenderPort` implementation launching headless bundled Chromium with frozen time/random, killed CSS motion, and blocked font CDNs — proven deterministic (<=0.1% pixel drift) by its own self-test against a fixture exercising every control.**

## Performance

- **Duration:** 15min
- **Started:** 2026-07-02T02:35:00Z
- **Completed:** 2026-07-02T02:50:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `installDeterminismControls`/`blockExternalFonts` (D2-11): context-level Date/Math.random freeze + CSS motion/caret kill, page-level font-CDN blocking
- `createPlaywrightRenderer(): RenderPort` (BUILD-03, D2-12/D2-15): fixed-viewport `deviceScaleFactor:1` screenshots, bounded `networkidle` + `fonts.ready` + settle readiness, non-fatal console/exception/failed-request capture, guaranteed browser teardown in `finally`
- `tests/determinism.selftest.test.ts` + `tests/fixtures/render/index.html` (BUILD-04): screenshots the fixture twice through the real renderer and asserts <=0.1% pixel diff via pixelmatch — ROADMAP Success Criterion 5 now provably TRUE

## Task Commits

Each task was committed atomically:

1. **Task 1: Determinism controls (D2-11)** - `1467b06` (feat)
2. **Task 2: RenderPort implementation (BUILD-03, D2-12/D2-15)** - `c533989` (feat)
3. **Task 3: Determinism self-test (BUILD-04) + minimal fixture** - `b3e1678` (test)

**Plan metadata:** commit created below (docs: complete plan)

## Files Created/Modified
- `src/render/determinism.ts` - `installDeterminismControls` (context-scoped Date/Math.random freeze + CSS motion/caret kill) and `blockExternalFonts` (page-scoped font-CDN route abort)
- `src/render/playwrightRenderer.ts` - `createPlaywrightRenderer(): RenderPort`, the only file in `src/` importing `playwright`
- `tests/fixtures/render/index.html` - minimal static fixture with a multi-second CSS `@keyframes` animation, a `fonts.googleapis.com` stylesheet link, and a `Math.random()`-seeded DOM write
- `tests/determinism.selftest.test.ts` - serves the fixture via `node:http`, screenshots it twice through the real renderer, asserts <=0.1% pixel diff via `pixelmatch`/`pngjs`

## Decisions Made
- `pixelmatch`'s diff-output parameter is passed as `undefined` rather than `null` — its shipped `index.d.ts` types the third parameter as `Uint8Array | Uint8ClampedArray | void`, and TypeScript strict mode rejects `null` there even though the library's own docs use `null` in examples. `undefined` satisfies both the type and the runtime "no diff image" behavior.
- The self-test's two `screenshot()` calls run sequentially, not via `Promise.all`, matching the plan's literal "two calls... each resolve successfully" behavior description and avoiding two simultaneous Chromium processes in this environment.

## Deviations from Plan

None - plan executed exactly as written. One environment prerequisite was handled inline (not a plan deviation): the pinned Playwright 1.61.1 requires bundled Chromium revision `chromium-1228`, which was not yet present in `~/.cache/ms-playwright` (only older revisions from prior work were cached); ran `npx playwright install chromium` before Task 3's verification to fetch it.

## Issues Encountered
None beyond the pixelmatch `null`-vs-`undefined` type mismatch noted above, resolved inline as part of Task 3's normal `tsc --noEmit` verification loop.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `RenderPort` is fully implemented and self-test-proven; Plan 02-05's `runStack` can depend on the `RenderPort` interface alone (D-23 seam intact — only `playwrightRenderer.ts` imports `playwright`).
- No blockers. Plan 02-05 (pipeline entrypoint) and 02-06 remain to consume this renderer against the real Angular workspace pipeline.

---
*Phase: 02-workspace-build-serve-runtime*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 4 created files verified present on disk; all 3 task commit hashes (1467b06, c533989, b3e1678) verified present in git log.
