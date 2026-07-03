---
phase: 04-agent-runtime-pi-sdk-adapter
plan: 06
subsystem: agent-runtime
tags: [budget, teardown, usage-reconciliation, isolation, pi-sdk]
status: complete
requires:
  - "04-05: runSession streaming adapter + retained session handle + three // 04-06 SEAM markers"
  - "src/agent/types.ts: AgentBudget { maxWallClockMs, maxCostUsd, maxTurns }"
  - "src/core/events.ts: RunStatus \"timeout\" (D-19), UsageEvent, BenchmarkFinishedEvent"
provides:
  - "Bounded paid run: three-ceiling first-to-trip abort (wall/usd/turns) -> benchmark_finished{status:\"timeout\"}"
  - "Honest cost accounting on abort: reconciling usage{aborted:true} delta so Σ usage == getSessionStats().cost"
  - "Guaranteed-once teardown: clearTimeout + session.abort() + session.dispose() in a finally"
  - "Recorded v1 isolation posture (D4-23 cwd-lock accepted) + D4-25 no-custom-tool-timeout"
affects:
  - "src/agent/piAgentAdapter.ts"
  - "tests/_fakes/fakeSession.ts"
tech-stack:
  added: []
  patterns:
    - "stdlib setTimeout as fake-timer-friendly wall clock (no injectable clock dep)"
    - "first-to-trip via `??=` on a single `tripped` reason"
    - "belt-and-suspenders usage reconciliation against Pi's authoritative running total"
    - "generator try/finally for guaranteed-once teardown incl. consumer early-break"
key-files:
  created:
    - "tests/agentCeilings.test.ts"
    - "tests/agentAbortUsage.test.ts"
  modified:
    - "src/agent/piAgentAdapter.ts"
    - "tests/_fakes/fakeSession.ts"
decisions:
  - "D4-01/02/11: all three ceilings map to the existing \"timeout\" enum — no new RunStatus value"
  - "D4-15: reconcile Σ emitted usage.costUsd to getSessionStats().cost with one delta usage{aborted:true}"
  - "D4-24: teardown via session.abort()+dispose() (adapter holds no execa handle; Pi owns tool children)"
  - "D4-23 (v1, OQ2): cwd-lock + disposable per-run workspace accepted as the isolation boundary; no runtime path guard added"
  - "D4-25: no custom per-tool-call timeout; Pi's built-in timeouts + wall-clock ceiling bound a hung command"
metrics:
  duration: "~15m"
  completed: "2026-07-02"
  tasks: 2
  files_changed: 4
---

# Phase 04 Plan 06: Three-Ceiling Budget + Usage Reconciliation + Guaranteed Teardown Summary

Layered budget enforcement, honest usage-on-abort, and guaranteed-once teardown onto the three `// 04-06 SEAM` points Plan 04-05 left in `src/agent/piAgentAdapter.ts` — turning "drive a non-deterministic paid agent" into a bounded, honestly-accounted, self-cleaning run. All three SEAM markers are now filled; none remain.

## What was built

**Task 1 — three-ceiling monitor (commit `bcf9ac8`).** After session creation, `runSession` now scopes monitor state (`turns`, `tripped`, `wallTimer`). A `setTimeout(budget.maxWallClockMs)` fires `session.abort()` even with no events flowing (the hung-agent case). Inside the existing subscribe listener, each `usage` draft increments `turns` and evaluates the turn-count then cumulative-USD ceilings (`session.getSessionStats().cost >= budget.maxCostUsd`) first-to-trip via `??=`. Terminal resolution now puts `tripped` ahead of `sawFatalError`: a tripped run yields `benchmark_finished{status:"timeout", failedStage:null}` (reusing the D-19 enum), an abort-induced prompt rejection is therefore a timeout, not an `agent_error`; a natural completion still yields no terminal.

**Task 2 — reconciliation + teardown + decisions (commit `ea5b187`).** The listener accumulates `emittedCost += draft.costUsd`. After drain, before the terminal, the adapter reads `getSessionStats().cost` and emits one `usage{aborted:true}` delta when the provider total exceeds what was already reported (D4-15). The whole run body (mapper setup → prompt → drain → reconciliation → terminal) is wrapped in a `try` whose `finally` runs `clearTimeout(wallTimer)` → `await session.abort()` (rejection swallowed) → `session.dispose()` — guaranteed-once on natural end, ceiling trip, fatal error, and consumer early-break. The `try` opens after `createSession`, so a malformed input still throws from `assertAgentInput` before any session exists. The D4-23 (cwd-lock + disposable workspace accepted; no runtime path guard) and D4-25 (no custom tool timeout) decisions are recorded as source comment blocks with their upgrade paths.

**Fake-session extensions.** `tests/_fakes/fakeSession.ts` gained `costPerTurn` (advances `getSessionStats().cost` per replayed `turn_end`, driving the usd ceiling + reconciliation delta) and `hang` mode (`prompt()` settles only after `abort()` is called, driving the wall ceiling under `vi.useFakeTimers()`). Backward-compatible — the 04-05 suite is unchanged and green.

## Deviations from Plan

None — plan executed as written. Both tasks are TDD-style but committed as one atomic commit each (source + fake + test together), which is the plan's task-as-commit-unit.

Minor note (not a deviation): the USD-ceiling test in `agentCeilings.test.ts` naturally also produces a reconciliation delta draft once Task 2 landed (its `costPerTurn` total exceeds Σ per-turn usage); assertions key off terminal count/status, so this is expected and green.

## Verification

- `npm run typecheck` — clean (strict nodenext).
- `npx vitest run` (full suite) — **PASS (125) FAIL (0)**; 04-06 added 10 tests (5 ceilings + 5 abort/usage) over 04-05's 115.
- Comment-stripped grep of `src/agent/piAgentAdapter.ts`: no `rmSync(` / `cleanupWorkspace(` (partial work preserved); monitor + teardown symbols present (`setTimeout`, `getSessionStats`, `finally`, `.abort(`, `.dispose(`, `"timeout"`, `emittedCost`).
- `grep -c "04-06 SEAM"` → 0 (all three seams filled).

## Self-Check: PASSED

- FOUND: src/agent/piAgentAdapter.ts (modified)
- FOUND: tests/_fakes/fakeSession.ts (modified)
- FOUND: tests/agentCeilings.test.ts (created)
- FOUND: tests/agentAbortUsage.test.ts (created)
- FOUND: commit bcf9ac8 (Task 1)
- FOUND: commit ea5b187 (Task 2)
