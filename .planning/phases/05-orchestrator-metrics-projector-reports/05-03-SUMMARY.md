---
phase: 05-orchestrator-metrics-projector-reports
plan: 03
subsystem: storage
status: complete
tags: [storage, specs, run-outcome, screenshots, D5-15]
requires:
  - src/storage/evaluations.ts (updateRunComposite / linkDiffScreenshot analogs)
  - src/storage/artifacts.ts (writeArtifact / getArtifactPath)
  - src/specs/load.ts (loadModel / loadScenario)
  - src/core/events.ts (RunStatus)
provides:
  - "updateRunOutcome — sole writer of terminal runs.status/failed_stage/finished_at"
  - "linkExpectedScreenshot — sole writer of screenshots role='expected'"
  - "models/deepseek4pro.json + scenarios/dashboard/{dashboard.yaml,expected.png,mockup.png} — D5-02 flag targets"
affects:
  - 05-06 orchestrator (writes terminal outcome + reads scenarios/dashboard/mockup.png)
  - 05-04/05 projector/summary (keys off runs.status)
  - 05-06/09 report (reads back role='expected' panel)
tech-stack:
  added: []
  patterns:
    - "static SQL const + named params (no interpolation)"
    - "resultsRoot-override branch mirroring linkDiffScreenshot"
    - "production specs are byte-identical copies of proven tests/fixtures/*"
key-files:
  created:
    - tests/runOutcome.test.ts
    - tests/productionSpecs.test.ts
    - models/deepseek4pro.json
    - scenarios/dashboard/dashboard.yaml
    - scenarios/dashboard/expected.png
    - scenarios/dashboard/mockup.png
  modified:
    - src/storage/evaluations.ts
decisions:
  - "linkExpectedScreenshot uses a sibling insertExpectedScreenshotSql const (role='expected') rather than parameterizing role — leaves the existing role='diff' statement untouched per plan prohibition."
  - "RunStatus imported type-only (verbatimModuleSyntax); status/failed_stage persisted as scalar TEXT, finished_at as epoch-ms INTEGER verbatim (D-26), no JSON.stringify."
metrics:
  duration: 6min
  completed: 2026-07-03
  tasks: 3
  files: 6
---

# Phase 5 Plan 03: Wave-1 storage writers + production specs Summary

Landed the three additive, no-schema-change D5-15 resolutions the orchestrator/projector/report depend on: `updateRunOutcome` (the only writer of the terminal `runs` row after `persistManifest` seeds `'pending'`), `linkExpectedScreenshot` (the only writer of a `screenshots role='expected'` artifact), and the production `models/deepseek4pro.json` + `scenarios/dashboard/` specs (byte-identical fixture copies) so the D5-02 `--model deepseek4pro --scenario dashboard` flags resolve to real, zod-valid files.

## What was built

- **`updateRunOutcome(db, runId, status, failedStage, finishedAt)`** — static `UPDATE runs SET status/failed_stage/finished_at WHERE run_id`, named params only. Type-only `RunStatus` import. Flips a `'pending'` row to any terminal status; `completed` path stores `failed_stage=NULL`.
- **`linkExpectedScreenshot(db, runId, expectedPng, viewport, resultsRoot?)`** — mirrors `linkDiffScreenshot`: `writeArtifact(...,'screenshot','expected.png',bytes)` (with the same `resultsRoot === undefined` branch) then INSERT via a sibling `insertExpectedScreenshotSql` const hardcoding `role='expected'`. Returns the artifact id; bytes read back byte-identical via `getArtifactPath`.
- **Production specs** — `models/deepseek4pro.json`, `scenarios/dashboard/dashboard.yaml`, `scenarios/dashboard/expected.png`, `scenarios/dashboard/mockup.png` copied byte-for-byte from `tests/fixtures/*` (sha256-verified equal). The `mockup.png` is what the 05-06 orchestrator reads verbatim at `join(scenarioDir, "mockup.png")`; its absence would be harness-fatal.
- **Two RED-first unit tests** — `tests/runOutcome.test.ts` (both storage writers) and `tests/productionSpecs.test.ts` (loader resolution + png presence).

## Deviations from Plan

None — plan executed exactly as written (TDD: RED tests → GREEN impl → GREEN specs).

## Verification

- `npx vitest run tests/runOutcome.test.ts tests/productionSpecs.test.ts` → 7 pass / 0 fail.
- `npx tsc --noEmit` → No errors found (type-only import compiles under strict/verbatimModuleSyntax).
- `npx vitest run tests/importBoundary.test.ts` → 2 pass (no new Pi importer added).
- `git diff -- src/storage/schema.sql.ts` → empty (no schema change; SCHEMA_VERSION stays 1).

## Known Stubs

None. All four production data files carry real bytes from the proven fixtures; no placeholder/empty values introduced.

## Self-Check: PASSED

All 6 created files present, `src/storage/evaluations.ts` modified, and all three task commits (ca6de56, b9d6275, e906532) exist in git history.
