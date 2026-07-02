---
phase: 02-workspace-build-serve-runtime
plan: 02
subsystem: infra
tags: [angular, sirv-cli, eslint, stack-spec, zod, vitest]

# Dependency graph
requires:
  - phase: 02-workspace-build-serve-runtime (plan 02-01)
    provides: "Widened Stage union, StackSchema lint/test + timeout fields, RenderPort seam, playwright/execa/pixelmatch/pngjs deps"
provides:
  - "stacks/angular/template/ — committed, buildable/lintable/testable Angular 22 skeleton with its own package-lock.json"
  - "stacks/angular.yaml — real production StackSchema spec pointing at the committed template"
affects: [02-03-workspace-runtime, 02-05-pipeline-runstack, 02-06-integration-tests]

# Tech tracking
tech-stack:
  added: ["@angular/cli@22.0.5 (scaffold-time only, not a platform dep)", "sirv-cli@3.0.1 (template devDependency)", "@angular-eslint/schematics (template devDependency)"]
  patterns:
    - "Template start script invokes sirv directly (no npx hop) so npm start resolves node_modules/.bin with zero extra process hops"
    - "stack.yaml command fields are plain npm run/npm verb strings so array-form execa in runStage resolves ng/sirv/eslint binaries via npm's own node_modules/.bin PATH handling"

key-files:
  created:
    - stacks/angular/template/package.json
    - stacks/angular/template/package-lock.json
    - stacks/angular/template/angular.json
    - stacks/angular/template/eslint.config.js
    - stacks/angular/template/src/** (ng new default app skeleton)
    - stacks/angular.yaml
  modified:
    - tests/specs.test.ts

key-decisions:
  - "Scaffolded stacks/angular/template/ under Node v24.18.0 via a scoped nvm exec, since @angular/cli 22.0.5 hard-requires Node ^22.22.3 || ^24.15.0 || >=26.0.0 and the environment's default Node is v24.13.1 — the environment's default Node version was never switched, only used for the scaffold/build/lint/test verification commands run against the template"
  - "start script serves dist/angular/browser directly via sirv (verified against angular.json's actual — implicit-default — outputPath), not via npx, per Pitfall 5"
  - "test script corrected to `ng test --no-watch --no-progress` (Vitest is Angular's default runner as of v21+, not Karma — the D2-16 example command in CONTEXT.md was stale per 02-RESEARCH.md Pitfall 2)"
  - "ng add @angular-eslint/schematics run once at scaffold time (Pitfall 3) since ng new ships no lint builder by default"

requirements-completed: [WORK-01, BUILD-01, BUILD-02]

coverage:
  - id: D1
    description: "stacks/angular/template/ is a committed, buildable Angular skeleton whose build output resolves to dist/angular/browser/index.html"
    requirement: "BUILD-01"
    verification:
      - kind: other
        ref: "npm run build (inside stacks/angular/template/) — confirmed dist/angular/browser/index.html exists"
        status: pass
    human_judgment: false
  - id: D2
    description: "ng lint and ng test both run one-shot and exit non-interactively with no watch-mode hang"
    requirement: "BUILD-02"
    verification:
      - kind: other
        ref: "npm run lint (exit 0, 'All files pass linting') and npm test (exit 0, 2 tests passed) — both single-shot, no watcher"
        status: pass
    human_judgment: false
  - id: D3
    description: "stacks/angular.yaml is a real, loadable StackSchema-conformant production spec whose commands resolve 1:1 onto the committed template's package.json scripts"
    requirement: "WORK-01"
    verification:
      - kind: unit
        ref: "tests/specs.test.ts#loadStack (production stacks/angular.yaml) > parses the real Angular stack spec and matches the declared field values"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 2 Plan 2: Angular Template + Production Stack Spec Summary

**Committed a real, buildable/lintable/testable Angular 22 skeleton at `stacks/angular/template/` (sirv-served, esbuild `dist/angular/browser/` output) and the production `stacks/angular.yaml` StackSchema spec that declares its commands correctly for the current Angular toolchain.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T02:22:00Z
- **Completed:** 2026-07-02T02:30:11Z
- **Tasks:** 2
- **Files modified:** 26 (24 new template files, 1 new stacks/angular.yaml, 1 modified test file)

## Accomplishments
- Scaffolded `stacks/angular/template/` via `ng new` (Angular CLI 22.0.5), with routing, CSS styles, `--skip-git`, and committed `package-lock.json` as the version pin (D2-01/D2-02)
- Wired `sirv-cli` 3.0.1 as a template devDependency; `start` script serves `dist/angular/browser` directly with no `npx` hop (D2-08, Pitfall 1/5)
- Ran `ng add @angular-eslint/schematics` once at scaffold time so `ng lint` works out of the box (Pitfall 3)
- Corrected the `test` script to `ng test --no-watch --no-progress` (Vitest is the current default runner, not Karma — Pitfall 2)
- Verified `npm run build`/`npm run lint`/`npm test`/`npm start` all behave correctly: build writes `dist/angular/browser/index.html`, lint and test exit 0 non-interactively, and `npm start` serves HTTP 200 on :4200
- Wrote the real production `stacks/angular.yaml` (template/install/build/lint/test/start/port/viewport per D2-03/D2-09, matching the dashboard scenario's 1280x800 viewport) and a `loadStack` wiring assertion in `tests/specs.test.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold the committed Angular template** - `5ad3430` (feat)
2. **Task 2: Write the real production stacks/angular.yaml spec** - `7dae566` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `stacks/angular/template/package.json` - build/lint/test/start scripts (start invokes sirv directly, test is one-shot)
- `stacks/angular/template/package-lock.json` - the Angular version pin (D2-02)
- `stacks/angular/template/angular.json` - workspace config; default `@angular/build:application` builder (no explicit outputPath override — confirmed default is `dist/angular/browser/`)
- `stacks/angular/template/eslint.config.js` - added by `ng add @angular-eslint/schematics`
- `stacks/angular/template/src/**` - `ng new` default application skeleton (app.ts, app.html, app.routes.ts, main.ts, index.html, styles.css)
- `stacks/angular.yaml` - production StackSchema spec: `template: stacks/angular/template`, `install: npm ci --ignore-scripts`, `build/lint/test/start: npm run <script>`/`npm <verb>`, `port: 4200`, `viewport: {1280, 800}`
- `tests/specs.test.ts` - added `loadStack("stacks/angular.yaml")` wiring assertion (9 tests total, all passing)

## Decisions Made
- Used a scoped `nvm exec 24.18.0` for the Angular CLI scaffold/build/lint/test commands rather than switching the environment's default Node version, since `@angular/cli@22.0.5` hard-blocks below Node v24.15.0 but the platform's own default is v24.13.1 (Node engine requirement is scaffold-tool-only; the platform's own runtime requirements — `package.json` `engines.node: ">=24"` — are unaffected since `ng`/`sirv`/`eslint` run as external subprocesses via `runStage`, never as an in-process Node API)
- `outputPath` in `angular.json` is left at its implicit default (no override) since the default `@angular/build:application` output (`dist/angular/browser/`) already matches what the `start` script and `stacks/angular.yaml` need — no customization required

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Angular CLI 22.0.5's Node engine requirement blocks the default environment Node version**
- **Found during:** Task 1 (Scaffold the committed Angular template)
- **Issue:** `npx @angular/cli@latest new ...` refused to run under the environment's default Node v24.13.1 ("The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0")
- **Fix:** Installed Node v24.18.0 via the already-present `nvm` (an LTS Krypton patch release satisfying the CLI's requirement) and ran the scaffold/build/lint/test commands under a scoped `nvm exec 24.18.0 <cmd>` invocation, without changing the environment's default `nvm` alias or `node` binary
- **Files modified:** none (environment-only fix; no repo files touched by this step)
- **Verification:** `ng new` completed successfully; `npm run build`/`lint`/`test` all pass under the same scoped Node version
- **Committed in:** 5ad3430 (Task 1 commit — the fix itself produced no file changes, only enabled the commit's contents to be generated)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to complete Task 1 at all; no scope creep — no plan file/behavior was changed beyond what D2-01/D2-02 already specified.

## Issues Encountered
None beyond the Node-engine blocker documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `stacks/angular/template/` and `stacks/angular.yaml` are the prerequisite every Plan 02-06 integration test copies and runs — both are committed, buildable, lintable, testable, and servable exactly as declared
- The `start` script's process-tree teardown (WORK-04, `execa` `detached` + group-kill) is out of scope for this plan and lands in Plan 02-03's `runStage`/`runStack` implementation, which invokes this template's `npm start` as a subprocess it fully controls
- No blockers for Plan 02-03 (Workspace Runtime) or downstream plans

---
*Phase: 02-workspace-build-serve-runtime*
*Completed: 2026-07-02*

## Self-Check: PASSED
