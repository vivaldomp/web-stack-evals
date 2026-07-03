---
phase: 05-orchestrator-metrics-projector-reports
plan: 02
subsystem: agent
tags: [pi-sdk, model-capabilities, image-injection, tdd, import-boundary]

requires:
  - phase: 04-agent-runtime
    provides: piAgentAdapter (sole Pi importer), AgentInput contract, importBoundary guard, fakeSession
provides:
  - "modelAcceptsImage(spec, resolve?) capability probe reading Pi ModelRegistry model.input"
  - "AgentInput.injectImage?: boolean image gate honored by piAgentAdapter"
  - "importBoundary allowlist expanded to two files (modelCapabilities.ts + piAgentAdapter.ts)"
affects: [orchestrator, report, 05-metrics]

tech-stack:
  added: []
  patterns:
    - "Injectable resolver seam (default = real Pi ModelRegistry) makes a Pi-typed predicate unit-testable with zero registry/network call"
    - "SDK importer allowlist (array) replaces single-importer singleton — createAgentSession stays sole-sourced"

key-files:
  created:
    - src/agent/modelCapabilities.ts
    - tests/modelCapabilities.test.ts
  modified:
    - src/agent/types.ts
    - src/agent/piAgentAdapter.ts
    - tests/agentAdapter.test.ts
    - tests/importBoundary.test.ts

key-decisions:
  - "modelCapabilities.ts is the SECOND allowlisted Pi importer (AGENT-01/D5-14); it imports ModelRegistry/AuthStorage but never createAgentSession, so session creation stays sole-sourced to piAgentAdapter.ts"
  - "Only injectImage===false skips the mockup; undefined/true inject — default behavior unchanged (mockupBytes still required, gate only controls sending)"

patterns-established:
  - "Capability probe via injectable resolver: modelAcceptsImage(spec, resolve = piModelResolver) — fake resolver in tests, real registry in prod"

requirements-completed: [CLI-01]

coverage:
  - id: D1
    description: "modelAcceptsImage returns true iff resolved model input includes 'image'; unresolved/text-only → false (D5-01)"
    requirement: CLI-01
    verification:
      - kind: unit
        ref: "tests/modelCapabilities.test.ts#modelAcceptsImage (D5-01/D5-14 capability probe)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AgentInput.injectImage===false fires the prompt with an empty images array; default/true sends byte-exact mockup (D5-14)"
    requirement: CLI-01
    verification:
      - kind: unit
        ref: "tests/agentAdapter.test.ts#injectImage:false fires the prompt with an EMPTY images array"
        status: pass
      - kind: unit
        ref: "tests/agentAdapter.test.ts#fires exactly one prompt ... mockup-only flat image"
        status: pass
    human_judgment: false
  - id: D3
    description: "Import boundary intact: exactly two src/** Pi importers; createAgentSession sole-sourced to piAgentAdapter.ts"
    verification:
      - kind: unit
        ref: "tests/importBoundary.test.ts#AGENT-01 import boundary"
        status: pass
    human_judgment: false

duration: 2min
completed: 2026-07-03
status: complete
---

# Phase 5 Plan 02: Capability Probe + Image Gate Summary

**`modelAcceptsImage` probe reads Pi's ModelRegistry `model.input`, and `AgentInput.injectImage` gates the adapter's mockup so a text-only model no longer pays for image tokens it discards (D5-01/D5-14).**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-03T10:54:12Z
- **Completed:** 2026-07-03T10:56:20Z
- **Tasks:** 2 (TDD: RED → GREEN)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `modelAcceptsImage(spec, resolve?)` — `resolve(spec)?.input?.includes("image") ?? false`, with a module-private default resolver over the real Pi `ModelRegistry`; the injectable resolver keeps the predicate unit-testable with zero registry/network call.
- `AgentInput.injectImage?: boolean` gate: `piAgentAdapter` precomputes an `images` array — `[]` when `injectImage === false`, otherwise the existing byte-exact mockup element. Default/`true` path is unregressed.
- Import boundary allowlist widened from a single-importer singleton to a two-file array (`modelCapabilities.ts` + `piAgentAdapter.ts`) in the SAME plan that adds the second importer, so CI never goes red; the `createAgentSession` assertion still lists only `piAgentAdapter.ts`.

## Task Commits

1. **Task 1: RED — probe + image-gate + boundary tests** - `7da96bb` (test)
2. **Task 2: GREEN — probe, injectImage field, adapter ternary** - `9c56e42` (feat)

_TDD plan: RED (test) then GREEN (feat). No refactor commit — GREEN code was minimal._

## Files Created/Modified
- `src/agent/modelCapabilities.ts` - New. Second allowlisted Pi importer; exports `modelAcceptsImage` + `ModelResolver` type; default resolver = `ModelRegistry.create(AuthStorage.inMemory()).find(...)`.
- `src/agent/types.ts` - Added `AgentInput.injectImage?: boolean` (stays Pi-free).
- `src/agent/piAgentAdapter.ts` - Prompt `images` gated on `injectImage === false`; `assertAgentInput` untouched (mockupBytes still required).
- `tests/modelCapabilities.test.ts` - New. 3 cases via inline fake resolver (true / text-only / undefined).
- `tests/agentAdapter.test.ts` - Added `injectImage:false → 0 images` case; default 1-image case unchanged.
- `tests/importBoundary.test.ts` - First assertion now expects the sorted 2-file allowlist; `createAgentSession` assertion unchanged.

## Decisions Made
- None beyond the two key-decisions above — followed the plan as specified.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None. RED confirmed all three failures (missing module, still-injected image, allowlist mismatch); GREEN passed all five named test files + full 129-test suite + `tsc --noEmit` clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Probe + gate ready for the orchestrator (a later Phase-5 plan) to set `injectImage = modelAcceptsImage(model)` and record the "no mockup grounding" report caveat when false.
- Import boundary remains intact with exactly two Pi importers; no blockers.

---
*Phase: 05-orchestrator-metrics-projector-reports*
*Completed: 2026-07-03*
