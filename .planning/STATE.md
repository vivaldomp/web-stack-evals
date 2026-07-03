---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 04
current_phase_name: agent-runtime-pi-sdk-adapter
status: executing
stopped_at: Phase 4 context gathered
last_updated: "2026-07-03T00:37:45.458Z"
last_activity: 2026-07-03
last_activity_desc: Phase 04 execution started
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 24
  completed_plans: 20
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-01)

**Core value:** Given the same standardized inputs, produce an objective, reproducible score for a (stack × model × scenario) run — end to end, without human judgment.
**Current focus:** Phase 04 — agent-runtime-pi-sdk-adapter

## Current Position

Phase: 04 (agent-runtime-pi-sdk-adapter) — EXECUTING
Plan: 3 of 6
Status: Ready to execute
Last activity: 2026-07-03 — Phase 04 execution started

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 18
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | - | - |
| 02 | 6 | - | - |
| 03 | 7 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 7min | 2 tasks | 10 files |
| Phase 01 P02 | 5min | 3 tasks | 10 files |
| Phase 01 P03 | 5min | 2 tasks | 3 files |
| Phase 01 P04 | 8min | 1 tasks | 2 files |
| Phase 01 P05 | 12min | 2 tasks | 3 files |
| Phase 02 P01 | 3min | 3 tasks | 8 files |
| Phase 02 P02 | 8min | 2 tasks | 26 files |
| Phase 02 P03 | 8min | 3 tasks | 8 files |
| Phase 02 P04 | 15min | 3 tasks | 4 files |
| Phase 02 P05 | 20min | 2 tasks | 4 files |
| Phase 02 P06 | 27min | 3 tasks | 2 files |
| Phase 03 P01 | 9min | 3 tasks | 6 files |
| Phase 03 P02 | 10min | 2 tasks | 4 files |
| Phase 03 P03 | 13min | 2 tasks | 8 files |
| Phase 03 P04 | 8min | 2 tasks | 6 files |
| Phase 03 P05 | 12min | 1 tasks | 2 files |
| Phase 03 P06 | 8min | 1 tasks | 2 files |
| Phase 03 P07 | 12min | 1 tasks | 1 files |
| Phase 04 P01 | 2min | 2 tasks | 4 files |
| Phase 04 P03 | 5min | 2 tasks | 7 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Deterministic-substrate-first build order — the paid/flaky agent lands last (Phase 4), after the pipeline is green on fixtures (Phases 1-3).
- Roadmap: v1 = one thin vertical slice (Angular + DeepSeek 4 Pro + dashboard); declarative + rep-keyed so v2 matrix needs no core changes.
- Roadmap: All metrics are projections folded from an append-only event log — never computed inline.
- [Phase 01-01]: tsconfig.json requires explicit "types": ["node"] for this TypeScript 6.0.3 install to auto-include @types/node ambient globals/module declarations
- [Phase 01-01]: AgentEvent variant type discriminants use snake_case (tool_call, file_mutation, stage_started/completed/failed, benchmark_finished, unknown)
- [Phase 01]: angular.bad.yaml single extra key is viewport.widht (typo of width) to drive the SPEC-01 strict-rejection test at the nested level
- [Phase 01]: ModelSchema.params is z.record(z.string(), z.unknown()) since provider params vary and are not fixed by this phase's contract
- [Phase 01-03]: Registry tables (stacks/models/scenarios) store the resolved spec as a single JSON column rather than typed columns per field, keeping the registry schema stable as spec shapes evolve
- [Phase 01-03]: appendEvent wraps its single prepared INSERT in db.transaction() per plan instruction, even though one statement is already atomic in SQLite - keeps the call shape ready for a future batch-append variant
- [Phase 01-04]: writeArtifact takes an optional resultsRoot param (default 'results' under cwd) purely for testability, keeping the plan's documented 5-arg call shape intact for real callers
- [Phase 01-04]: Stored artifact relative path is computed via node:path relative() against the resolved results root, not string concatenation, so normalization is always correct
- [Phase 01-05]: Skill-file component hash sorts by each file's own sha256 (not by filename) before concatenating, so the skills hash is deterministic regardless of caller read order
- [Phase 01-05]: persistManifest writes runs.status = 'pending' at manifest-persist time; the full D-19 outcome enum is written later by the run lifecycle, not this plan
- [Phase 02-01]: playwright/execa/pixelmatch/pngjs installed as production dependencies (not devDependencies) since the runtime pipeline and Phase 3's evaluator use them directly
- [Phase 02-01]: RenderPort lives in existing src/core/ports.ts per 02-CONTEXT.md D2-21, not a new render/renderPort.ts file
- [Phase 02-01]: RenderInput excludes deviceScaleFactor/reducedMotion/browser-channel -- fixed platform choices (D2-12) the concrete renderer hardcodes, not caller-configurable
- [Phase 02-02]: Scaffolded stacks/angular/template/ via scoped nvm exec 24.18.0 (Angular CLI 22.0.5 requires Node >=24.15.0, environment default is 24.13.1) without changing the environment default Node version
- [Phase 02-02]: Template start script invokes sirv directly (no npx hop); test script corrected to ng test --no-watch --no-progress since Vitest is Angular's default runner as of v21+, not Karma
- [Phase 02-03]: buildAllowlistedEnv excludes NODE_ENV entirely (corrects 02-RESEARCH.md Pattern 2) — NODE_ENV=production makes npm ci skip devDependencies, breaking sirv-cli/@angular/cli install — verified empirically during Plan 02-03 execution
- [Phase 02-03]: tests/storagePort.test.ts created despite being absent from the plan frontmatter's files_modified list — the plan's own Task 3 action and verification section require this test file
- [Phase 02-04]: pixelmatch's diff-output param passed as undefined not null -- shipped index.d.ts types it Uint8Array|Uint8ClampedArray|void, TS strict rejects null
- [Phase 02-05]: runStack never imports 'playwright' directly -- only createPlaywrightRenderer() from src/render/playwrightRenderer.ts, keeping RenderPort the sole seam (D2-21/D-23)
- [Phase 02-05]: Install/build/lint/test share one runAndRecordStage() helper for D-06 event emission + D2-19 logs; only install/build additionally trigger a fatal early return
- [Phase 02-05]: start_failed vs timeout classification resolved via a single Promise.race between waitForHttp200 and the subprocess's own settlement, avoiding manual polling/bookkeeping
- [Phase 02-06]: Integration/isolation suite verified against the real stacks/angular.yaml + committed template under nvm 24.18.0; combined two-file run uses --no-file-parallelism to avoid a port-4200 race between the two independent real dev-server runs
- [Phase 03-01]: Pinned sharp/@axe-core/playwright/@earendil-works/pi-ai to exact versions (no ^ range) matching project convention and CLAUDE.md's Pi-package lockstep-pinning directive
- [Phase 03-01]: src/storage/evaluations.ts follows artifacts.ts style (db as first param, module-level prepared SQL) -- not gated by D-23's core/ports.ts import restriction
- [Phase 03-02]: renderWithPage.ts closes browser/context on setup/navigation failure (catch-and-rethrow) to avoid leaking a Chromium process when no LiveRenderResult is ever returned
- [Phase 03-02]: renderWithPage.ts redefines NAVIGATION_BUDGET_MS/SETTLE_MS locally (same values as playwrightRenderer.ts) rather than importing them, since playwrightRenderer.ts is out of this task's declared file scope
- [Phase 03-03]: vitest.config.ts/vitest.integration.config.ts include/exclude globs extended with tests/**/*.live.test.ts so the gated live judge test is reachable only via the integration config and never runs under the default/CI suite
- [Phase 03-04]: app.html/app-clean.html both needed an explicit <h1> -- axe-core's page-has-heading-one rule fired on the originally-drafted 'clean' fixture, so both fixtures were corrected before the clean-fixture-scores-1 assertion could hold
- [Phase 03-05]: evaluateRun's one evaluator-specific branch (pixelmatch diffPng) is keyed to that evaluator's own OUTPUT shape, not a structural contract every future evaluator must satisfy -- satisfies D3-15/D3-07 simultaneously
- [Phase 03-06]: expectedElements: [] is treated the same as undefined -- both omit the dom evaluator (D3-09)
- [Phase 03-07]: fauxProvider registered under DEFAULT_JUDGE_MODEL's own provider/modelId so buildRegistry() can be called with the real production judge model constant while still resolving to a zero-network test double
- [Phase 04-01]: Extended tests/core.test.ts exhaustiveness switch with the three new AgentEvent variants — the union extension made TS2366 fire on the non-exhaustive describeEvent switch
- [Phase ?]: ScenarioSchema.budget uses explicit .default({maxMinutes:20,maxUsd:5,maxTurns:50}) — zod 4 types object-level default against full input shape; .default({}) fails tsc, explicit literal is behaviorally identical
- [Phase ?]: src/agent/types.ts is the Pi-free AgentInput/AgentBudget/AgentModelSpec boundary (D4-22); adapter narrows runSession against it, never reaches into spec loaders

### Pending Todos

None yet.

### Blockers/Concerns

- REQUIREMENTS.md coverage note said "33 total" but the actual v1 REQ-IDs count to 37; roadmap maps all 37 and the traceability/coverage figures were corrected to 37.
- Phase 4 (Pi SDK): exact event shapes + no-native-MCP gap firm up during planning — consider a de-risking spike (per research flags).
- Phase 3 (LLM Judge): judge-independence rule, rubric design, and bias mitigation need a design decision during planning.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-03T00:37:20.487Z
Stopped at: Phase 4 context gathered
Resume file: 
None
