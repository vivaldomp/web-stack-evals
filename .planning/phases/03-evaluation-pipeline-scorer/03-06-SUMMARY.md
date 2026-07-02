---
phase: 03-evaluation-pipeline-scorer
plan: 06
subsystem: evaluation
tags: [evaluator-registry, pixelmatch, axe-core, judge, dom, better-sqlite3, pi-ai]

# Dependency graph
requires:
  - phase: 03-evaluation-pipeline-scorer
    provides: createPixelMatchEvaluator/createJudgeEvaluator (03-03), createDomEvaluator/createAxeEvaluator (03-04), lookupCachedJudgeVerdict (03-01)
provides:
  - "buildRegistry(deps): EvaluatorPort[] — the single composition point for all four v1 evaluators"
affects: [03-07-full-pipeline-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Registry as a plain array-builder (not a plugin framework) — one file, one conditional, per 03-RESEARCH.md Pattern 2"

key-files:
  created: [src/eval/registry.ts, tests/registry.test.ts]
  modified: []

key-decisions:
  - "buildRegistry treats expectedElements: [] the same as undefined -- both omit the dom entry (D3-09)"
  - "pixelmatch/axe/judge construction has zero conditionals -- D3-16's 'always run' encoded as unconditional array literal entries, not guarded pushes"

patterns-established:
  - "Registry composition: unconditional array literal for always-on evaluators, single guarded .push() for conditional ones -- the only place a future evaluator's inclusion rule gets encoded (D3-15)"

requirements-completed: [EVAL-05]

coverage:
  - id: D1
    description: "buildRegistry() returns exactly [axe, judge, pixelmatch] when expectedElements is absent or an empty array (D3-09)"
    requirement: "EVAL-05"
    verification:
      - kind: unit
        ref: "tests/registry.test.ts#omits the dom entry when expectedElements is absent (D3-09)"
        status: pass
      - kind: unit
        ref: "tests/registry.test.ts#omits the dom entry when expectedElements is an explicitly empty array"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildRegistry() returns exactly [axe, dom, judge, pixelmatch] when expectedElements is non-empty"
    requirement: "EVAL-05"
    verification:
      - kind: unit
        ref: "tests/registry.test.ts#includes the dom entry when expectedElements is non-empty"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every returned registry entry satisfies the EvaluatorPort structural shape"
    requirement: "EVAL-05"
    verification:
      - kind: unit
        ref: "tests/registry.test.ts#every returned entry satisfies the EvaluatorPort shape"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 3 Plan 6: Evaluator Registry Summary

**buildRegistry() composes pixelmatch/axe/judge unconditionally and dom conditionally into one EvaluatorPort[], the single place D3-09/D3-15/D3-16 are enforced**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T17:16:00Z
- **Completed:** 2026-07-02T17:23:57Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- `src/eval/registry.ts` exports `buildRegistry(deps): EvaluatorPort[]` and `RegistryDeps`, composing the four real evaluator factories from 03-03/03-04-PLAN.md
- pixelmatch, axe, and judge are always included (D3-16) — zero conditionals on their construction
- dom is included only when `deps.expectedElements` is a non-empty array (D3-09) — an absent or explicitly-empty list both omit it, never scored as 0.0/1.0
- `lookupCachedJudgeVerdict` (synchronous, `src/storage/evaluations.ts`) wrapped in a `Promise.resolve`-returning closure to satisfy `createJudgeEvaluator`'s async cache-lookup parameter, closed over the caller's `db`
- The function contains exactly one `if` statement (verified via grep) — no other conditional branching on evaluator identity, satisfying D3-15's "adding a fifth evaluator requires editing only this file" constraint

## Task Commits

Each task was committed atomically:

1. **Task 1: buildRegistry() — always-on pixelmatch/axe/judge, conditional dom (D3-09, D3-15, D3-16)** - `d6759bd` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `src/eval/registry.ts` - `buildRegistry(deps): EvaluatorPort[]`, `RegistryDeps` interface; composes the four evaluator factories
- `tests/registry.test.ts` - Structural unit coverage for all four `<behavior>` cases using a real temp-file `better-sqlite3` db (via `openDb()`) and a `fauxProvider()`-backed `Models` instance (matching 03-03's `judgeEvaluator.test.ts` construction pattern)

## Decisions Made
- Treated `expectedElements: []` identically to `undefined` per the plan's explicit behavior spec — both are "no declared elements," both omit the dom evaluator
- Test never calls `.evaluate()` on any constructed evaluator — pure structural/composition assertions only, keeping the test fast and free of Chromium/network dependencies, per the plan's own guidance

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `buildRegistry()` is ready for 03-07-PLAN.md's full-pipeline integration test to call once, real evaluators and all, feeding its result straight into `evaluateRun()` (03-05-PLAN.md) unmodified
- No blockers or concerns carried forward from this plan

---
*Phase: 03-evaluation-pipeline-scorer*
*Completed: 2026-07-02*

## Self-Check: PASSED

- FOUND: src/eval/registry.ts
- FOUND: tests/registry.test.ts
- FOUND: d6759bd (commit hash)
