---
phase: 02-workspace-build-serve-runtime
plan: 06
subsystem: testing
tags: [vitest, playwright, execa, better-sqlite3, angular, integration-test, isolation]

# Dependency graph
requires:
  - phase: 02-workspace-build-serve-runtime (02-01 .. 02-05)
    provides: "runStack() pipeline, committed Angular template, RenderPort/Playwright, workspace copy/teardown, stage runner, env allowlist, StoragePort/SQLite artifact store"
provides:
  - "tests/runStack.integration.test.ts: real end-to-end proof runStack() against stacks/angular.yaml completes with a correctly-dimensioned screenshot, captured dist size, non-fatal lint/test, and correct build_failed/timeout/start_failed/timeout classifications + port-free teardown"
  - "tests/isolation.selftest.test.ts: hash-tree-before/after proof that a real runStack() call never mutates the main project tree"
affects: [phase-3-evaluation-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration tests construct in-memory Stack overrides (spread the real loaded spec) to force fast fatal-stage classifications instead of waiting out production-scale timeouts"
    - "Commands with no internal whitespace (e.g. `node -e setTimeout(()=>{},5000)`) pass safely through stage.ts's whitespace-only splitCommand without needing shell quoting, since execa invokes array-form with no shell"

key-files:
  created: [tests/runStack.integration.test.ts, tests/isolation.selftest.test.ts]
  modified: []

key-decisions:
  - "Verification of the combined two-file integration suite run with `--no-file-parallelism` (CLI flag, not a config-file edit): both files each run one real `sirv`/`npm start` on the spec's fixed port 4200, and Vitest's default file-level parallelism would otherwise race two real dev servers for the same port"
  - "Screenshot dimension assertion reads bytes via `storage.getArtifactPath()` (the StoragePort seam itself, per Plan 02-04's storagePort.test.ts round-trip pattern) rather than a raw DB query, since the port already exposes exactly that lookup"
  - "meta.json artifact (no id returned in RunOutcome) is read via a direct `SELECT path FROM artifacts WHERE run_id = ? AND kind = 'meta'` against the test's own tmp DB — the one place this suite queries the DB directly instead of through StoragePort"

patterns-established:
  - "Forced-failure Stack overrides always stub non-tested stages to instant-exit commands (`true`) so each test proves exactly one classification without paying for a real npm ci/ng build"

requirements-completed: [WORK-01, WORK-02, WORK-04, BUILD-01, BUILD-02, BUILD-03]

coverage:
  - id: D1
    description: "runStack against the real committed Angular template produces a completed outcome with a screenshot PNG whose dimensions equal the declared viewport (BUILD-03, ROADMAP SC#4)"
    requirement: "BUILD-03"
    verification:
      - kind: integration
        ref: "tests/runStack.integration.test.ts#creates workspace and completes the happy path"
        status: pass
      - kind: integration
        ref: "tests/runStack.integration.test.ts#screenshot dimensions equal the declared viewport at dpr=1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Non-fatal lint/test stages are recorded but never block the completed status; dist size is captured in meta.json (BUILD-01, BUILD-02)"
    requirement: "BUILD-01"
    verification:
      - kind: integration
        ref: "tests/runStack.integration.test.ts#non-fatal stages: lint/test do not block the screenshot"
        status: pass
      - kind: integration
        ref: "tests/runStack.integration.test.ts#dist size is captured in meta.json"
        status: pass
    human_judgment: false
  - id: D3
    description: "Forced install/build/start failures and timeouts each yield the correct distinct RunStatus + failedStage against the real pipeline (BUILD-01, ROADMAP SC#3)"
    requirement: "BUILD-01"
    verification:
      - kind: integration
        ref: "tests/runStack.integration.test.ts#install failure yields build_failed + failedStage install"
        status: pass
      - kind: integration
        ref: "tests/runStack.integration.test.ts#build timeout yields timeout + failedStage build"
        status: pass
      - kind: integration
        ref: "tests/runStack.integration.test.ts#start failure (process exits before ready) yields start_failed + failedStage start"
        status: pass
      - kind: integration
        ref: "tests/runStack.integration.test.ts#start/ready timeout yields timeout + failedStage start, and teardown leaves the port free"
        status: pass
    human_judgment: false
  - id: D4
    description: "After a real start-stage run, port 4200 is confirmed free via a real post-teardown fetch() attempt (WORK-04, ROADMAP SC#5 teardown half)"
    requirement: "WORK-04"
    verification:
      - kind: integration
        ref: "tests/runStack.integration.test.ts#start/ready timeout yields timeout + failedStage start, and teardown leaves the port free"
        status: pass
    human_judgment: false
  - id: D5
    description: "Running runStack against the real template leaves the main project tree byte-identical before and after (WORK-02, ROADMAP SC#1 isolation half)"
    requirement: "WORK-02"
    verification:
      - kind: integration
        ref: "tests/isolation.selftest.test.ts#runStack never mutates the main project tree"
        status: pass
    human_judgment: false

duration: 27min
completed: 2026-07-02
status: complete
---

# Phase 2 Plan 06: Real-Pipeline Integration Proof Summary

**All five ROADMAP Phase-2 success criteria proven end-to-end against the real committed Angular template and the real, unstubbed `runStack` pipeline — no mocks, no fixture scripts.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-07-02T02:49:00Z
- **Completed:** 2026-07-02T03:16:00Z
- **Tasks:** 3
- **Files modified:** 2 (both new)

## Accomplishments
- `tests/runStack.integration.test.ts` happy-path describe: one real `npm ci --ignore-scripts` → `ng build` → `ng lint` → `ng test` → `sirv` → Playwright screenshot run against `stacks/angular/template/`, asserting `status: "completed"`, `failedStage: null`, a PNG whose dimensions equal `stack.viewport` exactly, lint/test recorded as non-fatal, and `dist` byte size captured in `meta.json`.
- Same file's forced-failure describe: four in-memory `Stack` overrides (spread of the real loaded spec) prove `build_failed`/install, `timeout`/build, `start_failed`/start, and `timeout`/start in well under a second combined — plus a genuine post-teardown `fetch("http://localhost:4200")` that rejects, proving WORK-04's port-free guarantee against the real pipeline (not an inference from status alone).
- `tests/isolation.selftest.test.ts`: test-only `hashTree()` (per D2-06, no `src/` export) hashes the sorted project tree — excluding `node_modules`/`.git`/`tmp`/`results` — before and after a real `runStack()` call and asserts the hashes are identical, proving WORK-02.
- Confirmed via `ss -ltnp`/`ps aux` after the full suite: no stray port-4200 listener, no leftover `sirv`/`ng` processes, and `tmp/` holds only the persistent `.npm-cache` dir (no `run-*` residue).

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: happy-path + forced-failure integration tests** - `87d6ac4` (test) — both tasks land in the same file (`tests/runStack.integration.test.ts`); committed together since Task 2 is additive content in the same file verified as one unit.
2. **Task 3: isolation self-test** - `5fc2d97` (test)

**Plan metadata:** committed together with this SUMMARY (see final commit below).

## Files Created/Modified
- `tests/runStack.integration.test.ts` - Real end-to-end happy-path proof (screenshot dims, non-fatal stages, dist size, tmp deletion) + four forced-failure/timeout variants against real `Stack` overrides, including the WORK-04 port-free `fetch()` proof.
- `tests/isolation.selftest.test.ts` - `hashTree()` before/after a real `runStack()` call, proving the main project tree is never mutated.

## Decisions Made
- Ran the combined two-file verification command with Vitest's `--no-file-parallelism` CLI flag rather than editing `vitest.integration.config.ts`. Both files independently drive a real `sirv`/`npm start` on the spec's fixed port 4200 (v1 deliberately has no per-run port allocation, per 02-RESEARCH.md's D2-09 note deferring `get-port` to v2); Vitest's default file-level parallelism would otherwise race two real dev servers for the same port. This is a CLI invocation choice at verification time, not a change to any file outside the plan's declared scope.
- Used `storage.getArtifactPath()` (the `StoragePort` seam) for the screenshot-bytes round-trip instead of a raw DB query, matching `tests/storagePort.test.ts`'s established pattern and avoiding a redundant helper. The `meta.json` lookup still goes through a direct `SELECT ... WHERE kind = 'meta'` since `RunOutcome` doesn't return a meta-artifact id to round-trip through the port.
- Forced-timeout commands use `node -e setTimeout(()=>{},5000)` (no internal whitespace) rather than a quoted multi-token string, because `runtime/stage.ts`'s `splitCommand` is a plain `/\s+/` whitespace split with no shell/quote parsing (T-2-01, array-form only) — a quoted command would have split into broken tokens or passed literal quote characters into `node -e`. Verified directly against `execa` before writing the test.

## Deviations from Plan

None - plan executed exactly as written. All test file scope stayed within `tests/runStack.integration.test.ts` and `tests/isolation.selftest.test.ts`; no `src/` file was touched.

## Issues Encountered

None. The environment's Node-version constraint flagged in the plan (Angular CLI 22 requires Node >= 24.15.0; this env's default is v24.13.1) was handled exactly as instructed: all integration/isolation runs executed under `nvm exec 24.18.0`, and `buildAllowlistedEnv`'s passthrough `PATH` correctly carried the nvm-scoped Node into every spawned child (install/build/lint/test/start), so the real template built and served successfully under the allowlisted env with no workaround needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 2 (workspace-build-serve-runtime) is fully proven end-to-end: all five ROADMAP success criteria hold against the real Angular template and the real `runStack` pipeline, not stubs.
- Phase 3 (evaluation pipeline — PixelMatch/DOM-diff/axe-core/LLM Judge) can now build on a `runStack()` that reliably produces a `completed` outcome with a correctly-dimensioned screenshot artifact and captured build metrics.
- No blockers carried forward.

---
*Phase: 02-workspace-build-serve-runtime*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created files verified on disk; both task commits (87d6ac4, 5fc2d97) verified in `git log`.
