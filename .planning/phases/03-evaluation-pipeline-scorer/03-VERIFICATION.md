---
phase: 03-evaluation-pipeline-scorer
verified: 2026-07-02T17:40:00Z
status: passed
score: 5/5 roadmap truths verified (33/33 plan-level must-haves verified across 7 plans)
behavior_unverified: 0
overrides_applied: 0
---

# Phase 3: Evaluation Pipeline & Scorer Verification Report

**Phase Goal:** Given an expected/generated screenshot pair (plus rendered DOM), the platform computes all four evaluator sub-scores and a normalized composite — deterministically, with no LLM agent in the loop. Checkpoint: full pipeline green without the agent.
**Verified:** 2026-07-02T17:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Feeding a matched expected/generated pair through the pipeline yields four sub-scores: PixelMatch %, DOM structural presence, axe-core accessibility, LLM-judge verdict | ✓ VERIFIED | `tests/evalPipeline.integration.test.ts` runs the real `renderWithPage()` → `buildRegistry()` → `evaluateRun()` chain with zero mocks (only the judge's model transport uses pi-ai's own `fauxProvider()` test double, per plan design) and asserts exactly 4 `evaluations` rows named `axe`, `dom`, `judge`, `pixelmatch`, each `raw_score` in `[0,1]`. Ran it live: `PASS` in 1556ms. |
| 2 | A new evaluator can be registered through the `Evaluator`/`EvaluatorPort` interface + registry without editing orchestrator/core code | ✓ VERIFIED | `src/core/ports.ts` `EvaluatorPort` (2-field seam) unchanged since Phase 2 (`git diff fa8765f^ HEAD -- src/core/ports.ts` is empty). `src/eval/registry.ts` contains exactly one `if` (D3-09's dom-inclusion guard); `src/pipeline/evaluate.ts` loops generically over `input.registry` with only one evaluator-name-keyed branch (`pixelmatch`'s diff-image persistence, explicitly justified in the plan as keyed to that evaluator's own output shape, not a structural requirement). |
| 3 | The LLM judge runs against an independent model family at temp=0 with images-only input and returns a structured rubric verdict | ✓ VERIFIED | `src/eval/judgeEvaluator.ts`: `DEFAULT_JUDGE_MODEL = {provider:"anthropic", modelId:"claude-sonnet-5"}` (independent from the DeepSeek-4-Pro agent under test); `models.complete(model, context, {temperature: 0})`; the `Context.messages` user content is exactly two `{type:"image",...}` blocks plus minimal framing text — no prompt/code/DOM; `VerdictSchema` (zod, `.min(0).max(1)` bounds) validates the `submit_verdict` tool-call before trusting it, with retry-then-drop on failure. `tests/judgeEvaluator.test.ts` (fauxProvider, zero network) covers all 5 behavior cases; `tests/judgeEvaluator.live.test.ts` is `skipIf`-gated and confirmed to report `skipped` (not failed) without `ANTHROPIC_API_KEY`. |
| 4 | Each run persists raw sub-scores separately from the normalized composite score | ✓ VERIFIED | `src/storage/evaluations.ts`: `insertEvaluation` writes one `evaluations` row per evaluator (raw, nullable score); `updateRunComposite` writes `runs.composite_score`/`composite_weights` as a separate, later write. `tests/evalPipeline.integration.test.ts` asserts both: 4 raw rows queried from `evaluations`, and a distinct `runs.composite_score`/`composite_weights` row whose weights JSON-sum to 1. |
| 5 | The full evaluation pipeline runs green end-to-end on fixture screenshots with no agent present | ✓ VERIFIED | `tests/evalPipeline.integration.test.ts` imports no `runStack.ts`, no Pi SDK, starts no dev server — only `renderWithPage`, `buildRegistry`, `evaluateRun`. Ran live via `npx vitest run --config vitest.integration.config.ts`: **PASS**. |

**Score:** 5/5 roadmap truths verified.

### Plan-Level Must-Haves (cross-checked against source, not SUMMARY claims)

| Plan | Must-have truth | Status | Evidence |
|------|------------------|--------|----------|
| 03-01 | `ScenarioSchema` gains optional `expectedElements`/`evaluatorWeights`, `.strict()` preserved | ✓ VERIFIED | `src/specs/schema.ts` lines 38-50: both fields `.optional()`, `z.strictObject({...})` unchanged shape |
| 03-01 | Dropped evaluator's reason persists as its own row, `raw_score` never silently 0 | ✓ VERIFIED | `insertEvaluation(db, ..., rawScore: number \| null, ...)` — nullable param, verified via `tests/evaluationsPersistence.test.ts` |
| 03-01 | Composite + weights written onto `runs` row independent of/after raw rows | ✓ VERIFIED | `updateRunComposite` is a separate `UPDATE runs SET composite_score=..., composite_weights=...` |
| 03-01 | Identical-fingerprint judge verdict lookup, no new table | ✓ VERIFIED | `lookupCachedJudgeVerdict` — `SELECT ... FROM evaluations WHERE evaluator_name='judge' ... json_extract(detail,'$.fingerprint')` |
| 03-02 | `renderWithPage` yields screenshot + live page that stays open until caller closes | ✓ VERIFIED | `renderWithPage.ts` returns `{page, close}` without closing browser/context on the success path; `tests/renderWithPage.integration.test.ts` (real Chromium) confirms `page.isClosed()===false` after return, `true` after `close()` — both ran live and passed |
| 03-02 | `core/ports.ts` never modified | ✓ VERIFIED | `git diff` empty for that file across all Phase-3 commits |
| 03-02 | Composite is weighted mean of survivors, renormalized | ✓ VERIFIED | `composite.ts` — `survivorWeightSum` renormalization logic; `tests/composite.test.ts` (68 lines, 4 behavior cases) |
| 03-02 | All-dropped → composite `null`, never 0/NaN | ✓ VERIFIED | Explicit `if (survivors.length === 0) return {compositeScore: null, weightsUsed: {}}` short-circuit before any division |
| 03-03 | Identical images score 1.0; degraded content scores meaningfully lower | ✓ VERIFIED | `pixelmatchEvaluator.ts` computes `1 - mismatchedPixels/totalPixels`; `tests/pixelmatchEvaluator.test.ts` (75 lines) covers both cases against procedurally generated PNGs |
| 03-03 | Dimension mismatch never throws — normalized before diffing | ✓ VERIFIED | `normalizeToViewport` unconditionally resizes both buffers via `sharp(...).resize(...,{fit:"fill"})` before `pixelmatch` ever sees them |
| 03-03 | Diff image always produced | ✓ VERIFIED | `detail.diffPng: PNG.sync.write(diff)` on every return path |
| 03-03 | Judge sees only two images + fixed rubric, no prompt/code/DOM | ✓ VERIFIED | `context.messages[0].content` is exactly `[text, image, text, image]` — no scenario prompt, no code, no DOM string anywhere in the payload |
| 03-03 | Judge tool-call zod-validated, malformed/missing retried then dropped | ✓ VERIFIED | `VerdictSchema.parse(toolCall.arguments)` inside try/catch with `MAX_RETRIES=2` loop; final fallthrough returns `detail.dropped=true` |
| 03-03 | Identical fingerprint hits cache, skips second model call | ✓ VERIFIED | `lookupCachedVerdict(fingerprint)` checked before any `models.complete` call, returns early on hit |
| 03-04 | DOM structural presence is a gradient, runs against rendered DOM | ✓ VERIFIED | `domEvaluator.ts` — `rawScore: found/expectedElements.length`, uses `page.locator(selector).count()` against the live page |
| 03-04 | Axe scoring starts at 1.0, subtracts severity-weighted per-node penalty, floored at 0 | ✓ VERIFIED | `axeEvaluator.ts` — `IMPACT_PENALTY` table, `penalty += weight * violation.nodes.length` (per-node), `Math.max(0, 1-penalty)` |
| 03-04 | Both evaluators consume an already-open page, never navigate/manage lifecycle | ✓ VERIFIED | Neither file imports `chromium`/calls `.goto`/`.close` — only reads `page` from `rawInput` |
| 03-05 | Every evaluator runs the same shared input, no per-name special-casing of input | ✓ VERIFIED | `evaluate.ts` builds one `sharedInput` object once, passed identically to every `evaluator.evaluate(sharedInput)` call |
| 03-05 | Dropped evaluator's reason persisted, `raw_score` NULL never 0 | ✓ VERIFIED | `insertEvaluation(..., null, result.detail)` on the `dropped===true` branch |
| 03-05 | Diff image persisted by orchestrator, not evaluator | ✓ VERIFIED | `evaluate.ts`'s `linkDiffScreenshot` call sits in the orchestrator loop, keyed on `evaluator.name === "pixelmatch"` — the evaluator itself does zero storage I/O |
| 03-05 | Composite written to `runs` only when ≥1 evaluator survived | ✓ VERIFIED | `if (compositeScore !== null) { updateRunComposite(...) }` — skipped entirely otherwise |
| 03-06 | pixelmatch/axe/judge always run unconditionally | ✓ VERIFIED | `registry.ts` — all three constructed unconditionally in the `evaluators` array literal |
| 03-06 | DOM evaluator included only when `expectedElements` non-empty | ✓ VERIFIED | The one `if (deps.expectedElements && deps.expectedElements.length > 0)` guard |
| 03-06 | Adding a 5th evaluator needs only registry.ts edit | ✓ VERIFIED | `evaluate.ts` has zero import of `registry.ts` or any concrete evaluator module (confirmed by reading the file's imports) |
| 03-07 | Real end-to-end pipeline test, no agent, no mocks besides judge transport | ✓ VERIFIED | `tests/evalPipeline.integration.test.ts` read in full — matches this description exactly; ran live and passed |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/storage/evaluations.ts` | 4 exported functions | ✓ VERIFIED | `insertEvaluation`, `updateRunComposite`, `linkDiffScreenshot`, `lookupCachedJudgeVerdict` all present, substantive, bound-param SQL |
| `src/specs/schema.ts` | `expectedElements`/`evaluatorWeights` optional fields | ✓ VERIFIED | Present, `.optional()`, `.strict()` preserved |
| `package.json` deps | `sharp@0.35.3`, `@axe-core/playwright@4.12.1`, `@earendil-works/pi-ai@0.80.3` | ✓ VERIFIED | All three present in `dependencies` at pinned versions |
| `src/render/renderWithPage.ts` | `renderWithPage(input) -> LiveRenderResult` | ✓ VERIFIED | Present, substantive, real Chromium integration test passes |
| `src/pipeline/composite.ts` | `composeScore`, `DEFAULT_EVALUATOR_WEIGHTS`, `EvaluatorOutcome` | ✓ VERIFIED | Present, pure function, no I/O imports |
| `src/eval/pixelmatchEvaluator.ts` | `createPixelMatchEvaluator(): EvaluatorPort` | ✓ VERIFIED | Present, substantive |
| `src/eval/judgeEvaluator.ts` | `createJudgeEvaluator(...)`, `DEFAULT_JUDGE_MODEL` | ✓ VERIFIED | Present, substantive |
| `tests/fixtures/eval/pngFixtures.ts` | procedural PNG generators | ✓ VERIFIED | No checked-in binary art; PNG built via `pngjs` |
| `src/eval/domEvaluator.ts` | `createDomEvaluator(expectedElements): EvaluatorPort` | ✓ VERIFIED | Present, substantive |
| `src/eval/axeEvaluator.ts` | `createAxeEvaluator(): EvaluatorPort` | ✓ VERIFIED | Present, substantive |
| `tests/fixtures/eval/app.html`, `app-clean.html` | shared fixtures | ✓ VERIFIED | Both present, correct element/violation shape |
| `src/pipeline/evaluate.ts` | `evaluateRun(input): Promise<EvaluateRunResult>` | ✓ VERIFIED | Present, substantive, generic loop |
| `src/eval/registry.ts` | `buildRegistry(deps): EvaluatorPort[]` | ✓ VERIFIED | Present, substantive |
| `tests/evalPipeline.integration.test.ts` | ROADMAP SC5 proof | ✓ VERIFIED | Present, real no-mock wiring, passes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `insertEvaluation` | `evaluations` table | bound-param INSERT | ✓ WIRED | Confirmed in source + `tests/evaluationsPersistence.test.ts` |
| `updateRunComposite` | `runs.composite_score`/`composite_weights` | bound-param UPDATE | ✓ WIRED | Confirmed |
| `linkDiffScreenshot` | `artifacts`+`screenshots` rows | reuses `writeArtifact` | ✓ WIRED | Confirmed, no duplicated mkdir/write logic |
| `renderWithPage` | `domEvaluator`/`axeEvaluator` | shared live `page` | ✓ WIRED | Proven in `evalPipeline.integration.test.ts` — one render, both evaluators, one close |
| `composeScore` | `evaluateRun` | direct import | ✓ WIRED | `evaluate.ts` imports and calls `composeScore` |
| `createPixelMatchEvaluator`/`createJudgeEvaluator` | `registry.ts` | direct import | ✓ WIRED | Confirmed |
| `createDomEvaluator`/`createAxeEvaluator` | `registry.ts` | direct import | ✓ WIRED | Confirmed |
| `buildRegistry`'s judge wiring | `lookupCachedJudgeVerdict` | closure over caller's `db` | ✓ WIRED | `(fingerprint) => Promise.resolve(lookupCachedJudgeVerdict(deps.db, fingerprint))` |
| `evaluateRun` | `insertEvaluation`/`linkDiffScreenshot`/`updateRunComposite` | direct import | ✓ WIRED | Confirmed |

### Behavioral Spot-Checks / Test Execution (real runs, not SUMMARY claims)

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Full unit suite | `npx vitest run` (Node 24.13.1) | `PASS (82) FAIL (0)` | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | `No errors found` | ✓ PASS |
| Integration: renderWithPage (3 cases) | `npx vitest run --config vitest.integration.config.ts tests/renderWithPage.integration.test.ts` (Node 24.18.0) | 3/3 passed, real Chromium | ✓ PASS |
| Integration: domEvaluator (2 cases) | same config | 2/2 passed, real Chromium `file://` | ✓ PASS |
| Integration: axeEvaluator (3 cases) | same config | 3/3 passed, real Chromium + real axe-core | ✓ PASS |
| Integration: evalPipeline (SC1/SC4/SC5 proof) | same config | 1/1 passed | ✓ PASS |
| Integration: judgeEvaluator.live (gated) | same config | `skipped` (no `ANTHROPIC_API_KEY`) — correct, not failed | ✓ PASS (skip is expected) |

**Full integration run result:** `Test Files 2 failed \| 6 passed \| 1 skipped (9)` / `Tests 5 failed \| 15 passed \| 1 skipped (21)`. All 5 failures are in **`tests/runStack.integration.test.ts`** and **`tests/isolation.selftest.test.ts`** — Phase 2 files (`build_failed` on the real-Angular-template happy path), zero overlap with any file this phase modified. See Anti-Patterns/Notes below — this is flagged as informational, not a Phase 3 gap.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EVAL-01 | 03-03 | PixelMatch visual-similarity score | ✓ SATISFIED | `pixelmatchEvaluator.ts` + tests |
| EVAL-02 | 03-04 | DOM Diff structural-presence checks | ✓ SATISFIED | `domEvaluator.ts` + tests |
| EVAL-03 | 03-04 | Accessibility eval via axe-core | ✓ SATISFIED | `axeEvaluator.ts` + tests |
| EVAL-04 | 03-03 | LLM Judge, independent model, temp=0, images-only | ✓ SATISFIED | `judgeEvaluator.ts` + tests |
| EVAL-05 | 03-06 | All evaluators behind one interface + registry | ✓ SATISFIED | `registry.ts`, `core/ports.ts` untouched |
| SCORE-01 | 03-02 | Composite score from evaluator sub-scores | ✓ SATISFIED | `composite.ts` |
| SCORE-02 | 03-01, 03-05 | Raw sub-scores persisted separately from composite | ✓ SATISFIED | `evaluations.ts`, `evaluate.ts` |

No orphaned requirements — every ID mapped to Phase 3 in `.planning/REQUIREMENTS.md`'s traceability table appears in at least one plan's `requirements:` frontmatter, and every plan's declared requirement appears in REQUIREMENTS.md.

### Anti-Patterns Found

None. Scanned all 10 Phase-3-authored/modified production files (`src/eval/*.ts`, `src/pipeline/composite.ts`, `src/pipeline/evaluate.ts`, `src/render/renderWithPage.ts`, `src/storage/evaluations.ts`, `src/specs/schema.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" — zero matches.

### Notes (informational, non-blocking)

- **Phase 2 regression signal (out of Phase-3 scope):** `tests/runStack.integration.test.ts`'s "real Angular template, happy path" suite and `tests/isolation.selftest.test.ts` fail with `build_failed` in this environment even on the mandated Node 24.18.0, contradicting the task brief's claimed final-gate state ("full integration tier 20 passed + 1 skipped"). These tests build a real, separate Angular template project (`stacks/angular.yaml`) — a Phase 2 concern (WORK-02/BUILD-01..04) with zero file overlap with anything this phase touched, and `git log` confirms no Phase 3 commit modified `runStack.ts`, `isolation.selftest.test.ts`, or any Angular stack file. Not treated as a Phase 3 gap. Worth a human/maintainer look before shipping Phase 2's own claims, but it does not block Phase 3's goal.

### Human Verification Required

None. Phase 3's goal is a deterministic, agent-free scoring pipeline — fully provable by automated tests, which were run live (not taken on SUMMARY's word) and passed.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria and all 33 plan-level must-haves across the 7 plans are verified against actual source code and real (not mocked, not merely structural) test execution, including one genuine no-mock end-to-end integration test (`tests/evalPipeline.integration.test.ts`) that independently proves SC1, SC4, and SC5 together. `core/ports.ts` is confirmed untouched via `git diff` across every Phase 3 commit, satisfying SC2/D-23/D3-15's "no core edit" constraint. All requirement IDs (EVAL-01..05, SCORE-01/02) are traced and satisfied with no orphans.

---

_Verified: 2026-07-02T17:40:00Z_
_Verifier: Claude (gsd-verifier)_
