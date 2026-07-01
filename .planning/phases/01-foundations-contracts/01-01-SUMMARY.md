---
phase: 01-foundations-contracts
plan: 01
subsystem: infra
tags: [typescript, node24, vitest, zod, better-sqlite3, event-sourcing]

# Dependency graph
requires: []
provides:
  - "Greenfield package.json/tsconfig.json/vitest.config.ts scaffold (Node 24, TS6 strict nodenext)"
  - "Pinned runtime deps installed: zod 4.4.3, yaml 2.9.0, better-sqlite3 12.11.1"
  - "Canonical AgentEvent discriminated union (src/core/events.ts) with UnknownEvent passthrough"
  - "AgentPort/StoragePort/EvaluatorPort interfaces (src/core/ports.ts) — D-23 isolation seam"
  - "newRunId() sortable run id generator (src/core/ids.ts)"
  - "EpochMs/DurationMs/UsdCost unit aliases (src/core/units.ts)"
affects: [01-02, 01-03, 01-04, 01-05, phase-02, phase-03, phase-04, phase-05]

# Tech tracking
tech-stack:
  added: ["typescript@6.0.3", "tsx@4.22.4", "vitest@4.1.9", "zod@4.4.3", "yaml@2.9.0", "better-sqlite3@12.11.1"]
  patterns:
    - "Ports-and-adapters: src/core/ports.ts declares interfaces only, no concrete runtime import (D-23)"
    - "Discriminated union on `type` for all agent telemetry events, with an UnknownEvent passthrough for forward-compat (D-01/D-02)"
    - "Canonical unit type aliases (EpochMs/DurationMs/UsdCost) instead of bare `number` throughout the codebase (D-26)"

key-files:
  created:
    - package.json
    - tsconfig.json
    - vitest.config.ts
    - .gitignore
    - src/core/units.ts
    - src/core/events.ts
    - src/core/ports.ts
    - src/core/ids.ts
    - tests/core.test.ts
  modified: []

key-decisions:
  - "tsconfig.json requires explicit \"types\": [\"node\"] — without it, this TypeScript 6.0.3 install does not auto-include @types/node's ambient globals (Buffer) or node:* module declarations, even though the package is installed (see Deviations)."
  - "AgentEvent variant `type` values use snake_case (tool_call, file_mutation, stage_started, stage_completed, stage_failed, benchmark_finished, unknown) for consistency across the union."
  - "AgentPort.runSession(input) and EvaluatorPort.evaluate(input) leave `input` as `unknown` — concrete input shapes are Phase 2-5's discretion; ports.ts stays a pure isolation seam per D-23."

patterns-established:
  - "Pattern: every AgentEvent variant extends BaseEvent { runId, seq, ts: EpochMs } per D-04 — new variants must follow this shape."
  - "Pattern: src/core/*.ts files import only `import type` from sibling core modules and never a concrete runtime dependency — enforced by grep in this plan's acceptance criteria and reusable for future core files."

requirements-completed: [TEL-01]

coverage:
  - id: D1
    description: "Greenfield project scaffolded (package.json, tsconfig.json, vitest.config.ts, .gitignore) with pinned deps installed (zod 4.4.3, yaml 2.9.0, better-sqlite3 12.11.1) and no Pi SDK / Playwright dependency"
    requirement: "TEL-01"
    verification:
      - kind: unit
        ref: "npm ls zod yaml better-sqlite3 typescript tsx vitest"
        status: pass
      - kind: unit
        ref: "node -e \"require('better-sqlite3');require('yaml')\""
        status: pass
      - kind: other
        ref: "grep -c '@earendil-works\\|playwright' package.json (expect 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AgentEvent discriminated union with UnknownEvent passthrough, ToolCallEvent, FileMutationEvent, stage lifecycle events, BenchmarkFinishedEvent + RunStatus"
    requirement: "TEL-01"
    verification:
      - kind: unit
        ref: "tests/core.test.ts#AgentEvent > round-trips UnknownEvent piType and raw payload"
        status: pass
      - kind: unit
        ref: "tests/core.test.ts#AgentEvent > exhaustively narrows every known variant type in a switch"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D3
    description: "newRunId() sortable run-<ts>-<hex> generator (D-22)"
    verification:
      - kind: unit
        ref: "tests/core.test.ts#newRunId > matches the sortable run-id format"
        status: pass
      - kind: unit
        ref: "tests/core.test.ts#newRunId > produces distinct ids for calls in the same second"
        status: pass
      - kind: unit
        ref: "tests/core.test.ts#newRunId > sorts lexically in chronological order"
        status: pass
    human_judgment: false
  - id: D4
    description: "src/core/ports.ts declares AgentPort/StoragePort/EvaluatorPort as interfaces only, importing nothing concrete (D-23 isolation seam)"
    verification:
      - kind: other
        ref: "grep -cE \"from ['\\\"](better-sqlite3|@earendil-works|playwright|yaml)\" src/core/ports.ts (returns 0)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-07-01
status: complete
---

# Phase 1 Plan 1: Scaffold + Core Contracts Summary

**TS6/Node24 greenfield project scaffolded with pinned deps (zod 4.4.3, yaml 2.9.0, better-sqlite3 12.11.1) and the AgentEvent discriminated union + AgentPort/StoragePort/EvaluatorPort isolation seam that every later phase folds into.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-01T21:17:58Z
- **Completed:** 2026-07-01T21:25:11Z
- **Tasks:** 2 (Task 2 followed TDD RED/GREEN)
- **Files modified:** 10 (9 created + 1 fixed under Task 2's GREEN commit)

## Accomplishments
- Greenfield `package.json`/`tsconfig.json`/`vitest.config.ts`/`.gitignore` scaffold; `npm install` ran, lockfile generated, `better-sqlite3` native addon loads
- Canonical `AgentEvent` discriminated union (`src/core/events.ts`): `UnknownEvent` passthrough, `ToolCallEvent`, `FileMutationEvent`, stage lifecycle (`StageStarted/Completed/FailedEvent`), `BenchmarkFinishedEvent` + `RunStatus`
- `AgentPort`/`StoragePort`/`EvaluatorPort` interfaces (`src/core/ports.ts`) — D-23 seam verified by grep to import nothing concrete
- `newRunId()` sortable id generator (`src/core/ids.ts`) — format/distinctness/chronological-sort all test-covered
- `EpochMs`/`DurationMs`/`UsdCost` unit aliases (`src/core/units.ts`) per D-26
- No `@earendil-works/*` (Pi SDK) or `playwright` dependency present — confirmed forbidden this phase

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold project + install pinned deps** - `2e5930d` (chore)
2. **Task 2: Define core contracts — AgentEvent union, ports, ids, units** - `2e7c652` (test, RED) → `9aa2afd` (feat, GREEN)

**Plan metadata:** _pending — committed in final_commit step_

_Note: Task 2 used TDD; no refactor commit needed (implementation was already minimal)._

## Files Created/Modified
- `package.json` - type=module, engines>=24, pinned zod/yaml/better-sqlite3, dev deps (typescript/tsx/vitest/@types)
- `tsconfig.json` - nodenext module+resolution, ES2023 target, strict; `"types": ["node"]` added (see Deviations)
- `vitest.config.ts` - node environment, `tests/**/*.test.ts` include
- `.gitignore` - node_modules, results, tmp, *.db*
- `src/core/units.ts` - `EpochMs`/`DurationMs`/`UsdCost` type aliases
- `src/core/events.ts` - `AgentEvent` union + `BaseEvent`, `RunStatus`, all 7 variants
- `src/core/ports.ts` - `AgentPort`/`StoragePort`/`EvaluatorPort` interfaces only
- `src/core/ids.ts` - `newRunId()` generator
- `tests/core.test.ts` - format/distinctness/sort assertions for `newRunId`; round-trip + exhaustive-switch assertions for `AgentEvent`

## Decisions Made
- Snake_case `type` discriminant values across all `AgentEvent` variants (`tool_call`, `file_mutation`, `stage_started`, `stage_completed`, `stage_failed`, `benchmark_finished`, `unknown`) for internal consistency — not specified verbatim by the plan, left to discretion per CONTEXT.md.
- `AgentPort`/`EvaluatorPort` method inputs typed as `unknown` rather than speculative concrete shapes — keeps the D-23 seam a pure contract; concrete input types belong to the phases that implement these ports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `"types": ["node"]` to tsconfig.json**
- **Found during:** Task 2 (core contracts implementation, GREEN verification)
- **Issue:** `npx tsc --noEmit` failed with `TS2591: Cannot find name 'node:crypto'` (in `src/core/ids.ts`) and `TS2591: Cannot find name 'Buffer'` (in `src/core/ports.ts`), even though `@types/node@24.13.2` was installed correctly (confirmed present in `node_modules/@types/node` with correct ambient `declare module "node:crypto"` and `declare global { var Buffer: ... }` declarations). Isolated repro outside the project tree (minimal tsconfig + symlinked `node_modules`) reproduced the identical failure, and adding `"types": ["node"]` to that minimal repro's tsconfig fixed it — confirming this TypeScript 6.0.3 install does not auto-include `@types/node`'s ambient declarations without an explicit `types` array.
- **Fix:** Added `"types": ["node"]` to `tsconfig.json`'s `compilerOptions`.
- **Files modified:** `tsconfig.json`
- **Verification:** `npx tsc --noEmit` exits 0 after the fix; re-ran full `vitest run tests/core.test.ts` (5/5 pass) and the D-23 seam grep (0 matches) to confirm nothing else regressed.
- **Committed in:** `9aa2afd` (Task 2 GREEN commit)

**2. [Note - sequencing, not a code fix] Deferred Task 1's `npx tsc --noEmit` acceptance check to after Task 2**
- **Found during:** Task 1 verification
- **Issue:** Task 1's own `<verify>` block runs `npx tsc --noEmit` immediately after scaffolding config files, before `src/`/`tests/` exist. With `"include": ["src", "tests"]` pointing at directories with zero files, `tsc` fails with `TS18003: No inputs were found in config file` regardless of how correct the scaffold is — this is a plan-sequencing artifact (Task 1 configures the compiler; Task 2 supplies the only source files that satisfy `include`), not a defect in the scaffold.
- **Resolution:** Verified Task 1's own scope directly (pinned versions in `package.json`, `nodenext`/`strict` in `tsconfig.json`, lockfile presence, `require('better-sqlite3')`/`require('yaml')` success, absence of `@earendil-works`/`playwright`), then ran the full `tsc --noEmit` gate once Task 2's source files existed — satisfying the plan's overall `<verification>` section, which is where this check actually belongs.
- **Files modified:** none (verification-only adjustment)
- **Committed in:** n/a (no code change)

---

**Total deviations:** 1 auto-fixed (1 blocking config fix) + 1 verification-sequencing note.
**Impact on plan:** The tsconfig fix was necessary for `tsc --noEmit` to pass at all under this TypeScript 6.0.3 install; no scope creep. The sequencing note reflects how the two tasks' verify steps compose, not a change to either task's deliverables.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `src/core/{units,events,ports,ids}.ts` are ready for Plans 01-02 through 01-05 (spec loaders, manifest/fingerprint, SQLite schema, artifact store) to import.
- `AgentPort`/`StoragePort`/`EvaluatorPort` are pure interfaces — no adapter yet exists; Phase 4 (Pi SDK) and later phases implement them without needing to touch this plan's files.
- No blockers for downstream Phase 1 plans.

---
*Phase: 01-foundations-contracts*
*Completed: 2026-07-01*

## Self-Check: PASSED

All 9 created files confirmed present on disk; all 4 commits (`2e5930d`, `2e7c652`, `9aa2afd`, `6eed446`) confirmed in `git log`.
