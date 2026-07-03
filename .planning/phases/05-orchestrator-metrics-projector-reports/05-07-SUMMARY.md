---
phase: 05-orchestrator-metrics-projector-reports
plan: 07
subsystem: cli
status: complete
tags: [cli, bench, parseArgs, traversal-gate, exit-codes, tdd, D5-03, D5-06, D5-08, T-05-01, T-05-02]

# Dependency graph
requires:
  - phase: 05-06
    provides: "runBenchmark(args, deps) → RunResult; opens+closes its own db from deps.dbPath, never throws on a scored terminal"
  - phase: 05-05
    provides: "renderReport(db, runId, resultsRoot?) → self-contained HTML string"
  - phase: 05-04
    provides: "projectMetrics folds wall_ms/cost_usd/total_tokens/iteration_count the summary reads"
  - phase: 01-03
    provides: "openDb + runs/evaluations/metrics/iterations schema the reads bind against"
provides:
  - "bench CLI: run (execute + summary + auto-emit report.html + exit-code map) and report [<id>] [--latest] (regenerate) — CLI-01/CLI-02/REPORT-01"
  - "src/cli/cli.ts pure core: resolveSpecPath (traversal gate), readRunSummary, latestRunId, formatSummary, runCli — injectable, paid-call-free"
affects: []

tech-stack:
  added: []
  patterns:
    - "Testable CLI core: cli.ts imports NO orchestrator/renderer — both arrive via injected deps, so the suite is pure and paid-call-free; index.ts is the sole owner of the real imports + process.exit"
    - "runCli returns a numeric exit code (never process.exit); D5-08 maps scored row→0, harness throw/unknown-id/empty-DB→non-zero"
    - "Fixed-path spec resolution behind a charset gate (^[A-Za-z0-9_-]+$): validate before building stacks/<n>.yaml | models/<n>.json | scenarios/<n>/<n>.yaml (T-05-01)"

key-files:
  created:
    - src/cli/cli.ts
    - src/cli/index.ts
    - tests/cli.test.ts
  modified:
    - package.json

key-decisions:
  - "formatSummary labels are caller-supplied: `run` passes the flag values verbatim (angular/deepseek4pro/dashboard); `report` derives them from the stored manifest (stack.template / versionStamp.modelId / scenario expected-dir) via readRunSummary.names — specs carry no `name` field (inherited from 05-05)"
  - "readRunSummary resolves iteration_count with a COUNT(*) of iterations rows fallback when the folded metric is absent, matching the projector's own naming"
  - "report opens its OWN fresh read-side handle and run reopens a fresh handle after runBenchmark returns — each subcommand owns one handle it closes in finally; runBenchmark is only ever handed dbPath, never an open db (05-06 contract)"

# Metrics
duration: 6min
completed: 2026-07-03
tasks: 3
files: 4
requirements-completed: [REPORT-01, CLI-01, CLI-02]
---

# Phase 5 Plan 07: bench CLI (run / report) Summary

**The user-facing `bench` CLI — a thin wrapper over the 05-06 orchestrator and 05-05 HTML renderer. `run --stack <s> --model <m> --scenario <sc>` executes one benchmark row, prints the D5-03 six-line terminal summary, auto-writes + echoes `results/<run_id>/report.html` (D5-07), and exits 0 on any scored row / non-zero only on a harness error (D5-08). `report [<run_id>] [--latest]` regenerates the summary + report for a specific or newest stored run (D5-06). Spec flags pass a `^[A-Za-z0-9_-]+$` traversal gate before any path is built (T-05-01); error copy is clean one-liners, never a stack trace (T-05-02).**

## What was built

- **`src/cli/cli.ts`** — the pure, injectable core (no orchestrator/renderer import):
  - `resolveSpecPath(kind, name)` — the path-traversal gate (T-05-01/D5-02): reject slashes, dots, `..`, whitespace, and empty **before** constructing the fixed `stacks/<name>.yaml` / `models/<name>.json` / `scenarios/<name>/<name>.yaml`; the error names the flag and leaks no resolved path.
  - `readRunSummary(db, runId)` — bound-param SELECTs folding runs (status/failed_stage/composite/manifest) + evaluations (evaluator→raw_score) + metrics (with an `iteration_count` COUNT(*)-of-iterations fallback) into a `RunSummary`, plus manifest-derived display names. Returns `null` for an absent row.
  - `latestRunId(db)` — `ORDER BY started_at DESC LIMIT 1`, `null` on empty DB (D5-06).
  - `formatSummary(summary, labels, reportPath)` — the D5-03 block: header (`stack × model × scenario` + run_id), status pill (`SCORED` / `CAPPED · timeout` / `FAILED · {stage}`), composite (2 dp or `—`), four sub-scores (`pixelmatch dom a11y judge`, a11y→`axe`, `—` for absent), one headline line (`wall …s · $… · …k tok · … iters`), and `Report: <path>`. Presentation-only rounding (D-26); a failed/capped run still renders folded metrics (D5-05).
  - `runCli(argv, deps)` — `node:util parseArgs` dispatch. `run` → resolve×3 → `runBenchmark({stackPath,modelPath,scenarioPath}, {dbPath,resultsRoot})` → reopen a fresh read handle → summary + emit report.html → print → `0`; harness throw → clean message → non-zero, no report.html. `report` → open handle → positional id else `latestRunId` → unknown-id / empty-DB copy → non-zero, else summary + emit + `0`. Returns the code; never calls `process.exit`.
- **`src/cli/index.ts`** — the `bench` bin shim: shebang `#!/usr/bin/env -S npx tsx`, the ONLY importer of the real `runBenchmark` (05-06) + `renderReport` (05-05) + `openDb`, assembles `realDeps` with canonical `dbPath: results/bench.sqlite` / `resultsRoot: results`, and is the sole owner of `process.exit(code)`.
- **`package.json`** — `bin: { bench: "src/cli/index.ts" }` + a `bench: "tsx src/cli/index.ts"` script (no build step; parseArgs is stdlib — no new deps, D-23).
- **`tests/cli.test.ts`** — 19 unit tests (RED-first), fully paid-call-free: no orchestrator/renderer import, fakes injected via deps, real temp-file `dbPath` so runBenchmark and runCli each open the same file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — mitigation gap, T-05-02] Hardened `report` against an absent/unopenable results DB**
- **Found during:** Task 3 (smoke-testing the shim)
- **Issue:** `report` opened `deps.openDb(deps.dbPath)` outside its try; running `bench report` before any `bench run` (so `results/` does not exist) let better-sqlite3's `Cannot open database because the directory does not exist` propagate as a raw stack trace — violating the T-05-02 mitigation ("clean one-line message, no stack traces") this plan owns.
- **Fix:** Wrapped the open in a try/catch that emits the empty-DB copy ("No runs found…") and returns non-zero — an absent/unopenable results DB is semantically "no stored runs to report". Added a test asserting the copy prints with no `Error:`/`.ts:<line>` stack leak.
- **Files modified:** src/cli/cli.ts, tests/cli.test.ts
- **Commit:** 0e7a12f

No other deviations. `run`'s openDb was already inside its try, so a dir-missing throw there already degrades to a clean message + non-zero.

## Verification

- `npx vitest run tests/cli.test.ts` → 19/19 GREEN: valid spec resolution + 6 traversal rejections (no leaked path), latestRunId (incl. empty→null), scored + build_failed summary formatting (D5-03/D5-05), iteration_count COUNT(*) fallback, absent-row→null, and runCli exit-code mapping (0 scored / 0 build_failed-but-scored / non-zero harness-throw with no report.html / non-zero unknown-id / non-zero empty-DB / non-zero absent-DB with no stack trace / 0 report --latest).
- `npm run typecheck` (`tsc --noEmit`) → clean.
- `npm test` (full suite) → 176/176 pass, 31 files — no regressions (was 157 pre-plan; +19 CLI tests).
- Bin shim smoke: `npx tsx src/cli/index.ts` (no args) → usage + exit 1; `bench report --latest` on a fresh cwd → "No runs found" + exit 1 (clean).
- Manual-only (gated, needs DEEPSEEK_API_KEY + ANTHROPIC_API_KEY per 05-VALIDATION) — NOT run in CI: `tsx src/cli/index.ts run --stack angular --model deepseek4pro --scenario dashboard`.

## Known Stubs

None.

## Threat Flags

None. The CLI adds no new network/auth surface: `<run_id>` reaches SQLite via bound params only; spec flags pass the T-05-01 charset gate before any path build; error copy is fixed one-liners (T-05-02). Report writes stay under `results/<run_id>/` for stored, self-generated run ids only (T-05-03).

## Self-Check: PASSED
