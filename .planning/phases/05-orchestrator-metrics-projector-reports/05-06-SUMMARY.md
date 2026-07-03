---
phase: 05-orchestrator-metrics-projector-reports
plan: 06
subsystem: orchestrator
status: complete
tags: [orchestrator, runBenchmark, CLI-01, agent-first, import-boundary, D-23, D5-08]

# Dependency graph
requires:
  - phase: 05-01
    provides: "runStack(stack, runId, storage, {prePopulated, onLivePage}) skip-copy build/render + server-up eval window"
  - phase: 05-02
    provides: "modelAcceptsImage(spec) capability probe + AgentInput.injectImage gate"
  - phase: 05-03
    provides: "updateRunOutcome + linkExpectedScreenshot writers; production models/deepseek4pro.json + scenarios/dashboard/*"
  - phase: 05-04
    provides: "projectMetrics(db, runId) post-run fold"
provides:
  - "runBenchmark(args, deps) — the single load→manifest→agent→build/render→evaluate→outcome→project sequencing function (SC#1, CLI-01)"
  - "RunBenchmarkArgs / RunBenchmarkDeps / RunResult / OnLivePage / BuildRenderFn exported types (the CLI's seam, 05-07)"
affects: [05-07-cli, report]

tech-stack:
  added: []
  patterns:
    - "Headless orchestrator: returns a structured RunResult and prints nothing — terminal summary (05-07) + HTML report (05-05) consume the return + DB, never stdout"
    - "Object-shaped OnLivePage seam isolates run.ts from 05-01's positional onLivePage(page, generatedPng); defaultBuildRender is the ≤5-line bridge"
    - "Scored-failure vs harness-fatal split: every reached return persists a scored row (CLI exit 0); only prologue/DB/agent-setup throws propagate (D5-08)"

key-files:
  created:
    - src/orchestrator/run.ts
    - tests/orchestrator.test.ts
  modified: []

key-decisions:
  - "defaultModels() = builtinModels() from @earendil-works/pi-ai/providers/all (the one MEDIUM-confidence seam): loads the real anthropic provider so buildRegistry's getModel resolves the judge; the key is read from env only at models.complete() time inside the judge (absent → judge drops, composite renormalizes, never a crash — D5-05). pi-ai is allowed under D-23 (only the coding-agent SDK is boundary-guarded)."
  - "The onLivePage try/catch wraps the WHOLE eval body (buildRegistry + evaluateRun), not only evaluateRun as the plan literally worded — a production unknown-judge-model construction throw in buildRegistry must also degrade to a null composite, not crash the row (D5-05). Behaviourally identical to plan intent; strictly safer."
  - "Timeout test drives the maxTurns:1 ceiling via a tmp scenario clone (dashboard.yaml + sibling expected.png/mockup.png) because the production dashboard budget defaults to 50 turns — scripting 50 turn_ends would be absurd. One scripted turn trips the turns ceiling → benchmark_finished{timeout}, buildRender never called."

# Metrics
duration: 11min
completed: 2026-07-03
tasks: 2
files: 2
requirements-completed: [CLI-01]
---

# Phase 5 Plan 06: Run Orchestrator (runBenchmark) Summary

**`runBenchmark(args, deps)` — the single headless sequencing function that turns three named spec paths into one stored, scored benchmark row: load → build/persist manifest (run_id) → agent-first stream into the shared log → build/render on the agent-populated workspace → evaluate+score (completed path only, inside the server-up window) → updateRunOutcome → projectMetrics → a structured `RunResult`. Every scored terminal (completed / build_failed / timeout / agent_error) returns without throwing; only harness-fatal conditions throw (D5-08). Respects the D-23 import boundary — no pi-coding-agent, no playwright, no ad-hoc SQL.**

## What was built

- **`src/orchestrator/run.ts`** exporting `runBenchmark` plus `RunBenchmarkArgs` / `RunBenchmarkDeps` / `RunResult` / `OnLivePage` / `BuildRenderFn`. Implements the 05-RESEARCH §Orchestrator 13-step sequence:
  1. HARNESS-FATAL prologue: `loadStack/loadScenario/loadModel` + read the expected + sibling `mockup.png` bytes + `newRunId()` (any throw propagates → CLI non-zero, no row).
  2. `openDb(dbPath)` wrapped in try/finally-close; `createStoragePort(db, resultsRoot)`.
  3. VersionStamp (node/lockfile-hash/playwright-version-via-file-read/null-chromium/modelId/params) → `buildManifest` → `persistManifest` (runs row `status='pending'`).
  4. `linkExpectedScreenshot` NOW (independent of outcome, so `report` shows it on a failed row).
  5. Image gate: `injectImage = modelAcceptsImage(agentModel)`; when false, append an `unknown` `mockup_grounding_skipped` marker (the 05-05 caveat channel).
  6. `copyWorkspace(stack.template, runId, "tmp")` + build the Pi-free `AgentInput` (budget = minutes×60000 / usd / turns).
  7. AGENT-FIRST stream: `for await (const draft of runSession(...)) storage.appendEvent(draft)`, tracking `agentTerminal` from any `benchmark_finished`.
  8. Terminal branch: agent-capped/errored → use that terminal, no buildRender, null composite; natural completion → `buildRender({stack,runId,storage,appDir,onLivePage})` and evaluate ONLY inside the server-up `onLivePage`.
  9. `updateRunOutcome(db, runId, status, failedStage, now())`.
  10. `projectMetrics(db, runId)` AFTER the terminal (TEL-02/D-24).
  11. Return `{ runId, status, compositeScore, failedStage, reportDir, scored:true }`.
- **`defaultBuildRender`** — the ≤5-line adapter calling the EXISTING `runStack(stack, runId, storage, {prePopulated:true, onLivePage})`, bridging 05-01's positional `onLivePage(page, generatedPng)` to the object-shaped `OnLivePage` seam.
- **`tests/orchestrator.test.ts`** — five cases (HAPPY / BUILD_FAILED / TIMEOUT / HARNESS-ERROR / IMAGE-GATE) driven entirely through injected deps: a scripted fake Pi session (real `runSession` + mapper, zero network/cost), a `fauxProvider` judge (zero paid call), and a fake `buildRender` that chooses the RunOutcome. The happy path's `renderWithPage` on the `app.html` fixture is the SOLE Chromium touch; cases 2–5 stay pure.

## Deviations from Plan

### Auto-fixed / intent-preserving

**1. [Rule 2 - robustness] onLivePage try/catch widened to cover buildRegistry too**
- **Found during:** Task 2
- **Issue:** The plan worded the D5-05 guard as "wrap the evaluate call in try/catch". But `buildRegistry` runs first inside `onLivePage`, and `createJudgeEvaluator` throws if `models.getModel(judge)` is undefined (a production unknown-model path). An uncaught throw there would reject out of runStack and crash the row.
- **Fix:** Wrapped the whole eval body (registry build + `evaluateRun`) in the try/catch so any registry/evaluator throw leaves `compositeScore = null` and the row still scores.
- **Files modified:** src/orchestrator/run.ts
- **Commit:** d1fcd85

No other deviations. `defaultModels()` was implemented as `builtinModels()` (a cleaner one-liner than "createModels() then register the provider") — it loads the real anthropic provider, satisfying the plan's stated requirement.

## Verification

- `npx vitest run tests/orchestrator.test.ts` → 5/5 pass (GREEN): completed row + non-null composite + populated metrics/tool_calls/iterations + `screenshots role='expected'`; build_failed scored with zero evaluations + partial metrics; timeout never calls buildRender + cost folded; unresolvable scenario rejects; text-only model appends `mockup_grounding_skipped`.
- `npx vitest run tests/importBoundary.test.ts` → 2/2 pass — run.ts is NOT a second pi-coding-agent importer.
- `npx tsc --noEmit` → No errors found.
- Grep gates (D-23): `grep -n "pi-coding-agent" src/orchestrator/run.ts` empty; non-comment lines contain no `from "playwright"` / `db.prepare(` / `db.exec(`.
- Full suite `npm test` → 157 pass / 30 files (no regression in projector/report/agent siblings).

## Known Stubs

None. `chromium: null` in the VersionStamp is a documented best-effort v1 field (the real revision is a later upgrade), consistent with the manifest's existing contract — not a data stub that blocks the plan goal.

## Threat Flags

None. run.ts opens no new network/auth surface: keys stay inside the agent adapter (D4-19) and the judge; the orchestrator reads only CLI-scoped spec paths and writes only under `results/<runId>` via storage helpers (T-05-02/T-05-03 mitigations upheld).

## Self-Check: PASSED

- Created files present: `src/orchestrator/run.ts`, `tests/orchestrator.test.ts`.
- Commits in git history: `c5e78ad` (RED test), `d1fcd85` (GREEN impl).
