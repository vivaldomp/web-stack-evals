---
phase: 03-evaluation-pipeline-scorer
plan: 03
subsystem: testing
tags: [pixelmatch, sharp, pngjs, pi-ai, zod, llm-judge, evaluator]

requires:
  - phase: 03-evaluation-pipeline-scorer
    provides: "EvaluatorPort/evaluations schema/fingerprint helpers from 03-01; renderWithPage + composeScore from 03-02"
provides:
  - "createPixelMatchEvaluator(): EvaluatorPort -- deterministic zero-network visual-diff sub-score"
  - "createJudgeEvaluator(models, modelSpec, lookupCachedVerdict): EvaluatorPort -- LLM-judge sub-score with fingerprint caching"
  - "tests/fixtures/eval/pngFixtures.ts -- procedural PNG generators reused by later evaluator/pipeline tests"
affects: [03-04, 03-05, 03-06]

tech-stack:
  added: []
  patterns:
    - "Unconditional sharp normalization before every pixelmatch diff (never a conditional size-mismatch branch)"
    - "Judge evaluator is the sole production import site for @earendil-works/pi-ai; fauxProvider() keeps its tests network-free"
    - "Fingerprint cache check happens before context construction -- a cache hit never builds a prompt or touches the model"

key-files:
  created:
    - src/eval/pixelmatchEvaluator.ts
    - src/eval/judgeEvaluator.ts
    - tests/fixtures/eval/pngFixtures.ts
    - tests/pixelmatchEvaluator.test.ts
    - tests/judgeEvaluator.test.ts
    - tests/judgeEvaluator.live.test.ts
  modified:
    - vitest.config.ts
    - vitest.integration.config.ts

key-decisions:
  - "vitest.config.ts/vitest.integration.config.ts include/exclude globs extended with tests/**/*.live.test.ts so the gated live judge test is reachable only via the integration config and never runs under the default/CI suite"

patterns-established:
  - "Live/paid-API integration tests use a *.live.test.ts suffix, parallel to *.integration.test.ts and *.selftest.test.ts, and are excluded from the default vitest run"

requirements-completed: [EVAL-01, EVAL-04]

coverage:
  - id: D1
    description: "createPixelMatchEvaluator(): identical images score 1.0, dimension-mismatched pairs never throw (sharp normalization), degraded pairs score well below matched pairs, diff PNG always produced"
    requirement: "EVAL-01"
    verification:
      - kind: unit
        ref: "tests/pixelmatchEvaluator.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "createJudgeEvaluator(): valid submit_verdict call scores mean-of-three with rationale; out-of-range dimension rejected via VerdictSchema; plain-text-only responses drop after MAX_RETRIES without throwing; fingerprint cache hit skips the model call; construction throws synchronously for a supportsTemperature:false model"
    requirement: "EVAL-04"
    verification:
      - kind: unit
        ref: "tests/judgeEvaluator.test.ts (5 fauxProvider()-scripted cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "tests/judgeEvaluator.live.test.ts exists, skipIf-gated, and skips (not fails) under vitest.integration.config.ts without ANTHROPIC_API_KEY"
    verification:
      - kind: integration
        ref: "npx vitest run --config vitest.integration.config.ts tests/judgeEvaluator.live.test.ts (1 skipped)"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-07-02
status: complete
---

# Phase 3 Plan 3: PNG-Bytes-Only Evaluators (PixelMatch + Judge) Summary

**PixelMatch evaluator with unconditional sharp normalization, plus an LLM judge evaluator that tool-calls submit_verdict over pi-ai, zod-validated and fingerprint-cached, with a fauxProvider()-tested retry/drop path**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-02T16:56:58Z (first task commit)
- **Completed:** 2026-07-02T17:02:01Z
- **Tasks:** 2 completed (both TDD: RED -> GREEN)
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments

- `createPixelMatchEvaluator()` unconditionally resizes both PNGs to the stack viewport via sharp before every diff (Pitfall 1), diffs with pixelmatch using the repo's existing `{threshold: 0.1, includeAA: false}` convention, and always returns a non-empty `detail.diffPng` buffer (D3-07).
- `tests/fixtures/eval/pngFixtures.ts` generates three deliberately differently-sized PNGs (expected/near-match/degraded) purely with pngjs -- no checked-in binary art.
- `createJudgeEvaluator()` is the sole production file (besides its own tests) importing `@earendil-works/pi-ai`. It checks a fingerprint cache before building any prompt (D3-14), sends only two images plus fixed rubric text (D3-12, never the scenario prompt/code/DOM), requires a `submit_verdict` tool call validated by a zod `min(0).max(1)` bound-checked `VerdictSchema` (D3-13), retries up to `MAX_RETRIES=2` times with backoff on a missing/invalid tool call, and returns `{rawScore: 0, detail: {dropped: true, reason}}` on exhaustion -- never throwing (Pitfall 4).
- Construction-time guard: a model whose catalog `compat.supportsTemperature === false` (verified against the real `claude-opus-4-7` entry in the installed `@earendil-works/pi-ai` catalog) throws synchronously instead of making a doomed API call (Pitfall 3).
- All 5 judge behaviors and all 4 pixelmatch behaviors pass via `fauxProvider()`/procedural fixtures with zero network calls; the optional live proof (`tests/judgeEvaluator.live.test.ts`) is `skipIf(!ANTHROPIC_API_KEY)`-gated and verified to report "skipped" (not "failed" or "no test files found") under `vitest.integration.config.ts`.

## Task Commits

Each task followed TDD (RED -> GREEN):

1. **Task 1: PixelMatch evaluator with sharp normalization**
   - `847bb01` test(03-03): add failing test for pixelmatch evaluator
   - `b023a81` feat(03-03): implement pixelmatch evaluator with sharp normalization
2. **Task 2: LLM judge evaluator via pi-ai tool-calling**
   - `105ed3e` test(03-03): add failing test for judge evaluator
   - `a742f8f` feat(03-03): implement judge evaluator via pi-ai tool-calling (includes the vitest config fix, see Deviations)

## Files Created/Modified

- `src/eval/pixelmatchEvaluator.ts` - `createPixelMatchEvaluator(): EvaluatorPort`, `PixelMatchInput`
- `tests/fixtures/eval/pngFixtures.ts` - `makeExpectedPng`, `makeGeneratedMatchPng`, `makeGeneratedDegradedPng`
- `tests/pixelmatchEvaluator.test.ts` - 4 behavior cases
- `src/eval/judgeEvaluator.ts` - `createJudgeEvaluator`, `DEFAULT_JUDGE_MODEL`, `JudgeModelSpec`, `JudgeInput`, `RUBRIC_VERSION`
- `tests/judgeEvaluator.test.ts` - 5 fauxProvider()-scripted behavior cases
- `tests/judgeEvaluator.live.test.ts` - skipIf-gated real-model proof
- `vitest.config.ts` - excludes `*.live.test.ts` from the default/CI suite
- `vitest.integration.config.ts` - includes `*.live.test.ts` so the gated live test is reachable

## Decisions Made

- Retry backoff in `judgeEvaluator.ts` is a small fixed `RETRY_BACKOFF_MS=50` scaled by attempt number, not the full production backoff curve one might use against a real API -- kept short so the faux-provider test suite runs fast; the constant is trivially retunable later without touching call sites.
- `createJudgeEvaluator`'s construction-time `compat.supportsTemperature` check is read via a narrow local cast (`{ supportsTemperature?: boolean } | undefined`) rather than threading `hasApi()`-based API-specific narrowing through, since the check only needs the one optional field and works identically across every `Model<Api>` variant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] vitest include/exclude globs did not recognize `*.live.test.ts`, so the plan's own verification step failed**
- **Found during:** Task 2, verifying `tests/judgeEvaluator.live.test.ts` per the plan's `<done>` criterion
- **Issue:** `vitest.integration.config.ts`'s `include` only listed `tests/**/*.integration.test.ts` and `tests/**/*.selftest.test.ts`. Running `npx vitest run --config vitest.integration.config.ts tests/judgeEvaluator.live.test.ts` reported **"No test files found, exiting with code 1"** instead of the plan-mandated "skipped, not failed" result. Separately, `vitest.config.ts`'s default `exclude` also didn't list `*.live.test.ts`, meaning a bare `npm test` would have picked up the live test file (harmless while `skipIf` gates it, but inconsistent with how `*.integration.test.ts`/`*.selftest.test.ts` are kept out of the default run).
- **Fix:** Added `"tests/**/*.live.test.ts"` to `vitest.integration.config.ts`'s `include` array and to `vitest.config.ts`'s `exclude` array, mirroring the existing two-suffix pattern.
- **Files modified:** `vitest.config.ts`, `vitest.integration.config.ts`
- **Verification:** `./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/judgeEvaluator.live.test.ts` now reports `1 skipped`; `./node_modules/.bin/vitest run tests/judgeEvaluator.live.test.ts` (default config) now reports `No test files found` (correctly excluded); full default suite (`./node_modules/.bin/vitest run`) still green at 14 files / 74 tests.
- **Committed in:** `a742f8f` (part of Task 2's feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking issue)
**Impact on plan:** Necessary to make the plan's own stated verification command produce its stated expected result. No scope creep -- both config files already existed from Phase 2 and needed exactly one line each.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required. The live judge test needs `ANTHROPIC_API_KEY` to actually exercise the real model, but it is optional and skips cleanly without it (as designed).

## Next Phase Readiness

`createPixelMatchEvaluator()` and `createJudgeEvaluator()` both satisfy `EvaluatorPort` with zero further changes expected, ready for `registry.ts` (03-06-PLAN.md) to compose alongside the remaining DOM/axe evaluators (03-04) and the orchestrating `evaluateRun` (03-05). No blockers.

---
*Phase: 03-evaluation-pipeline-scorer*
*Completed: 2026-07-02*
