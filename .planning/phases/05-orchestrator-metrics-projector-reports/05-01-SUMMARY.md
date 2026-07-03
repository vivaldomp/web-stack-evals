---
phase: 05-orchestrator-metrics-projector-reports
plan: 01
subsystem: infra
tags: [runstack, playwright, renderWithPage, telemetry, teardown, angular, execa]

# Dependency graph
requires:
  - phase: 02-workspace-build-serve
    provides: "runStack() pipeline (copy→install→build→start→screenshot→teardown), killProcessTree process-group teardown, copyWorkspace, createPlaywrightRenderer"
  - phase: 03-evaluation-pipeline
    provides: "renderWithPage() live-page render (LiveRenderResult {png,page,close}) for axe/DOM evaluators"
provides:
  - "runStack RunStackOptions 4th param: prePopulated (skip-copy, build the agent-populated dir) + onLivePage (server-up eval window before teardown)"
  - "stage:'start' and stage:'render' started/completed/failed events in the append-only log (startup_ms / render_ms fold for TEL-03)"
  - "Stage union widened with 'render' (type-only; DB schema + SCHEMA_VERSION unchanged)"
affects: [05-02, 05-03, orchestrator, metrics-projector, CLI-01, TEL-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive parameterization: optional 4th opts arg keeps every existing 3-arg runStack caller behavior-identical; teardown/outcome logic stays in one place (D5-13)"
    - "Live-page eval window: onLivePage runs inside runStack's try block BEFORE the outer finally's killProcessTree, wrapped in try/finally{close()} so the browser always closes"

key-files:
  created: []
  modified:
    - "src/pipeline/runStack.ts — RunStackOptions {prePopulated,onLivePage}; skip-copy conditional appDir; renderWithPage swap; start/render stage events"
    - "src/core/events.ts — Stage union += 'render'"
    - "tests/runStack.integration.test.ts — prePopulated+onLivePage describe: skip-copy sentinel, live-page window, start/render events"

key-decisions:
  - "renderWithPage replaces createPlaywrightRenderer().screenshot() on BOTH the 3-arg and 4-arg paths — same render pass (viewport, dpr=1, 12s navigation budget, settle, screenshot type:png), so the swap is behavior-identical for the screenshot while exposing the live page for onLivePage; its internal navigation budget also makes the old external screenshotTimeoutMs race redundant (racing a promise that keeps a browser open would leak it), so that local was removed."
  - "start_failed/timeout and render-throw branches emit stage_failed{stage} (exitCode 1) IN ADDITION to the existing benchmark_finished, so a failed startup/render window still folds a duration for TEL-03."
  - "Skip-copy is observed inside the onLivePage window, not post-run: cleanupWorkspace(runId,false) deletes tmp/<runId> on a completed run, so the sentinel can only be asserted while the server is still up."

patterns-established:
  - "Server-up eval window: yield the live Playwright page to an injected callback before teardown; teardown (killProcessTree in the outer finally) runs on every path AFTER the window closes."
  - "Test server-up probe uses node:http agent:false (one-off, un-pooled) rather than fetch, so no undici keep-alive socket lingers to stall a graceful SIGTERM shutdown."

requirements-completed: [TEL-03, CLI-01]

coverage:
  - id: D1
    description: "prePopulated skip-copy: runStack builds the agent-populated tmp/<runId>/angular dir without re-copying the pristine template (D5-13 gap #1)"
    requirement: "CLI-01"
    verification:
      - kind: integration
        ref: "tests/runStack.integration.test.ts#skip-copy: builds the agent-populated dir; sentinel survives into the serve window"
        status: pass
    human_judgment: false
  - id: D2
    description: "onLivePage server-up eval window: live page + non-empty png yielded to the callback while the server is reachable, THEN the server is torn down after the window closes (D5-13 gap #2)"
    requirement: "CLI-01"
    verification:
      - kind: integration
        ref: "tests/runStack.integration.test.ts#live page is available for eval with the server up, then teardown kills it — CALLBACK/live-page half: PASS (calls==1, png>0, page.title live, server-up probe ok)"
        status: pass
      - kind: integration
        ref: "tests/runStack.integration.test.ts#live page ... then teardown kills it — TEARDOWN-AFTER half (fetch rejects post-run): PENDING, blocked by env port-4200 squatter (see Issues)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "start/render stage telemetry: stage_started/stage_completed{stage:'start'} around readiness and {stage:'render'} around the screenshot, each completed carrying numeric durationMs (TEL-03 startup/render fold)"
    requirement: "TEL-03"
    verification:
      - kind: integration
        ref: "tests/runStack.integration.test.ts#emits start/render stage events with numeric durationMs"
        status: pass
    human_judgment: false
  - id: D4
    description: "Additive, non-breaking: Stage widened with 'render'; runStack gains optional 4th opts arg; all existing 3-arg callers + widened Stage compile and stay green"
    requirement: "CLI-01"
    verification:
      - kind: unit
        ref: "tests/runStack.test.ts + tests/seqOwnership.test.ts (10/10) + npm test full suite (125/125) + tsc --noEmit (exit 0)"
        status: pass
      - kind: integration
        ref: "tests/isolation.selftest.test.ts (3-arg real-Angular no-main-tree-mutation) — PENDING, blocked by env port-4200 squatter"
        status: unknown
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-07-03
status: complete
---

# Phase 5 Plan 01: Minimal runStack Seam Refactor Summary

**Additive `runStack(stack, runId, storage, opts?)` — `prePopulated` builds the agent-populated workspace (skip-copy), `onLivePage` yields the live Playwright page for axe before the outer-finally teardown, and `stage:'start'`/`'render'` events make startup/render foldable for TEL-03 — all without touching the fatal-stage→RunOutcome mapping or killProcessTree.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-03T07:15:00Z (approx)
- **Completed:** 2026-07-03T10:50:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- **Skip-copy (D5-13 gap #1):** `opts.prePopulated` makes runStack build `resolve(TMP_ROOT, runId, "angular")` (the exact dir the orchestrator's earlier `copyWorkspace` + agent mutation produced) instead of overlaying the pristine template. Default 3-arg path unchanged.
- **Server-up eval window (D5-13 gap #2):** `createPlaywrightRenderer().screenshot()` replaced by `renderWithPage()`, whose live `page` is handed to `opts.onLivePage(page, png)` inside the try block — before the outer `finally { killProcessTree }` — wrapped in `try/finally { await close() }`. Axe (a later plan) can now run against the agent's real running app.
- **Startup/render telemetry (TEL-03):** `stage_started/completed{stage:'start'}` around readiness and `{stage:'render'}` around the screenshot (plus `stage_failed{stage}` on the failure branches), so `startup_ms`/`render_ms` fold from the event log exactly like `install`/`build`.
- **Additive proof:** `Stage` widened by one literal (`'render'`, type-only — DB schema and SCHEMA_VERSION untouched); optional 4th arg; 3-arg callers behavior-identical (typecheck 0, 125/125 unit, 10/10 fast callers).

## Task Commits

1. **Task 1: RED — extend integration test (skip-copy, live-page window, start/render events)** — `fef147e` (test)
2. **Task 2: GREEN — additive runStack opts + start/render events + widen Stage** — `7c0886c` (feat)
3. **Task 3: Regression — prove existing runStack callers stay green** — no code change required; verified green for the non-port paths (typecheck 0, `runStack.test.ts`+`seqOwnership.test.ts` 10/10, full unit suite 125/125). `isolation.selftest.test.ts` real-Angular caller is PENDING behind the env port-4200 squatter.

## Files Created/Modified
- `src/pipeline/runStack.ts` — `RunStackOptions {prePopulated, onLivePage}`; conditional `appDir` (skip-copy); `renderWithPage` swap; `stage:'start'`/`'render'` started/completed/failed events; onLivePage window ordered before teardown; removed the now-redundant `screenshotTimeoutMs` local (renderWithPage self-bounds navigation).
- `src/core/events.ts` — `Stage` union `+= 'render'`.
- `tests/runStack.integration.test.ts` — new `prePopulated + onLivePage` describe (skip-copy sentinel, live-page window, start/render events); `node:http agent:false` server-up probe.

## Decisions Made
- **renderWithPage on both paths, drop the external screenshot-timeout race.** renderWithPage does the identical render pass and bounds navigation internally (12s), and it self-tears-down its browser on a navigation failure; keeping the old 30s `Promise.race` timeout would risk leaking an open browser (renderWithPage keeps it open on success), so the local was removed. Rendering stays byte-identical for the 3-arg path.
- **stage_failed on start/render failure branches** (exitCode 1) in addition to the existing terminal `benchmark_finished`, so failed startup/render windows still fold a duration.
- **Skip-copy verified inside the onLivePage window**, because `cleanupWorkspace` deletes the completed run's workspace before the run returns.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test defect] RED test's `fetch` server-up probe left a keep-alive socket that stalled teardown**
- **Found during:** Task 2 (first GREEN integration run)
- **Issue:** The plan's Task-1(b) probe used `fetch(url)` and read `res.ok` without draining the body. Node's `fetch` (undici) pools the sirv keep-alive socket; a lingering socket stalls sirv's graceful SIGTERM shutdown, which would keep the port bound past teardown and make the "server torn down after" assertion flaky.
- **Fix:** Probe with `node:http.get(url, { agent: false })` (one-off, un-pooled connection destroyed after the response) and drain via `res.resume()`. Production `onLivePage` (axe via the Playwright page) is unaffected — the browser's sockets close with `renderResult.close()` before teardown.
- **Files modified:** tests/runStack.integration.test.ts
- **Verification:** typecheck 0; probe leaves no lingering socket. (Full teardown assertion still gated by the env squatter below.)
- **Committed in:** `7c0886c`

**2. [Structural] Live-page assertions live in a sibling describe, not literally inside the happy-path describe**
- **Found during:** Task 1
- **Issue:** The happy-path describe's shared `beforeAll` runs a 3-arg run; `onLivePage` cannot be injected into it.
- **Fix:** Added a dedicated `prePopulated + onLivePage` describe with its own `beforeAll` (one extra real Angular build). Satisfies Task-1's acceptance (three `it` blocks referencing `prePopulated`, `onLivePage`, `stage==='start'`/`'render'`).
- **Committed in:** `fef147e`

---

**Total deviations:** 2 (1 Rule-1 test defect fix, 1 structural). No production-scope creep — both are test-shape refinements.
**Impact on plan:** None on the shipped runStack behavior. Both keep the tests faithful to the plan's intent.

## Issues Encountered

**ENVIRONMENT LIMITATION — port-4200 squatter blocks the two real-server teardown assertions (NOT a code defect).**

An orphaned **Phase-4 smoke-test** `sirv` server (running 8h+) is squatting on the fixed port 4200, launched by a leftover `nohup npx sirv dist/angular/browser --single --port 4200 &` script. Direct evidence captured during diagnosis:

```
LISTEN 127.0.0.1:4200  pid=690263  node .../tmp/smoke-686950/angular/node_modules/.bin/sirv ... --port 4200
  parent chain: /bin/bash -c "kill $(lsof -t -i:4200); ...; nohup npx sirv ... --port 4200 &"
```

Because that stale server always answers `200` on 4200, every run's `waitForHttp200` reports the server reachable regardless of the run's own (bind-failed) server. Consequently two assertions cannot pass while it is up:
1. `runStack.integration.test.ts` — "live page ... then teardown kills it": the post-run `fetch` still resolves 200 (stale server), so the "torn down after" half fails.
2. `runStack.integration.test.ts` — pre-existing "start/ready timeout leaves the port free": returns `completed` instead of `timeout` (sees the stale server).

The Claude Code safety classifier denied killing a process not created this session (untracked workload on a shared host), and the user was away, so the orchestrator authorized completing the plan with this recorded as an environment limitation. The `renderWithPage` swap is byte-identical for rendering and `killProcessTree` is unchanged from the Phase-2-proven teardown, so there is no evidence of a code-side regression; the live-page/eval-window HALF that does not depend on teardown ordering **passed** (callback fired once, `png.length>0`, page live, server reachable inside the callback).

**Re-run once port 4200 is freed** (`kill -9 $(lsof -t -i:4200)` / `pkill -9 -f tmp/smoke-686950`, then `lsof -t -i:4200` returns empty):
```
nvm exec 24.18.0 npx vitest run --config vitest.integration.config.ts --no-file-parallelism tests/runStack.integration.test.ts tests/isolation.selftest.test.ts
```
Expected: all `runStack.integration` assertions green (the 2 pending flip to pass) and `isolation.selftest` green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CLI-01 seam ready: `runStack(stack, runId, storage, { prePopulated, onLivePage })` is the additive primitive the Phase-5 orchestrator composes (05-02+). Teardown/outcome logic stays in one place.
- TEL-03 ready: `stage:'start'`/`'render'` start/completed/failed events are now in the log for the metrics projector (later plan) to fold into `startup_ms`/`render_ms`.
- **Carry-forward blocker:** free port 4200 (orphaned `tmp/smoke-686950` sirv) and re-run the two integration suites above to convert the two pending teardown assertions to green.

## Self-Check: PASSED

---
*Phase: 05-orchestrator-metrics-projector-reports*
*Completed: 2026-07-03*
