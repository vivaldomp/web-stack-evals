---
phase: 04-agent-runtime-pi-sdk-adapter
plan: 01
subsystem: core-contracts
tags: [dependencies, events, pi-sdk, telemetry]
requires:
  - "@earendil-works/pi-ai@0.80.3 (already present)"
  - "src/core/units.ts (EpochMs, DurationMs, UsdCost)"
provides:
  - "@earendil-works/pi-coding-agent@0.80.3 (production dep, exact pin)"
  - "SessionStartedEvent, FirstTokenEvent, UsageEvent (AgentEvent variants)"
  - "AgentEventDraft = Omit<AgentEvent, 'seq'> (storage-owned seq boundary)"
affects:
  - "src/core/ports.ts, src/storage/db.ts, mapEvent.ts, piAgentAdapter.ts (downstream consumers, Plans 04-02/04-05/04-07)"
tech-stack:
  added:
    - "@earendil-works/pi-coding-agent@0.80.3"
  patterns:
    - "Exact-pin Pi packages in lockstep (no caret) per CLAUDE.md"
    - "Plain discriminated union keyed by `type` — no zod in events.ts"
key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - src/core/events.ts
    - tests/core.test.ts
decisions:
  - "[Phase 04-01]: Added the three new variants to the tests/core.test.ts exhaustiveness switch (samples + switch cases) to keep the 'exhaustively narrows every known variant' test honest — the union extension made TS2366 fire otherwise"
metrics:
  duration: 2min
  completed: 2026-07-03
status: complete
---

# Phase 4 Plan 01: Pi Dependency & Event Contract Foundation Summary

Pinned `@earendil-works/pi-coding-agent@0.80.3` and extended the canonical `AgentEvent` union with `SessionStartedEvent` / `FirstTokenEvent` / `UsageEvent` plus the `AgentEventDraft` (seq-less producer type), unblocking every other Phase-4 plan.

## What Was Built

- **Task 1 — Pi coding-agent dependency (commit 9aa0edc):** Installed `@earendil-works/pi-coding-agent@0.80.3` as a production dependency, exact-pinned (no caret) to match the existing `@earendil-works/pi-ai@0.80.3` and CLAUDE.md's lockstep directive. `@earendil-works/pi-agent-core@0.80.3` arrived transitively. Deprecated `@mariozechner/*` scope absent. Module resolves at runtime.
- **Task 2 — Event union extension (commit 10906e8):** Added three plain interfaces to `src/core/events.ts`:
  - `SessionStartedEvent` (`type: "session_started"`, `provider`, `modelId`) — t0 anchor (D4-10).
  - `FirstTokenEvent` (`type: "first_token"`) — TTFT source (D4-10, TEL-03).
  - `UsageEvent` (`type: "usage"`, verbatim token counts + `costUsd: UsdCost` + `aborted`) — one-per-turn_end (D4-09/D4-15).
  - All three added to the `AgentEvent` union; `AgentEventDraft = Omit<AgentEvent, "seq">` added for the D4-26 storage-owned seq boundary; `BaseEvent.seq` doc retitled "storage-assigned, monotonic per run (D4-26)". No runtime imports added (units imported `import type` only); events.ts stays zod-free.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Blocking] Extended the exhaustiveness switch in tests/core.test.ts**
- **Found during:** Task 2 (typecheck)
- **Issue:** `tests/core.test.ts` `describeEvent()` is an exhaustive `switch (e.type)` over `AgentEvent`. Adding three union members made the function non-exhaustive → `TS2366: Function lacks ending return statement`.
- **Fix:** Added the three new variants to both the `samples: AgentEvent[]` array and the `switch` (cases returning `session_started:…`, `first_token`, `usage:…`), preserving the test's stated "exhaustively narrows every known variant" intent.
- **Files modified:** tests/core.test.ts (not in plan frontmatter `files_modified`; in-scope because the union extension directly broke it — same precedent as Phase 02-03/02-01 test-file additions)
- **Commit:** 10906e8

**2. [Rule 3 - Blocking] npm wrote a caret range; corrected to exact pin**
- **Found during:** Task 1 verification
- **Issue:** `npm install …@0.80.3` recorded `"^0.80.3"` in package.json, violating the plan's exact-pin prohibition.
- **Fix:** Edited package.json to `"0.80.3"` and re-ran `npm install` to sync the lockfile.
- **Files modified:** package.json, package-lock.json
- **Commit:** 9aa0edc

## Verification

- `npm run typecheck` — clean (tsc --noEmit, 0 errors).
- `npm test` — 16 files, **82 tests passed** (self-check gate).
- `node --input-type=module -e "import('@earendil-works/pi-coding-agent')"` — resolves (import-ok).
- Plan verify commands: the Task 1 `require('.../package.json')` check could not run verbatim because the package's `exports` map blocks the `./package.json` subpath; verified the same facts (installed version `0.80.3`, exact pin, no `@mariozechner/`, main entry imports) directly instead. Task 2 content assertions passed as written.

## Notes for Downstream Plans

- Plan 04-02 (D4-26 seq ownership) consumes `AgentEventDraft`; the append boundary stamps `seq`.
- Plans 04-05/04-07 (Pi adapter, mapEvent) consume the three new variants and the `@earendil-works/pi-coding-agent` dep.

## Self-Check: PASSED

All modified files and both task commits (9aa0edc, 10906e8) verified present.
