---
phase: 02-workspace-build-serve-runtime
plan: 03
subsystem: infra
tags: [execa, node-fs, better-sqlite3, process-isolation, workspace-copy]

# Dependency graph
requires:
  - phase: 02-01
    provides: RenderPort seam, widened Stage union, runtime deps installed (execa/playwright/pixelmatch/pngjs)
  - phase: 02-02
    provides: committed Angular template + stacks/angular.yaml (install/build/start commands this stage runner will spawn)
  - phase: 01 (Foundations & Contracts)
    provides: StoragePort interface, AgentEvent/Stage union, db-taking writeArtifact/appendEvent/persistManifest functions
provides:
  - copyWorkspace/cleanupWorkspace — disposable tmp/<run_id>/angular/ workspace with D2-05 retention
  - buildAllowlistedEnv — D2-04 default-deny 5-key env allowlist (no NODE_ENV)
  - runStage/startServer/killProcessTree — timeout-guarded array-form stage runner + process-group teardown
  - createStoragePort — adapter from Phase-1 db-taking storage functions to the StoragePort interface
affects: [02-04, 02-05, 02-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Array-form execa only (never shell:true) for every spawned stage command — T-2-01"
    - "extendEnv:false + explicit allowlisted env object on every execa call — never spread process.env"
    - "detached:true + negative-pid process-group kill for the long-running start stage (WORK-04)"
    - "Adapter shims a numeric-vs-string id mismatch at a single seam instead of touching the Phase-1 file it wraps"

key-files:
  created:
    - src/workspace/copy.ts
    - src/workspace/teardown.ts
    - src/runtime/env.ts
    - src/runtime/stage.ts
    - src/storage/storagePort.ts
    - tests/workspace.test.ts
    - tests/stage.test.ts
    - tests/storagePort.test.ts
  modified: []

key-decisions:
  - "buildAllowlistedEnv excludes NODE_ENV entirely (correction to 02-RESEARCH.md's Pattern 2 example): NODE_ENV=production would make npm ci skip devDependencies, silently breaking sirv-cli/@angular/cli install for the Angular template"
  - "tailCap is exported from src/runtime/stage.ts (not listed in the plan's declared exports) so tests/stage.test.ts can exercise it directly with a small test cap, per the plan's own task action"
  - "tests/storagePort.test.ts created even though absent from the plan frontmatter's files_modified list — the plan's own Task 3 action and <verification> section both require it"

patterns-established:
  - "Pattern 1: Timeout-guarded stage runner — execa array-form + timeout + reject:false + all:true + tail-capped combined log, never throws past the caller"
  - "Pattern 2: Env allowlist builder — fixed 5-key object built fresh per call, never process.env spread"
  - "Pattern 5: Process-tree teardown — detached:true + process.kill(-pid, SIGTERM) + forceKillAfterDelay backstop"

requirements-completed: [WORK-01, WORK-02, WORK-03, WORK-04]

coverage:
  - id: D1
    description: "copyWorkspace copies a template into tmp/<run_id>/angular/, excludes node_modules, and leaves the source template byte-identical"
    requirement: "WORK-01"
    verification:
      - kind: unit
        ref: "tests/workspace.test.ts#copyWorkspace copies template files into tmp/<runId>/angular, excludes node_modules, leaves source untouched"
        status: pass
    human_judgment: false
  - id: D2
    description: "cleanupWorkspace keeps tmp/<run_id>/ on failure (keep:true) and removes it idempotently on success (keep:false)"
    requirement: "WORK-02"
    verification:
      - kind: unit
        ref: "tests/workspace.test.ts#cleanupWorkspace removes the run dir when keep is false, and is idempotent on a missing dir"
        status: pass
      - kind: unit
        ref: "tests/workspace.test.ts#cleanupWorkspace keeps the run dir when keep is true"
        status: pass
    human_judgment: false
  - id: D3
    description: "buildAllowlistedEnv returns exactly the 5 default-deny keys (PATH, HOME, npm_config_cache, npm_config_ignore_scripts, CI) and never NODE_ENV"
    requirement: "WORK-03"
    verification:
      - kind: unit
        ref: "tests/stage.test.ts#buildAllowlistedEnv returns exactly the 5 allowlisted keys and excludes NODE_ENV"
        status: pass
    human_judgment: false
  - id: D4
    description: "runStage spawns array-form execa, enforces timeoutMs without throwing, and tail-caps the combined log"
    requirement: "WORK-03"
    verification:
      - kind: unit
        ref: "tests/stage.test.ts#runStage returns exitCode 0 and captured stdout on a fast successful command"
        status: pass
      - kind: unit
        ref: "tests/stage.test.ts#runStage returns timedOut true and a nonzero exitCode for a command exceeding timeoutMs, without throwing"
        status: pass
      - kind: unit
        ref: "tests/stage.test.ts#tailCap keeps only the tail bytes when text exceeds the cap"
        status: pass
    human_judgment: false
  - id: D5
    description: "startServer/killProcessTree kill the whole POSIX process group, reaching a grandchild the started process spawned"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "tests/stage.test.ts#startServer / killProcessTree kills the whole process group, including a grandchild spawned by the started process"
        status: pass
    human_judgment: false
  - id: D6
    description: "createStoragePort adapts Phase-1 db-taking storage functions to the StoragePort interface without modifying any Phase-1 file"
    verification:
      - kind: unit
        ref: "tests/storagePort.test.ts#createStoragePort writeArtifact returns a string id that round-trips through getArtifactPath"
        status: pass
      - kind: unit
        ref: "tests/storagePort.test.ts#createStoragePort appendEvent + readEvents round-trip losslessly"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 2 Plan 3: Workspace Copy/Retention + Env-Allowlisted Stage Runner + StoragePort Adapter Summary

**Disposable tmp/<run_id>/angular/ workspace copy with D2-05 retention, a default-deny env-allowlisted timeout-guarded array-form execa stage runner with process-group teardown, and a StoragePort adapter over Phase 1's db-taking storage functions — the stack-agnostic runtime substrate Plan 02-05's runStack will assemble.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-01T23:37:00-03:00
- **Completed:** 2026-07-01T23:41:39-03:00
- **Tasks:** 3
- **Files modified:** 8 (all created, none modified)

## Accomplishments
- `copyWorkspace`/`cleanupWorkspace`: isolated-by-construction workspace copy (paths derived only from `runId`), excludes `node_modules`, keeps the workspace on failure and deletes it idempotently on success (D2-05/D2-06)
- `buildAllowlistedEnv`/`runStage`/`startServer`/`killProcessTree`: default-deny 5-key env allowlist (corrected to exclude `NODE_ENV`), array-form-only timeout-guarded stage runner with tail-capped logging, and POSIX process-group teardown that reaches spawned grandchildren
- `createStoragePort`: adapts Phase 1's concrete `db`-taking `appendEvent`/`readEvents`/`writeArtifact`/`getArtifactPath`/`persistManifest` to the `StoragePort` interface, shimming only the numeric/string artifact-id mismatch, with `src/storage/artifacts.ts`/`db.ts` and `src/manifest/manifest.ts` left byte-identical

## Task Commits

Each task was committed atomically (Tasks 1 and 2 are `tdd="true"` — RED then GREEN):

1. **Task 1: Workspace copy + retention** - `5d044ab` (test, RED) → `a1ea5b3` (feat, GREEN)
2. **Task 2: Env allowlist + stage runner + process-group teardown** - `8bf0e65` (test, RED) → `ad75ee1` (feat, GREEN) → `4fe2d63` (fix, post-verification)
3. **Task 3: StoragePort adapter** - `4f5d45f` (feat)

**Plan metadata:** (this commit, created after this SUMMARY)

## Files Created/Modified
- `src/workspace/copy.ts` - `copyWorkspace(templateDir, runId, tmpRoot)` — cpSync-based copy into `tmp/<runId>/angular/`, node_modules excluded via filter
- `src/workspace/teardown.ts` - `cleanupWorkspace(runId, keep, tmpRoot)` — D2-05 retention, idempotent rmSync
- `src/runtime/env.ts` - `buildAllowlistedEnv(npmCacheDir)` — 5-key default-deny env, no NODE_ENV
- `src/runtime/stage.ts` - `runStage`/`startServer`/`killProcessTree`/`tailCap`/`StageOutcome` — timeout-guarded array-form execa stage runner + process-group teardown
- `src/storage/storagePort.ts` - `createStoragePort(db, resultsRoot)` — StoragePort adapter over Phase-1 storage functions
- `tests/workspace.test.ts` - copy/cleanup unit tests (3 tests)
- `tests/stage.test.ts` - env allowlist, tailCap, runStage happy/timeout paths, process-group teardown (6 tests)
- `tests/storagePort.test.ts` - adapter round-trip tests (3 tests)

## Decisions Made
- `buildAllowlistedEnv` excludes `NODE_ENV` entirely, correcting 02-RESEARCH.md's Pattern 2 example and D2-04's illustrative list — `NODE_ENV=production` makes `npm ci` skip `devDependencies`, and `sirv-cli`/`@angular/cli` are devDependencies of the Angular template (Plan 02-02). This was flagged explicitly in the plan itself and implemented as specified.
- Exported `tailCap` from `src/runtime/stage.ts` even though it isn't in the plan's declared `exports` list, because the plan's own Task 2 action explicitly requires `tests/stage.test.ts` to "exercise the tail-cap helper directly with a string longer than a small test cap" — that's only possible if the helper is exported.
- Created `tests/storagePort.test.ts` even though it's absent from the plan frontmatter's `files_modified` list — Task 3's action and the plan's own `<verification>` section both name this file and require it green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unhandled promise rejection in `startServer`**
- **Found during:** Task 2, while running the full `npx vitest run` suite after Task 3 landed (the bug only surfaces as a process-level unhandled rejection, not a per-file test failure, so it wasn't visible running `tests/stage.test.ts` alone in isolation the first time — it showed up when running the whole suite)
- **Issue:** `execa`'s returned `subprocess` is itself a promise that rejects on SIGTERM/non-zero exit. `startServer` returns that handle without ever being awaited by its caller (by design — the process is long-running), so when `killProcessTree` sends SIGTERM, the promise rejects with no `.catch()` anywhere, surfacing as an unhandled rejection that Vitest reports as a process-level error (and which Node treats as fatal outside a test harness).
- **Fix:** Added `subprocess.catch(() => {})` immediately after creating the subprocess in `startServer`, marking the promise's rejection handled without altering the returned handle callers use for `.pid`/`.kill()`.
- **Files modified:** `src/runtime/stage.ts`
- **Verification:** `npx vitest run` (full suite, run twice) — 41/41 tests pass, zero unhandled-rejection errors.
- **Committed in:** `4fe2d63`

**2. [Rule 3 - Blocking] Reworded a doc comment that literally contained the string `shell: true`**
- **Found during:** Task 2, running the plan's own acceptance-criteria grep (`grep -c 'shell: true' src/runtime/stage.ts` must return 0)
- **Issue:** A doc comment explaining that the `shell` option is never set literally contained the substring `shell: true` (documenting what NOT to do), which the acceptance-criteria grep can't distinguish from actual usage.
- **Fix:** Reworded the comment to "the `shell` option is never set" — same meaning, no longer matches the grep pattern.
- **Files modified:** `src/runtime/stage.ts`
- **Verification:** `grep -c 'shell: true' src/runtime/stage.ts` returns `0`.
- **Committed in:** `ad75ee1`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking acceptance-criteria conflict)
**Impact on plan:** Both fixes necessary for correctness/verification. No scope creep — no files touched outside the plan's declared scope.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `copyWorkspace`/`cleanupWorkspace`, `buildAllowlistedEnv`/`runStage`/`startServer`/`killProcessTree`, and `createStoragePort` are all independently unit-tested and ready for Plan 02-05's `runStack` to assemble into the full install → build → start → screenshot pipeline.
- Plan 02-04 (readiness gate + determinism controls) and Plan 02-05 (pipeline orchestration) can now import these modules directly.
- No blockers.

---
*Phase: 02-workspace-build-serve-runtime*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 8 created files verified present on disk; all 6 task commits (`5d044ab`, `a1ea5b3`, `8bf0e65`, `ad75ee1`, `4fe2d63`, `4f5d45f`) verified present in `git log --oneline --all`.
