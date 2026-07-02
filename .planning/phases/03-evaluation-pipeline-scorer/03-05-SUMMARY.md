---
phase: 03-evaluation-pipeline-scorer
plan: 05
subsystem: evaluation-orchestration
tags: [evaluate-run, evaluator-registry, composite-score, evaluations-persistence]
status: complete
dependency-graph:
  requires: ["03-01", "03-02"]
  provides: ["evaluateRun"]
  affects: ["03-06", "03-07"]
tech-stack:
  added: []
  patterns:
    - "registry-driven orchestration loop over EvaluatorPort[] with zero per-evaluator special-casing of the INPUT"
    - "real temp-file better-sqlite3 test setup (mkdtempSync/openDb/afterEach rmSync), no mocked DB"
key-files:
  created:
    - src/pipeline/evaluate.ts
    - tests/evaluateRun.test.ts
  modified: []
decisions:
  - "evaluateRun's one evaluator-specific branch (pixelmatch diffPng -> screenshots.role='diff') is keyed to that evaluator's own documented OUTPUT shape, not a structural contract every future evaluator must satisfy -- satisfies D3-15/D3-07 simultaneously"
  - "linkDiffScreenshot is called with no resultsRoot override (per plan's exact 4-arg call), so it writes through writeArtifact's default 'results' dir under cwd -- tests clean this up in afterEach since EvaluateRunInput has no resultsRoot field to inject a tmp dir"
metrics:
  duration: 12min
  completed: 2026-07-02
---

# Phase 3 Plan 05: evaluateRun orchestrator Summary

Implemented `evaluateRun()` — the single function that drives an injected `EvaluatorPort[]` registry over one shared input and persists N `evaluations` rows plus one composite score onto the `runs` row, proven by construction (via three fake evaluators) to have zero per-evaluator-name special-casing of what it hands each evaluator to evaluate.

## What Was Built

`src/pipeline/evaluate.ts` exports `evaluateRun(input: EvaluateRunInput): Promise<EvaluateRunResult>`:

- Builds one shared `{expectedPng, generatedPng, viewport, page}` object and passes the identical object to every registry entry's `evaluate()`.
- Classifies each result by `detail.dropped === true`: dropped outcomes call `insertEvaluation(..., null, detail)` (raw_score stays NULL, reason preserved); survivors call `insertEvaluation(..., rawScore, detail)`.
- The one evaluator-specific branch: a survivor named exactly `"pixelmatch"` with `detail.diffPng` present triggers `linkDiffScreenshot(...)`, writing a `screenshots.role='diff'` row. No other evaluator name can trigger this.
- Calls `composeScore(outcomes, defaultWeights ?? DEFAULT_EVALUATOR_WEIGHTS)`; only calls `updateRunComposite(...)` when `compositeScore !== null`, otherwise skips the write entirely (never overwrites `runs.composite_score` with `null`/`0`).
- Returns `{ compositeScore, weightsUsed, outcomes }`.

`tests/evaluateRun.test.ts` covers all five `<behavior>` cases from the plan against a real temp-file SQLite DB, using only fake `EvaluatorPort` stand-ins (`fakeA`/`fakeB`/`fakeDropped`, plus a `pixelmatch`-named fake for the diff-linking test). No real evaluator module or Playwright import anywhere in the test file.

## TDD Gate Compliance

- RED: `80ff753` — `test(03-05): add failing test for evaluateRun registry-driven persistence` (failed with "Cannot find module '../src/pipeline/evaluate.js'" before implementation existed).
- GREEN: `ea92824` — `feat(03-05): implement evaluateRun registry-driven orchestrator` (all 4 test cases pass; full suite 78/78 green).
- No REFACTOR commit needed — implementation matched the plan's `<action>` on first pass.

## Deviations from Plan

None — plan executed exactly as written. One clarification worth noting: the plan's `EvaluateRunInput` interface has no `resultsRoot` field, so `linkDiffScreenshot` is called with its default `resultsRoot` (`"results"` under cwd, per `writeArtifact`'s existing default). The test file's `afterEach` cleans up the resulting `results/run-1/` directory (gitignored) so test runs don't leave droppings in the working tree. This matches the plan's exact 4-argument `linkDiffScreenshot` call in `<action>` — no extra param was added to `evaluate.ts` for testability, since the plan didn't request one and 03-07's real-pipeline caller will own the actual results root via its own call site.

## Self-Check: PASSED

- `src/pipeline/evaluate.ts` exists and exports `evaluateRun`, `EvaluateRunInput`, `EvaluateRunResult`.
- `tests/evaluateRun.test.ts` exists, 4/4 tests pass.
- Commit `80ff753` found in `git log`.
- Commit `ea92824` found in `git log`.
- `npx tsc --noEmit`: no errors.
- Full suite: `npx vitest run` → 78/78 passing.
- Grep confirms `src/pipeline/evaluate.ts` has no import of `../eval/registry.js`, any concrete evaluator module, or `"playwright"`.
