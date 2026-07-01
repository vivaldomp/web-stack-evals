---
phase: 01-foundations-contracts
plan: 02
subsystem: api
tags: [zod, yaml, spec-validation, config-loading]

# Dependency graph
requires:
  - phase: 01-foundations-contracts (plan 01)
    provides: TypeScript/Node project scaffold, tsconfig, vitest config, package.json with zod/yaml/better-sqlite3 pinned
provides:
  - Strict zod schemas for stack.yaml, scenario.yaml, and model config (StackSchema, ScenarioSchema, ModelSchema, ProvenanceSchema)
  - z.infer typed exports (Stack, Scenario, ModelConfig) consumed by later phases
  - loadStack/loadScenario/loadModel: parse -> safeParse -> z.prettifyError throw
  - v1-row test fixtures (Angular @ 4200, DeepSeek 4 Pro, dashboard scenario) plus one deliberately malformed stack fixture
affects: [02-workspace-runtime, 03-evaluation, 04-agent-runtime, 05-orchestrator-reports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "z.strictObject (Zod 4) for every spec schema — unknown/typo'd keys rejected, not the deprecated Zod-3 .strict() chained form"
    - "parse-then-validate loader shape: readFileSync -> YAML.parse/JSON.parse -> schema.safeParse -> z.prettifyError-embedded throw on failure, typed result.data on success"

key-files:
  created:
    - src/specs/schema.ts
    - src/specs/types.ts
    - src/specs/load.ts
    - tests/specs.test.ts
    - tests/fixtures/stacks/angular.yaml
    - tests/fixtures/stacks/angular.bad.yaml
    - tests/fixtures/scenarios/dashboard/dashboard.yaml
    - tests/fixtures/scenarios/dashboard/mockup.png
    - tests/fixtures/scenarios/dashboard/expected.png
    - tests/fixtures/models/deepseek4pro.json
  modified: []

key-decisions:
  - "angular.bad.yaml differs from angular.yaml by exactly one extra typo'd key (viewport.widht) to drive the SPEC-01 strict-rejection test"
  - "ModelSchema.params uses z.record(z.string(), z.unknown()) — declarative model params with no fixed shape, since model config is meant to be arbitrary per-provider"
  - "parseAndValidate is a small shared generic helper in load.ts so all three loaders share one parse->validate->throw code path"

patterns-established:
  - "Zod 4 z.strictObject + z.prettifyError is the canonical spec-validation shape for all future declarative config (stack/scenario/model and any later spec type)"

requirements-completed: [SPEC-01, SPEC-02, SPEC-03]

coverage:
  - id: D1
    description: "Malformed stack.yaml (unknown/typo'd key) is rejected before use, with a clear error naming the offending key and file path"
    requirement: "SPEC-01"
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#loadStack > throws naming the offending key and the file path for a malformed fixture"
        status: pass
    human_judgment: false
  - id: D2
    description: "Valid stack.yaml, scenario.yaml, and model config load into typed objects (Stack/Scenario/ModelConfig) via z.infer"
    requirement: "SPEC-02"
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#loadStack > returns a typed Stack with port 4200 for a valid fixture"
        status: pass
      - kind: unit
        ref: "tests/specs.test.ts#loadScenario > returns a Scenario with expected.provenance.source defined"
        status: pass
    human_judgment: false
  - id: D3
    description: "Model config (deepseek4pro.json) loads declaratively via loadModel with no model hardcoded in core"
    requirement: "SPEC-03"
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#loadModel > returns a ModelConfig with provider and modelId"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-01
status: complete
---

# Phase 1 Plan 2: Declarative Spec Loaders Summary

**Zod 4 `z.strictObject` schemas + parse-then-validate loaders for stack.yaml/scenario.yaml/model.json, backed by v1-row fixtures (Angular @ 4200, DeepSeek 4 Pro, dashboard) and one deliberately malformed fixture**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-01T18:34:00-03:00
- **Completed:** 2026-07-01T18:35:36-03:00
- **Tasks:** 3
- **Files modified:** 10 (6 fixtures + 4 source/test files)

## Accomplishments
- Strict zod schemas (`StackSchema`, `ScenarioSchema`, `ModelSchema`, `ProvenanceSchema`) built on the Zod 4 `z.strictObject` API — unknown/typo'd keys are rejected, not silently accepted
- `z.infer` typed exports (`Stack`, `Scenario`, `ModelConfig`) give the rest of the system typed spec objects with no hardcoded stack/model/scenario in core
- `loadStack`/`loadScenario`/`loadModel` parse-then-validate, throwing a path-prefixed `z.prettifyError` message on any invalid spec before any run can start
- v1-row test fixtures shaped to the fixed matrix row (Angular template @ port 4200, DeepSeek 4 Pro model config, "dashboard" scenario with a structured provenance block per D-09) plus one deliberately malformed stack fixture driving the strict-rejection test

## Task Commits

Each task was committed atomically:

1. **Task 1: Create v1-row spec fixtures (valid + malformed)** - `8391035` (test)
2. **Task 2: Define strict zod schemas + z.infer types** - `82f6c6e` (feat)
3. **Task 3: Implement loaders with clear validation errors** - RED `ea3c963` (test) -> GREEN `815b4c8` (feat)

**Plan metadata:** committed separately (docs)

_Note: Task 3 was TDD (`tdd="true"`) — failing test committed first, then the loader implementation making it pass. No refactor commit was needed; the implementation was already minimal and clean after GREEN._

## Files Created/Modified
- `src/specs/schema.ts` - StackSchema, ScenarioSchema, ModelSchema, ProvenanceSchema (all `z.strictObject`)
- `src/specs/types.ts` - `Stack`, `Scenario`, `ModelConfig` via `z.infer`
- `src/specs/load.ts` - `loadStack`/`loadScenario`/`loadModel`: readFileSync -> yaml/JSON parse -> safeParse -> `z.prettifyError`-embedded throw
- `tests/specs.test.ts` - covers the 4 documented behaviors (valid load x3, malformed rejection x1)
- `tests/fixtures/stacks/angular.yaml` - valid v1-row stack fixture (Angular @ 4200)
- `tests/fixtures/stacks/angular.bad.yaml` - same as angular.yaml plus one extra typo'd key (`viewport.widht`)
- `tests/fixtures/scenarios/dashboard/dashboard.yaml` - dashboard scenario with provenance block (D-09)
- `tests/fixtures/scenarios/dashboard/mockup.png` / `expected.png` - minimal valid 1x1 PNG placeholders (real bytes for future hashing)
- `tests/fixtures/models/deepseek4pro.json` - valid v1-row model config fixture (DeepSeek 4 Pro)

## Decisions Made
- `angular.bad.yaml`'s single extra key is `viewport.widht` (typo of `width`) — a realistic typo that `z.strictObject` catches at the nested viewport level, not just the top level
- `ModelSchema.params` is `z.record(z.string(), z.unknown())` since model provider params vary by provider and are not fixed by this phase's contract
- Shared `parseAndValidate<T>` helper in `load.ts` keeps the parse->validate->throw path identical across all three loaders (no per-loader duplication)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `src/specs/{schema,types,load}.ts` are ready for every later phase to resolve stack/scenario/model inputs through, with no hardcoded values in core (SC#1/#2 satisfied)
- Fixture tree mirrors the D-07 on-disk layout (`stacks/`, `scenarios/dashboard/`, `models/`) so later phases (manifest/fingerprint, workspace runtime) can point at the same fixtures
- No blockers for Plan 03 (manifest + fingerprint) or Plan 04/05 (SQLite schema, artifact store)

---
*Phase: 01-foundations-contracts*
*Completed: 2026-07-01*

## Self-Check: PASSED

All created files verified present on disk; all task commit hashes (8391035, 82f6c6e, ea3c963, 815b4c8) verified in git log.
