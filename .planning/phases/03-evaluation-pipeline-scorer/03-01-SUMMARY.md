---
phase: 03-evaluation-pipeline-scorer
plan: 01
subsystem: database
tags: [zod, sqlite, better-sqlite3, sharp, axe-core, pi-ai, evaluations]

requires:
  - phase: 02-orchestrator-runtime
    provides: writeArtifact/getArtifactPath (src/storage/artifacts.ts), openDb + evaluations/runs/screenshots schema (src/storage/db.ts, src/storage/schema.sql.ts)
provides:
  - "sharp@0.35.3, @axe-core/playwright@4.12.1, @earendil-works/pi-ai@0.80.3 installed as production dependencies"
  - "ScenarioSchema.expectedElements + ScenarioSchema.evaluatorWeights (optional, additive)"
  - "src/storage/evaluations.ts: insertEvaluation, updateRunComposite, linkDiffScreenshot, lookupCachedJudgeVerdict"
affects: [03-02, 03-03, 03-04, 03-05, evaluators, composite-scorer, orchestrator]

tech-stack:
  added: [sharp@0.35.3, "@axe-core/playwright@4.12.1", "@earendil-works/pi-ai@0.80.3"]
  patterns:
    - "storage functions take db: Database.Database as first param, module-level prepared-SQL string constants (src/storage/artifacts.ts style)"
    - "dropped/failed evaluator persists raw_score=NULL with a detail.reason, never silently 0"

key-files:
  created: [src/storage/evaluations.ts, tests/evaluationsPersistence.test.ts]
  modified: [package.json, package-lock.json, src/specs/schema.ts, tests/specs.test.ts]

key-decisions:
  - "Pinned sharp/@axe-core/playwright/@earendil-works/pi-ai to exact versions (no ^ range) in package.json, matching the existing pin convention and CLAUDE.md's explicit lockstep-pinning directive for the two Pi packages"
  - "Task 1's verify command (node -e \"require(...)\") fails against @earendil-works/pi-ai's ESM-only exports map; verified instead with node --input-type=module -e \"import ...\" which proves the same runtime-resolvable claim"

requirements-completed: [SCORE-02]

coverage:
  - id: D1
    description: "sharp, @axe-core/playwright, @earendil-works/pi-ai installed as production dependencies at pinned versions"
    requirement: "SCORE-02"
    verification:
      - kind: other
        ref: "npm ls sharp @axe-core/playwright @earendil-works/pi-ai"
        status: pass
      - kind: other
        ref: "node --input-type=module -e \"import 'sharp'; import '@axe-core/playwright'; import '@earendil-works/pi-ai'; console.log('ok')\""
        status: pass
    human_judgment: false
  - id: D2
    description: "ScenarioSchema gains optional expectedElements (string[]) and evaluatorWeights (Record<string,number>), .strict() unknown-key rejection preserved, existing fixture still parses"
    requirement: "SCORE-02"
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#ScenarioSchema expectedElements + evaluatorWeights (D3-08, D3-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "src/storage/evaluations.ts exports insertEvaluation, updateRunComposite, linkDiffScreenshot, lookupCachedJudgeVerdict against the real evaluations/runs/screenshots schema"
    requirement: "SCORE-02"
    verification:
      - kind: unit
        ref: "tests/evaluationsPersistence.test.ts (6 tests, real temp-file better-sqlite3 DB)"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-02
status: complete
---

# Phase 3 Plan 1: Evaluation Pipeline Groundwork Summary

**Three new production dependencies installed, ScenarioSchema extended with expectedElements/evaluatorWeights, and a src/storage/evaluations.ts module exposing insertEvaluation/updateRunComposite/linkDiffScreenshot/lookupCachedJudgeVerdict against the already-locked evaluations/runs/screenshots schema — no migration needed.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-02T16:29:00Z
- **Completed:** 2026-07-02T16:34:34Z
- **Tasks:** 3
- **Files modified:** 6 (package.json, package-lock.json, src/specs/schema.ts, tests/specs.test.ts, src/storage/evaluations.ts, tests/evaluationsPersistence.test.ts)

## Accomplishments
- `sharp`, `@axe-core/playwright`, `@earendil-works/pi-ai` installed as production dependencies, exact-pinned to match the project's existing convention
- `ScenarioSchema` extended with optional `expectedElements: string[]` and `evaluatorWeights: Record<string, number>`, additive-only, `.strict()` unknown-key rejection (D-08) preserved and regression-tested
- `src/storage/evaluations.ts` created with four exported functions, each unit-tested against a real temp-file `better-sqlite3` DB following the `tests/storagePort.test.ts` tmp-dir pattern: `insertEvaluation` (nullable raw_score so a dropped evaluator is never silently 0, D3-04), `updateRunComposite` (writes composite score + weights onto an existing runs row, D-21), `linkDiffScreenshot` (reuses `writeArtifact`, links a `screenshots` row with `role='diff'`, D-25/D3-07), `lookupCachedJudgeVerdict` (SELECTs the most recent non-null-score judge row by `json_extract(detail,'$.fingerprint')`, D3-14)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install sharp, @axe-core/playwright, @earendil-works/pi-ai as production dependencies** - `4b5be24` (feat)
2. **Task 2: Extend ScenarioSchema with expectedElements + evaluatorWeights (D3-08, D3-02)** - `c430941` (test, RED) → `dad2950` (feat, GREEN)
3. **Task 3: Storage functions for evaluations, composite, diff-screenshot linking, and judge-cache lookup (D-20, D-21, D3-07, D3-14)** - `f6bf338` (test, RED) → `a32ff0c` (feat, GREEN)

**Plan metadata:** committed separately after this summary.

_TDD tasks (2 and 3) each have a test → feat commit pair; no refactor step was needed._

## Files Created/Modified
- `package.json` / `package-lock.json` - added `sharp@0.35.3`, `@axe-core/playwright@4.12.1`, `@earendil-works/pi-ai@0.80.3` to `dependencies`, exact-pinned
- `src/specs/schema.ts` - `ScenarioSchema` gains optional `expectedElements`/`evaluatorWeights` fields
- `tests/specs.test.ts` - four new `ScenarioSchema` behavior cases
- `src/storage/evaluations.ts` - `insertEvaluation`, `updateRunComposite`, `linkDiffScreenshot`, `lookupCachedJudgeVerdict`
- `tests/evaluationsPersistence.test.ts` - six tests against a real temp-file `better-sqlite3` DB

## Decisions Made
- Pinned all three new dependencies to exact versions (no `^` range) rather than accepting `npm install`'s default caret ranges, matching every other entry in `package.json` and CLAUDE.md's explicit "pin exact versions (fast-moving)" directive for the two Pi packages.
- No `.refine()` was added requiring `evaluatorWeights` to sum to 1 — `composeScore` (03-02) renormalizes regardless, per the plan's own instruction.
- No cross-validation of `evaluatorWeights` keys against known evaluator names in `schema.ts` — keeps `src/specs/schema.ts` free of any import from `src/eval/` (one-directional coupling preserved).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's literal verify command fails against @earendil-works/pi-ai's ESM-only export map**
- **Found during:** Task 1 (dependency install)
- **Issue:** The plan's `<verify>` command is `node -e "require('sharp'); require('@axe-core/playwright'); require('@earendil-works/pi-ai'); console.log('ok')"`. `@earendil-works/pi-ai`'s installed `package.json` (`"type": "module"`, `exports` map with only an `"import"` condition, no `"require"`) throws `ERR_PACKAGE_PATH_NOT_EXPORTED` under CJS `require()` resolution — a mismatch between the plan's assumed module system and the real published package.
- **Fix:** Verified the same intent (all three packages resolve and load) with `node --input-type=module -e "import 'sharp'; import '@axe-core/playwright'; import '@earendil-works/pi-ai'; console.log('ok')"`, which succeeds. The project itself is `"type": "module"`, so real `import` usage from `src/` is unaffected either way — this only corrects the standalone smoke-test invocation.
- **Files modified:** none (verification-only correction)
- **Verification:** `node --input-type=module -e "..."` printed `ok`; `npm ls sharp @axe-core/playwright @earendil-works/pi-ai` shows all three at pinned versions with no `UNMET DEPENDENCY`
- **Committed in:** n/a (no code change, verification step only)

**2. [Rule 2 - Missing Critical] npm's default caret ranges override the project's exact-pin convention**
- **Found during:** Task 1 (dependency install)
- **Issue:** `npm install <pkg>@<version>` wrote `^4.12.1`/`^0.80.3`/`^0.35.3` into `package.json` `dependencies` by default, diverging from every other pinned entry (`better-sqlite3`, `playwright`, `pixelmatch`, etc. all have no `^`) and from CLAUDE.md's explicit "Pin exact versions (fast-moving)" instruction for the two `@earendil-works/*` packages specifically.
- **Fix:** Edited `package.json` to strip the `^` prefix on all three new entries, then re-ran `npm install` (no version args) to sync `package-lock.json` to the exact pins with no version changes.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npm ls sharp @axe-core/playwright @earendil-works/pi-ai` still resolves the same three pinned versions; `package-lock.json` root `dependencies` block shows exact version strings, no `^`
- **Committed in:** `4b5be24` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking verify-command mismatch, 1 missing-critical convention enforcement)
**Impact on plan:** Both auto-fixes are corrections to how Task 1 was executed, not scope changes — no new files, no architectural change. No scope creep.

## Issues Encountered
None beyond the two deviations above.

## Next Phase Readiness
- Every downstream Phase 3 plan (pixelmatch/judge/dom/axe evaluators, the composite scorer, the orchestrator) can now `import sharp`, `import { AxeBuilder } from "@axe-core/playwright"`, `import ... from "@earendil-works/pi-ai"`, read `scenario.expectedElements`/`scenario.evaluatorWeights` off a loaded `Scenario`, and call `insertEvaluation`/`updateRunComposite`/`linkDiffScreenshot`/`lookupCachedJudgeVerdict` against a real SQLite file with no further schema or package changes.
- No blockers for 03-02 (composite scorer) or the evaluator plans.

---
*Phase: 03-evaluation-pipeline-scorer*
*Completed: 2026-07-02*
