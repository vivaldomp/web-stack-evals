---
phase: 03-evaluation-pipeline-scorer
plan: 04
subsystem: testing
tags: [playwright, axe-core, dom, accessibility, evaluator, vitest]

requires:
  - phase: 03-evaluation-pipeline-scorer
    provides: "renderWithPage() (03-02) — live Playwright Page, browser lifecycle left to caller"
  - phase: 03-evaluation-pipeline-scorer
    provides: "EvaluatorPort seam (Phase 1) — the shared { name, evaluate(input) } contract"
provides:
  - "createDomEvaluator(expectedElements) — EVAL-02, gradient found/declared structural-presence scoring"
  - "createAxeEvaluator() — EVAL-03, per-node severity-weighted a11y penalty floored at 0"
  - "tests/fixtures/eval/app.html + app-clean.html — shared live-page fixtures for both evaluators"
affects: [03-05, 03-06, registry, composite-scoring]

tech-stack:
  added: []
  patterns:
    - "Live-page evaluators (dom, axe) cast rawInput to { page: Page } and never call page.goto/close — only renderWithPage() manages browser lifecycle"
    - "Playwright's Page type import is explicitly allowed in domEvaluator.ts/axeEvaluator.ts (alongside renderWithPage.ts/playwrightRenderer.ts) without leaking into core/ports.ts"

key-files:
  created:
    - src/eval/domEvaluator.ts
    - src/eval/axeEvaluator.ts
    - tests/domEvaluator.integration.test.ts
    - tests/axeEvaluator.integration.test.ts
    - tests/fixtures/eval/app.html
    - tests/fixtures/eval/app-clean.html
  modified: []

key-decisions:
  - "app.html and app-clean.html both needed an explicit <h1> — axe-core's page-has-heading-one rule fired on the originally-drafted 'clean' fixture (rawScore 0.9, not 1.0), so both fixtures were corrected before the axe evaluator's clean-fixture-scores-1 assertion could hold"

patterns-established: []

requirements-completed: [EVAL-02, EVAL-03]

coverage:
  - id: D1
    description: "createDomEvaluator(expectedElements) returns EvaluatorPort with gradient found/declared scoring and detail.missing"
    requirement: EVAL-02
    verification:
      - kind: integration
        ref: "tests/domEvaluator.integration.test.ts#scores a gradient with missing selectors reported in detail.missing"
        status: pass
      - kind: integration
        ref: "tests/domEvaluator.integration.test.ts#scores 1 when every declared selector matches at least one element"
        status: pass
    human_judgment: false
  - id: D2
    description: "createAxeEvaluator() returns EvaluatorPort with per-node severity-weighted penalty, floored at 0, clean fixture scores exactly 1"
    requirement: EVAL-03
    verification:
      - kind: integration
        ref: "tests/axeEvaluator.integration.test.ts#scores exactly 1 on an a11y-clean page"
        status: pass
      - kind: integration
        ref: "tests/axeEvaluator.integration.test.ts#scores strictly less than the clean fixture when a violation is present"
        status: pass
      - kind: unit
        ref: "tests/axeEvaluator.integration.test.ts#never scores below 0, even for a synthetic high-violation-count case"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 3 Plan 4: DOM + Axe Live-Page Evaluators Summary

**Two live-page evaluators (`createDomEvaluator`, `createAxeEvaluator`) that consume an already-open `renderWithPage()` `Page` — gradient structural-presence scoring and per-node severity-weighted accessibility scoring, sharing one pair of static HTML fixtures.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T17:04:00Z
- **Completed:** 2026-07-02T17:09:36Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `src/eval/domEvaluator.ts` — `createDomEvaluator(expectedElements)`, gradient scoring (`found / declared`), never pass/fail (D3-08)
- `src/eval/axeEvaluator.ts` — `createAxeEvaluator()`, `IMPACT_PENALTY` table (critical 0.5, serious 0.25, moderate 0.1, minor 0.05), per-node penalty floored at 0 via `Math.max(0, 1 - penalty)` (D3-10)
- `tests/fixtures/eval/app.html` (deliberate missing-`alt` violation) and `app-clean.html` (a11y-clean), shared by both evaluators' integration tests
- Both evaluators proven against a real headless Chromium `Page` (via `renderWithPage` + `file://` URLs) — no mocked `Page`, no browser-lifecycle calls inside either evaluator

## Task Commits

Each task was committed atomically:

1. **Task 1: DOM structural-presence evaluator + shared fixtures** - `506668d` (feat)
2. **Task 2: Axe accessibility evaluator with severity-weighted penalty** - `3941964` (feat)

**Plan metadata:** (pending — see below)

_Note: fixtures were authored inside Task 1's commit; Task 2's commit additionally corrects both fixtures (see Deviations)._

## Files Created/Modified
- `src/eval/domEvaluator.ts` - `createDomEvaluator(expectedElements): EvaluatorPort`, casts `{ page: Page }`, loops `page.locator(selector).count()`
- `src/eval/axeEvaluator.ts` - `createAxeEvaluator(): EvaluatorPort`, `IMPACT_PENALTY`, runs `new AxeBuilder({ page }).analyze()`
- `tests/domEvaluator.integration.test.ts` - both `<behavior>` cases from Task 1 (0.75 gradient + 1.0 full match), against a real `file://` page
- `tests/axeEvaluator.integration.test.ts` - clean-fixture-scores-1, violating-fixture-scores-less-than-clean, and a synthetic-count floor-at-0 unit assertion
- `tests/fixtures/eval/app.html` - `nav[role='navigation']`, `.dashboard-card`, `button[type='submit']`, `<img>` missing `alt`, plus `<h1>` (added during Task 2's fix)
- `tests/fixtures/eval/app-clean.html` - same structure, `<img alt="...">`, plus `<h1>` (added during Task 2's fix)

## Decisions Made
- Both fixtures needed an explicit `<h1>`: axe-core's default ruleset includes `page-has-heading-one`, which fired on the originally-drafted "clean" fixture (no heading at all), producing `rawScore === 0.9` instead of the required `1`. Added `<h1>Dashboard</h1>` to both fixtures so `app-clean.html` is genuinely a11y-clean per axe-core's actual rule set, not just per this evaluator's imagined subset of rules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] app-clean.html was not actually a11y-clean (missing `<h1>`)**
- **Found during:** Task 2 (writing `tests/axeEvaluator.integration.test.ts`'s "scores exactly 1" case)
- **Issue:** The fixture drafted in Task 1 had no top-level heading, so axe-core's `page-has-heading-one` rule (moderate impact) fired even on `app-clean.html`, producing `rawScore === 0.9` — failing the plan's `<behavior>` requirement that the clean fixture score exactly `1`.
- **Fix:** Added `<h1>Dashboard</h1>` inside `<main>` in both `app.html` and `app-clean.html` (kept both fixtures' element shape identical, per the plan's own instruction).
- **Files modified:** `tests/fixtures/eval/app.html`, `tests/fixtures/eval/app-clean.html`
- **Verification:** Re-ran `npx vitest run --config vitest.integration.config.ts tests/axeEvaluator.integration.test.ts tests/domEvaluator.integration.test.ts` — all 5 tests pass; `app-clean.html` now scores exactly `1`.
- **Committed in:** `3941964` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correction to satisfy the plan's own stated behavior (clean fixture scores exactly 1). No scope creep — same two files, same element shape, one added heading.

## Issues Encountered
None beyond the fixture fix documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both live-page evaluators satisfy `EvaluatorPort` and are ready for `registry.ts` (03-06-PLAN.md) to compose alongside `pixelmatch`/`judge` (03-03) — `createDomEvaluator` is conditionally included only when `scenario.expectedElements` is non-empty (D3-09), per 03-06's wiring note.
- No blockers.

---
*Phase: 03-evaluation-pipeline-scorer*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created files found on disk; both task commits (`506668d`, `3941964`) found in git log.
