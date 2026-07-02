---
phase: 03-evaluation-pipeline-scorer
plan: 07
subsystem: testing
tags: [vitest, playwright, better-sqlite3, pi-ai, faux-provider, integration-test]

requires:
  - phase: 03-evaluation-pipeline-scorer
    provides: "renderWithPage (03-02), pixelmatch/dom/axe/judge evaluators (03-03/03-04), evaluateRun + composite scoring (03-01/03-05), buildRegistry (03-06)"
provides:
  - "tests/evalPipeline.integration.test.ts -- the single real (no-mock) proof that every Phase 3 piece composes end-to-end"
affects: [phase-04-agent-runtime, verify-work]

tech-stack:
  added: []
  patterns:
    - "Faux pi-ai provider registered under a production model constant's own provider/model ids (DEFAULT_JUDGE_MODEL), so buildRegistry can be called with the literal production constant while the resolved model is still a zero-network test double"

key-files:
  created:
    - tests/evalPipeline.integration.test.ts
  modified: []

key-decisions:
  - "fauxProvider() constructed with { provider: DEFAULT_JUDGE_MODEL.provider, models: [{ id: DEFAULT_JUDGE_MODEL.modelId, input: ['text','image'] }] } instead of the ad-hoc faux ids used by registry.test.ts/judgeEvaluator.test.ts -- lets buildRegistry() be called with the real DEFAULT_JUDGE_MODEL constant (per plan text) while models.getModel() still resolves to the faux test double, preserving the zero-network/no-ANTHROPIC_API_KEY guarantee"

patterns-established: []

requirements-completed: [EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, SCORE-01, SCORE-02]

coverage:
  - id: D1
    description: "One renderWithPage() call feeds a shared live page to buildRegistry()'s real pixelmatch/dom/axe/judge evaluators via evaluateRun(), producing four persisted evaluations rows (ROADMAP SC1)"
    requirement: "EVAL-01"
    verification:
      - kind: integration
        ref: "tests/evalPipeline.integration.test.ts#renders once, scores through all four real evaluators, and persists raw scores + a re-derivable composite"
        status: pass
    human_judgment: false
  - id: D2
    description: "dom and axe evaluators score from the same shared render pass -- one page, closed exactly once by the caller after both finish (D3-17)"
    requirement: "EVAL-02"
    verification:
      - kind: integration
        ref: "tests/evalPipeline.integration.test.ts#renders once, scores through all four real evaluators, and persists raw scores + a re-derivable composite"
        status: pass
    human_judgment: false
  - id: D3
    description: "Raw sub-scores persist as separate evaluations rows, distinct from the runs.composite_score column, with composite_weights re-derivable and summing to 1 (ROADMAP SC4, SCORE-02)"
    requirement: "SCORE-02"
    verification:
      - kind: integration
        ref: "tests/evalPipeline.integration.test.ts#renders once, scores through all four real evaluators, and persists raw scores + a re-derivable composite"
        status: pass
    human_judgment: false
  - id: D4
    description: "The full pipeline runs green end-to-end on fixture screenshots with no agent, no dev server, and no live network call (ROADMAP SC5)"
    requirement: "EVAL-05"
    verification:
      - kind: integration
        ref: "tests/evalPipeline.integration.test.ts#renders once, scores through all four real evaluators, and persists raw scores + a re-derivable composite"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-02
status: complete
---

# Phase 3 Plan 07: End-to-End Evaluation Pipeline Integration Test Summary

**One no-mocks integration test proves renderWithPage + buildRegistry + evaluateRun compose correctly: 4 real evaluators, 1 shared page closed once, a re-derivable composite score, zero network calls.**

## Performance

- **Duration:** 12min
- **Completed:** 2026-07-02
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- `tests/evalPipeline.integration.test.ts` wires the real `renderWithPage()`, `buildRegistry()`, and `evaluateRun()` together against the `tests/fixtures/eval/app.html` fixture and `pngFixtures.ts` procedural buffers -- no fake `EvaluatorPort` stand-ins, no mocked `Page`.
- Confirms the D3-17 lifecycle contract: `renderWithPage()` is called exactly once, its `page` is handed to `evaluateRun()`'s loop (consumed internally by the dom and axe evaluators), and `close()` is invoked by the test itself only after `evaluateRun()` resolves -- `page.isClosed()` is asserted `false` before close and `true` after.
- Asserts exactly 4 `evaluations` rows (`axe`, `dom`, `judge`, `pixelmatch`), each with a non-null `raw_score` in `[0,1]`; a non-null `runs.composite_score` in `[0,1]`; `composite_weights` JSON that sums to 1; and a `screenshots` row with `role='diff'` linked from the pixelmatch evaluator's diff image.
- The judge evaluator's `Models` instance uses pi-ai's `fauxProvider()` test double registered under `DEFAULT_JUDGE_MODEL`'s own `provider`/`modelId`, so the test calls `buildRegistry({ ..., judgeModel: DEFAULT_JUDGE_MODEL })` with the real production constant while still requiring zero network access and no `ANTHROPIC_API_KEY`.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end fixture pipeline -- real renderWithPage + real registry + real evaluateRun (ROADMAP SC5)** - `b9aa62f` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `tests/evalPipeline.integration.test.ts` - The ROADMAP Phase 3 Success Criterion 5 proof: real renderWithPage + buildRegistry + evaluateRun, faux-provider judge, four persisted evaluations rows, re-derivable composite.

## Decisions Made
- Registered the faux pi-ai provider under `DEFAULT_JUDGE_MODEL`'s own `provider`/`modelId` (`{ provider: "anthropic", modelId: "claude-sonnet-5" }`) rather than inventing ad-hoc faux ids, so the plan's literal instruction to call `buildRegistry({ ..., judgeModel: DEFAULT_JUDGE_MODEL })` resolves correctly against a zero-network `Models` instance. `createJudgeEvaluator`'s construction-time `models.getModel(provider, modelId)` lookup would otherwise throw "unknown model anthropic/claude-sonnet-5" against the ad-hoc faux ids `tests/registry.test.ts`/`tests/judgeEvaluator.test.ts` use, since those tests never need to match a specific production constant.

## Deviations from Plan

None - plan executed exactly as written. The faux-provider registration choice above is a within-scope implementation detail needed to satisfy the plan's own literal instruction (`judgeModel: DEFAULT_JUDGE_MODEL`) without breaking the plan's equally explicit "no ANTHROPIC_API_KEY, no live network call" constraint -- not a deviation from either requirement.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Phase 3 (evaluation-pipeline-scorer) is complete: all 7 plans executed, and this plan's integration test is the checkpoint proof that ROADMAP Phase 3's five Success Criteria all hold against real (fixture-driven) code. Phase 4 (Agent Runtime / Pi SDK integration) can now build on a green, fully-composed evaluation pipeline.

---
*Phase: 03-evaluation-pipeline-scorer*
*Completed: 2026-07-02*

## Self-Check: PASSED
- FOUND: tests/evalPipeline.integration.test.ts
- FOUND: b9aa62f (test(03-07) commit)
