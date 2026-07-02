---
phase: 02-workspace-build-serve-runtime
plan: 01
subsystem: infra
tags: [playwright, execa, pixelmatch, pngjs, zod, vitest, ports]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: AgentEvent union (src/core/events.ts), StackSchema/ScenarioSchema/ModelSchema (src/specs/schema.ts), core ports seam (src/core/ports.ts)
provides:
  - "playwright/execa/pixelmatch/pngjs pinned as prod deps, @types/pngjs as dev dep, all importable at exact CLAUDE.md versions"
  - "Two-tier vitest suite: vitest.config.ts (fast unit) excludes *.integration.test.ts/*.selftest.test.ts; vitest.integration.config.ts (960000ms timeout) includes them"
  - "Stage widened to install|build|lint|test|start (D2-14), reusing existing StageStarted/Completed/Failed event shapes"
  - "StackSchema.lint/.test optional command strings (D2-16) + six optional positive-integer *TimeoutMs override fields (D2-17), .strict() preserved"
  - "RenderPort/RenderInput/RenderResult seam in src/core/ports.ts (D2-21), zero playwright import"
affects: [02-02, 02-03, 02-04, 02-05, 02-06]

# Tech tracking
tech-stack:
  added: ["playwright@1.61.1", "execa@9.6.1", "pixelmatch@7.2.0", "pngjs@7.0.0", "@types/pngjs@6.0.5"]
  patterns:
    - "Two-tier vitest config: base config excludes heavy globs via configDefaults.exclude spread; a sibling *.integration.config.ts opts those globs back in with a raised timeout"
    - "Per-stage timeout overrides live on StackSchema as optional fields (stack.<stage>TimeoutMs ?? <built-in default>), not as hardcoded runStack constants"

key-files:
  created: [vitest.integration.config.ts]
  modified: [package.json, package-lock.json, vitest.config.ts, src/core/events.ts, src/specs/schema.ts, src/core/ports.ts, tests/specs.test.ts, tests/core.test.ts]

key-decisions:
  - "playwright/execa/pixelmatch/pngjs installed as production dependencies (not devDependencies) since they're used by the runtime pipeline itself and by Phase 3's evaluator, matching CLAUDE.md's Recommended Stack categorization"
  - "@types/pngjs pinned to 6.0.5 (current latest) since pngjs ships no bundled type declarations, unlike playwright/execa/pixelmatch"
  - "RenderPort lives in src/core/ports.ts (not a new render/renderPort.ts file) per 02-CONTEXT.md D2-21 canonical_refs"
  - "RenderInput excludes deviceScaleFactor/reducedMotion/browser-channel — those are fixed platform choices (D2-12) the concrete Plan 02-04 implementation hardcodes, not caller-configurable"

patterns-established:
  - "TDD gate for schema/type-widening changes: write a StackSchema.safeParse assertion + a Stage-literal usage first (RED), confirm both vitest and tsc fail, then land the widening (GREEN)"

requirements-completed: [WORK-03, BUILD-02, BUILD-03, BUILD-04]

coverage:
  - id: D1
    description: "playwright, execa, pixelmatch, pngjs installed and importable at CLAUDE.md-pinned exact versions"
    requirement: "BUILD-02"
    verification:
      - kind: unit
        ref: "npm ls playwright execa pixelmatch pngjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "npm test runs only the fast unit suite; heavy integration/self-test globs excluded, run only via vitest.integration.config.ts"
    requirement: "BUILD-03"
    verification:
      - kind: unit
        ref: "npm test (vitest.config.ts exclude array)"
        status: pass
    human_judgment: false
  - id: D3
    description: "StackSchema accepts optional lint/test fields plus six optional per-stage timeout overrides, still rejects unknown keys"
    requirement: "BUILD-04"
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#StackSchema lint/test + timeout overrides"
        status: pass
    human_judgment: false
  - id: D4
    description: "Stage type recognizes lint and test alongside install/build/start with no new event variants"
    requirement: "WORK-03"
    verification:
      - kind: unit
        ref: "tests/core.test.ts#AgentEvent accepts lint and test stage values on StageCompletedEvent"
        status: pass
    human_judgment: false
  - id: D5
    description: "RenderPort declared in core/ports.ts as a pure-data seam, importing nothing concrete"
    verification:
      - kind: unit
        ref: "grep -c '\"playwright\"' src/core/ports.ts (returns 0) + npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 3min
completed: 2026-07-02
status: complete
---

# Phase 2 Plan 1: Runtime Deps + Contract Foundation Summary

**Pinned playwright/execa/pixelmatch/pngjs at exact CLAUDE.md versions, split vitest into fast-unit and slow-integration tiers, and widened the Phase-1 Stage/StackSchema/ports contracts (lint/test stages, per-stage timeout overrides, RenderPort seam) for every downstream Phase-2 plan to build on.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-02T02:17:37Z
- **Completed:** 2026-07-02T02:20:42Z
- **Tasks:** 3 (Task 2 followed TDD RED/GREEN)
- **Files modified:** 8 (1 created: vitest.integration.config.ts; 7 modified)

## Accomplishments
- Installed playwright 1.61.1, execa 9.6.1, pixelmatch 7.2.0, pngjs 7.0.0 as production deps + @types/pngjs 6.0.5 as a dev dep, all resolving cleanly via `npm ls`
- Split vitest into a fast unit tier (`vitest.config.ts`, excludes `*.integration.test.ts`/`*.selftest.test.ts` via `configDefaults.exclude` spread) and a slow tier (`vitest.integration.config.ts`, 960000ms timeout) so Plans 02-04/02-06's heavy tests won't regress `npm test`
- Widened `Stage` to `"install" | "build" | "lint" | "test" | "start"` (D2-14), reusing `StageStarted/Completed/Failed` event shapes verbatim — no new event variant
- Added `StackSchema.lint`/`.test` optional command strings (D2-16) and six optional positive-integer `*TimeoutMs` override fields (D2-17), keeping `.strict()` unknown-key rejection intact
- Added `RenderPort`/`RenderInput`/`RenderResult` to `src/core/ports.ts` (D2-21) as a plain-data seam with zero `playwright` import, ready for Plan 02-04

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Phase-2 runtime dependencies + two-tier vitest config** - `9ae5421` (feat)
2. **Task 2: Extend core contracts for lint/test stages + timeout overrides** - `788f359` (test, RED) → `33154c6` (feat, GREEN)
3. **Task 3: Add RenderPort seam to core/ports.ts** - `9005f23` (feat)

**Plan metadata:** _(pending — final docs commit follows this SUMMARY)_

_Note: Task 2 followed the plan's `tdd="true"` flag — a failing StackSchema/Stage-literal test landed first, then the widening that turned it green._

## Files Created/Modified
- `package.json` / `package-lock.json` - Added playwright/execa/pixelmatch/pngjs (prod) + @types/pngjs (dev), all exact-pinned
- `vitest.config.ts` - Excludes `*.integration.test.ts`/`*.selftest.test.ts` (spreads `configDefaults.exclude`)
- `vitest.integration.config.ts` - New: raised-timeout (960000ms) config for the heavy test tier
- `src/core/events.ts` - `Stage` widened to include `"lint" | "test"`
- `src/specs/schema.ts` - `StackSchema` gains `.lint`/`.test` + six `*TimeoutMs` optional fields
- `src/core/ports.ts` - `RenderPort`/`RenderInput`/`RenderResult` added
- `tests/specs.test.ts` - `StackSchema` lint/test + timeout-override assertions
- `tests/core.test.ts` - `StageCompletedEvent` with `stage: "lint"`/`"test"` compile-time check

## Decisions Made
- playwright/execa/pixelmatch/pngjs go in `dependencies`, not `devDependencies` — they're used by the runtime pipeline and Phase 3's evaluator, not just tests, per CLAUDE.md's stack categorization
- `@types/pngjs` pinned to 6.0.5 (current latest at plan-authoring time) since pngjs itself ships no type declarations
- `RenderPort` lives in the existing `src/core/ports.ts` rather than a new `render/renderPort.ts` file, per 02-CONTEXT.md D2-21's explicit canonical_refs
- `RenderInput` deliberately excludes `deviceScaleFactor`/`reducedMotion`/browser-channel — these are fixed platform choices (D2-12) the concrete Plan 02-04 renderer hardcodes internally, not per-call caller options

## Deviations from Plan

None - plan executed exactly as written. 02-RESEARCH.md's claim that the four packages were "already installed locally" was already flagged as inaccurate by the plan itself (Task 1's `<action>`); this run confirmed `npm ls` printed empty before install and performed the install as instructed, which is the plan's documented path, not a deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 02-02, 02-03, and 02-04 can declare `depends_on: ["02-01"]` and consume the widened `Stage`, `StackSchema.lint`/`.test`/timeout-override fields, `RenderPort`, and `vitest.integration.config.ts` without further edits to these files
- `npm test` (28 tests, 5 files) and `npx tsc --noEmit` are both green
- No blockers for Wave 2 (Plans 02-02/02-03/02-04)

---
*Phase: 02-workspace-build-serve-runtime*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created/modified files and task commit hashes verified present on disk / in git log.
