---
phase: 04-agent-runtime-pi-sdk-adapter
plan: 03
subsystem: api
tags: [zod, typescript, agent-runtime, budget, preamble, agent-input]

requires:
  - phase: 04-agent-runtime-pi-sdk-adapter (Plan 04-01)
    provides: Pi dependency pinned + event union + core units (DurationMs, UsdCost)
  - phase: 02 (spec loaders)
    provides: StackSchema / ScenarioSchema / loadStack / loadScenario
provides:
  - "StackSchema.preamble — required stack-authored environmental grounding (D4-04/D4-05)"
  - "ScenarioSchema.budget — defaulted three-ceiling run budget (D4-01/D4-03)"
  - "ScenarioSchema.skills doc-comment tightened to the D4-16 additionalSkillPaths contract"
  - "src/agent/types.ts — Pi-free AgentInput/AgentBudget/AgentModelSpec boundary (D4-22)"
  - "Authored angular preamble in prod + fixture stack yaml"
affects: [04-05, 04-06, 04-07, 04-08, orchestrator, agent-adapter]

tech-stack:
  added: []
  patterns:
    - "Declarative-first (D-07): budget/preamble/skills are spec edits, not core changes"
    - "Pi-free typed boundary: src/agent/types.ts imports only core units type-only, no Pi SDK"
    - "zod object-level default fills field defaults for absent config (budget)"

key-files:
  created:
    - src/agent/types.ts
    - tests/agentInput.test.ts
  modified:
    - src/specs/schema.ts
    - stacks/angular.yaml
    - tests/fixtures/stacks/angular.yaml
    - tests/specs.test.ts
    - tests/runStack.test.ts

key-decisions:
  - "budget uses .default({ maxMinutes: 20, maxUsd: 5, maxTurns: 50 }) instead of .default({}) — zod 4 types the object-level default arg against the full input shape; the explicit literal typechecks and yields identical runtime semantics (absent budget -> documented defaults, partial budget -> field defaults fill the rest)"
  - "Default ceilings 20 min / 5.00 USD / 50 turns are ASSUMED (D4-01/D4-03) pending first-run calibration — documented inline in the schema"

patterns-established:
  - "Resolved-vs-declared split: ScenarioSchema.budget declares minutes; AgentBudget carries the resolved maxWallClockMs (ms) the orchestrator converts"
  - "AgentInput is the single narrow orchestrator->adapter contract; adapter never reaches into spec loaders"

requirements-completed: [AGENT-02, AGENT-05]

coverage:
  - id: D1
    description: "ScenarioSchema.budget: absent budget resolves to 20/5/50; partial budget fills omitted ceilings; non-positive ceiling rejected"
    requirement: AGENT-05
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#defaults an absent budget to 20 min / 5 USD / 50 turns (D4-01/D4-03)"
        status: pass
      - kind: unit
        ref: "tests/specs.test.ts#fills omitted budget ceilings from per-field defaults on a partial budget"
        status: pass
      - kind: unit
        ref: "tests/specs.test.ts#rejects a non-positive budget ceiling (a disabled cap)"
        status: pass
    human_judgment: false
  - id: D2
    description: "StackSchema.preamble required; angular stack authors a non-empty preamble"
    requirement: AGENT-02
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#requires a preamble — a stack without one is rejected (D4-05)"
        status: pass
      - kind: unit
        ref: "tests/specs.test.ts#parses the real Angular stack spec and matches the declared field values"
        status: pass
    human_judgment: false
  - id: D3
    description: "src/agent/types.ts exports Pi-free AgentInput/AgentBudget/AgentModelSpec (nine-field boundary, D4-22)"
    requirement: AGENT-02
    verification:
      - kind: unit
        ref: "tests/agentInput.test.ts#constructs a well-formed AgentInput literal"
        status: pass
      - kind: other
        ref: "npm run typecheck (tsc --noEmit accepts the AgentInput literal)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-03
status: complete
---

# Phase 04 Plan 03: Spec Budget/Preamble + AgentInput Contract Summary

**Three-ceiling scenario `budget` + required stack `preamble` on the zod specs, plus a Pi-free nine-field `AgentInput` boundary (`src/agent/types.ts`) for the orchestrator-to-adapter handoff.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-03T00:30:54Z
- **Completed:** 2026-07-03T00:36:00Z
- **Tasks:** 2
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- `ScenarioSchema.budget`: `z.strictObject` of `maxMinutes`/`maxUsd`/`maxTurns` with per-field defaults (20/5/50) and an object-level default so an absent budget is fully bounded (T-04-03a DoS mitigation).
- `StackSchema.preamble`: required, non-empty-by-contract stack-authored grounding; angular stack authors a real preamble (skeleton present + build/start commands, no task hint per D4-04).
- `ScenarioSchema.skills` doc tightened to the D4-16 `additionalSkillPaths` contract (no type change).
- `src/agent/types.ts`: `AgentBudget` (resolved ms/USD ceilings), `AgentModelSpec` (provider/modelId/thinkingLevel?/temperature), `AgentInput` (nine resolved fields) — type-only units import, zero Pi SDK reference (D4-22, D-23).

## Task Commits

1. **Task 1: StackSchema preamble + ScenarioSchema budget + angular preamble** - `0a51fa7` (feat)
2. **Task 2: AgentInput contract in src/agent/types.ts** - `dcdbde0` (feat)

**Plan metadata:** committed with SUMMARY/STATE/ROADMAP (docs)

## Files Created/Modified
- `src/specs/schema.ts` - Added `StackSchema.preamble`, `ScenarioSchema.budget`, tightened `skills` doc
- `src/agent/types.ts` - New Pi-free `AgentInput`/`AgentBudget`/`AgentModelSpec` boundary
- `stacks/angular.yaml` - Authored angular preamble
- `tests/fixtures/stacks/angular.yaml` - Authored fixture preamble
- `tests/specs.test.ts` - Budget default/partial/negative + missing-preamble rejection + prod preamble non-empty
- `tests/agentInput.test.ts` - AgentInput shape construction + runtime asserts
- `tests/runStack.test.ts` - `baseStack` helper gains a preamble (required-field fix)

## Decisions Made
- Used `.default({ maxMinutes: 20, maxUsd: 5, maxTurns: 50 })` rather than the plan's literal `.default({})`. Under zod 4.4.3 the object-level `.default()` arg is typed against the full input shape (the ZodDefault field wrappers do not make the parent's `.default()` arg partial), so `.default({})` failed `tsc`. The explicit literal typechecks and is behaviorally identical: absent budget → the documented defaults; partial budget → object parses and field defaults fill the omitted ceilings (both asserted green).
- Default ceilings remain ASSUMED (20 min / 5.00 USD / 50 turns), documented inline pending first-run calibration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `budget` `.default({})` failed typecheck under zod 4**
- **Found during:** Task 1
- **Issue:** zod 4.4.3 types the object-level `.default()` argument against the full (non-partial) input shape; `.default({})` produced TS2769.
- **Fix:** Passed the concrete default literal `.default({ maxMinutes: 20, maxUsd: 5, maxTurns: 50 })` — same runtime semantics, typechecks.
- **Files modified:** src/specs/schema.ts
- **Verification:** `npm run typecheck` clean; budget default/partial tests green.
- **Committed in:** `0a51fa7`

**2. [Rule 3 - Blocking] Adding required `preamble` broke `tests/runStack.test.ts` baseStack helper**
- **Found during:** Task 1
- **Issue:** The `baseStack` test helper builds a `Stack` literal; making `preamble` required surfaced TS2322 there.
- **Fix:** Added a `preamble` field to the `baseStack` literal (test-only helper; not a prohibited core file).
- **Files modified:** tests/runStack.test.ts
- **Verification:** `npm run typecheck` clean; full suite green.
- **Committed in:** `0a51fa7`

**3. [Rule 3 - Blocking] Plan's own verify grep false-positived on a doc comment**
- **Found during:** Task 2
- **Issue:** The task's automated guard `/@earendil-works|pi-coding-agent|pi-ai/` is a substring check; my doc comment literally contained "@earendil-works" while describing the no-import rule, tripping the "Pi import leaked" guard despite no actual import.
- **Fix:** Reworded the comment to "no Pi SDK import" (dropped the scope literal). Contract intent unchanged.
- **Files modified:** src/agent/types.ts
- **Verification:** guard prints GUARD-OK; typecheck + agentInput test green.
- **Committed in:** `dcdbde0`

---

**Total deviations:** 3 auto-fixed (3 blocking).
**Impact on plan:** All three were mechanical blockers (zod-4 typing, a required-field ripple into a test helper, and the plan's own dumb-grep guard). No scope creep, no behavior change from the plan's intent.

## Issues Encountered
None beyond the auto-fixed blockers above.

## Deferred Issues
None.

## Known Stubs
None — both schemas and the AgentInput type are complete; enforcement of the ceilings lands in the adapter (Plans 04-07/08) as planned.

## Threat Flags
None — no new trust boundary beyond the plan's threat register (budget defaults bound DoS T-04-03a; strictObject rejects typo'd keys T-04-05sc; AgentInput carries no secrets T-04-22a).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `AgentInput` is the ready-to-consume typed argument for the adapter's `runSession` narrowing (Plans 04-05/07/08).
- Orchestrator (Phase 5) will convert `scenario.budget.maxMinutes` → `AgentBudget.maxWallClockMs` and prepend `stack.preamble` to the scenario prompt.
- No wave-1 file collision with Plans 04-01/04-02 (only schema.ts + new agent/ module + test files touched).

## Self-Check: PASSED
- FOUND: src/agent/types.ts
- FOUND: tests/agentInput.test.ts
- FOUND: commit 0a51fa7
- FOUND: commit dcdbde0
- typecheck clean; targeted suite 18 pass / 0 fail; full suite 87 pass / 0 fail

---
*Phase: 04-agent-runtime-pi-sdk-adapter*
*Completed: 2026-07-03*
