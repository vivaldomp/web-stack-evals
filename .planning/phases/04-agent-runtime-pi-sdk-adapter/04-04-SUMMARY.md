---
phase: 04-agent-runtime-pi-sdk-adapter
plan: 04
subsystem: agent
tags: [pi-sdk, event-mapping, telemetry, usage, tool-call, pure-function]

# Dependency graph
requires:
  - phase: 04-01
    provides: "AgentEvent union + session_started/first_token/usage variants + distributive AgentEventDraft"
  - phase: 04-02
    provides: "storage-owned seq — appendEvent stamps seq on seqless drafts"
  - phase: 04-03
    provides: "AgentInput / AgentModelSpec Pi-free boundary types"
provides:
  - "createEventMapper(ctx): pure per-run Pi→canonical event translator"
  - "PiEvent structural input type (no Pi SDK import required)"
  - "session_started/first_token once-only latches; verbatim usage; tool_call + file_mutation derivation; UnknownEvent passthrough"
affects: [04-05, phase-5-report]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure per-event translator: structural PiEvent input keeps the mapper dependency-free and unit-testable from fake events (zero network/cost)"
    - "Injected clock (ctx.now ?? Date.now) for deterministic ts assertions"
    - "Per-run closure state: session/first-token booleans + Map<toolCallId, args> args cache"

key-files:
  created:
    - src/agent/mapEvent.ts
    - tests/mapEvent.test.ts
  modified: []

key-decisions:
  - "file_mutation drafts built as plain object literals into AgentEventDraft[] (no `satisfies FileMutationEvent`, which would demand storage-owned seq)"
  - "summarizeArgs returns '' for an orphan tool_execution_end (no cached args) rather than throwing"
  - "Line counts read from piEvent.result.details.{linesAdded,linesRemoved}, else 0/0 (Pitfall 4 best-effort)"

patterns-established:
  - "Pattern: producers yield seqless AgentEventDraft; the default switch arm is the D-02 UnknownEvent safety net so the mapper never returns null/undefined"

requirements-completed: [AGENT-04]

coverage:
  - id: D1
    description: "agent_start → exactly one session_started (latched) carrying ctx provider+modelId"
    requirement: "AGENT-04"
    verification:
      - kind: unit
        ref: "tests/mapEvent.test.ts#agent_start emits exactly one session_started with ctx provider+modelId"
        status: pass
      - kind: unit
        ref: "tests/mapEvent.test.ts#a second agent_start emits nothing (latch)"
        status: pass
    human_judgment: false
  - id: D2
    description: "First text_delta emits one first_token; later deltas emit only unknown (idempotent latch)"
    requirement: "AGENT-04"
    verification:
      - kind: unit
        ref: "tests/mapEvent.test.ts#first text_delta → [first_token, unknown]; later deltas → [unknown] only"
        status: pass
    human_judgment: false
  - id: D3
    description: "turn_end → verbatim pi-ai Usage draft, unrounded costUsd, aborted flag from stopReason"
    requirement: "AGENT-04"
    verification:
      - kind: unit
        ref: "tests/mapEvent.test.ts#turn_end → one usage draft copying pi-ai Usage verbatim, unrounded cost"
        status: pass
      - kind: unit
        ref: "tests/mapEvent.test.ts#aborted turn (stopReason 'aborted') → usage{aborted:true} with tokens/cost intact"
        status: pass
    human_judgment: false
  - id: D4
    description: "Unknown Pi type → single UnknownEvent passthrough (piType + verbatim raw); never null"
    requirement: "AGENT-04"
    verification:
      - kind: unit
        ref: "tests/mapEvent.test.ts#auto_retry_start → one unknown{piType,raw} with delayMs intact; never null"
        status: pass
      - kind: unit
        ref: "tests/mapEvent.test.ts#the mapper never returns null/undefined for any input"
        status: pass
    human_judgment: false
  - id: D5
    description: "tool_execution_start/end → tool_call (+ file_mutation for write/edit); orphan end never throws"
    requirement: "AGENT-04"
    verification:
      - kind: unit
        ref: "tests/mapEvent.test.ts#paired bash start+end → one tool_call with command in argsSummary and isError propagated"
        status: pass
      - kind: unit
        ref: "tests/mapEvent.test.ts#write end → [tool_call, file_mutation{op:'create', path}]"
        status: pass
      - kind: unit
        ref: "tests/mapEvent.test.ts#an orphan end (no prior start) still emits a tool_call and never throws"
        status: pass
    human_judgment: false
  - id: D6
    description: "No emitted draft carries an own seq property (seq is storage-owned, D4-26)"
    requirement: "AGENT-04"
    verification:
      - kind: unit
        ref: "tests/mapEvent.test.ts#no emitted draft carries an own seq property"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-03
status: complete
---

# Phase 04 Plan 04: Pi → Canonical Event Mapper Summary

**Pure per-run `createEventMapper(ctx)` translating each Pi SDK event into zero-or-more seqless `AgentEventDraft`s — session_started/first_token latches, verbatim pi-ai usage (incl. aborted turns), tool_call + file_mutation derivation, and a D-02 UnknownEvent passthrough — proven entirely from hand-authored fake events with an injected clock.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-03T00:50:55Z
- **Completed:** 2026-07-03T00:55:09Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 2 (1 source, 1 test)

## Accomplishments
- `createEventMapper` maps every Pi event class in the RESEARCH mapping table: `session_started` (once), `first_token` (once, latched), verbatim `usage` (incl. aborted turns, unrounded cost), `tool_call` (+ `file_mutation` for write/edit), and `UnknownEvent` passthrough for everything else.
- Zero Pi SDK dependency: the module reads only structural `PiEvent` fields, so the whole behavior is unit-tested from fake events — no live session, no network, no cost.
- `tool_execution_start` caches args by `toolCallId`; `tool_execution_end` derives the `tool_call` (so `isError` is known) with a one-line `argsSummary`, then deletes the cache entry. Orphan ends never throw.
- All drafts are seqless (D4-26) — verified by an explicit own-property assertion.

## Task Commits

TDD tasks — test (RED) → feat (GREEN), plus one refactor:

1. **Task 1 RED: core mapper tests** - `0974010` (test)
2. **Task 1 GREEN: core mapper** - `c5fdb34` (feat)
3. **Task 1 refactor: drop literal SDK package string from comment** - `3a7364d` (refactor)
4. **Task 2 RED: tool_call + file_mutation tests** - `bf013ec` (test)
5. **Task 2 GREEN: tool arms** - `35d3218` (feat)

## Files Created/Modified
- `src/agent/mapEvent.ts` - Pure per-run Pi→canonical event mapper: `createEventMapper`, `EventMapperContext`, `EventMapper`, `PiEvent`.
- `tests/mapEvent.test.ts` - 16 table-driven unit tests over the Pi event union from fake events + injected clock.

## Decisions Made
- Built `file_mutation` drafts as plain object literals into `AgentEventDraft[]` — `satisfies FileMutationEvent` demanded the storage-owned `seq` and broke typecheck; the array's element type already constrains the shape.
- `summarizeArgs` returns `""` for an orphan `tool_execution_end` (no cached args) instead of throwing — keeps the log honest without crashing the run.
- Line counts read from `piEvent.result.details.{linesAdded,linesRemoved}` when present, else `0/0` (Pitfall 4 — event existence + path is the load-bearing signal; Phase 5 owns exact deltas).

## Deviations from Plan

None - plan executed exactly as written. (The one intra-task correction — removing `satisfies FileMutationEvent` after it failed typecheck — was in-flight GREEN iteration, not a scope change. The `refactor` commit re-worded a comment so the "no `@earendil-works/pi-coding-agent` import" acceptance grep is literally clean; grep count is now 0.)

## Issues Encountered
- `satisfies FileMutationEvent as AgentEventDraft` failed `tsc` (TS1360: missing `seq`). Resolved by dropping the `satisfies` clause and the now-unused import; tests were already green, typecheck then passed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The mapper is the translation core Plan 04-05's adapter calls once per Pi event; drafts flow to `StoragePort.appendEvent` which stamps `seq`. Ready to wire.
- No blockers.

## Self-Check: PASSED
- `src/agent/mapEvent.ts` — FOUND
- `tests/mapEvent.test.ts` — FOUND
- Commits `0974010`, `c5fdb34`, `3a7364d`, `bf013ec`, `35d3218` — all present in git log
- `npm run typecheck` — clean
- `npx vitest run` — 105/105 passing across 19 files (mapEvent suite: 16/16); grep `pi-coding-agent` in mapEvent.ts → 0

---
*Phase: 04-agent-runtime-pi-sdk-adapter*
*Completed: 2026-07-03*
