# Phase 5: Orchestrator + Metrics Projector + Reports - Research

**Researched:** 2026-07-03
**Domain:** Node/TS CLI orchestration — sequencing already-built ports into one benchmark row, folding the event log into projection tables, rendering a terminal summary + self-contained HTML report.
**Confidence:** HIGH on the codebase seams and fold arithmetic (read from source); MEDIUM on Pi SDK retry-event shape (D5-12); the three seam gaps below are HIGH-confidence blockers that need a planning decision.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D5-01 … D5-12, all user-confirmed 2026-07-03)
- **D5-01** — Keep DeepSeek 4 Pro as the named v1 model. Image injection is **capability-conditional**: if the resolved Pi model registry entry does not declare `input: ["image"]`, do **not** inject the mockup. Surface the visual-fidelity caveat in the report. Scoring is unaffected (the judge diffs screenshots on its own vision model).
- **D5-02** — `run` invocation is **named spec flags**: `run --stack angular --model deepseek4pro --scenario dashboard`. Each flag names a spec file under `stacks/` / `models/` / `scenarios/`.
- **D5-03** — Terminal summary = compact scores + headline-metrics block (composite, four sub-scores, run status, one-line headline: wall/cost/tokens/iterations). Full breakdown lives only in the HTML report.
- **D5-04** — HTML report = self-contained post-mortem: side-by-side expected/generated/diff screenshots, scorecard (composite + sub-score bars), complete folded-metrics table, collapsible agent narration + tool-call timeline (fed by D4-12 `unknown` narration payloads).
- **D5-05** — A capped/`build_failed`/`start_failed` run is a **scored data point, not an error screen**. Summary + report render status + whatever metrics folded; the row still persists complete.
- **D5-06** — `report <run_id>` renders a specific stored run; bare `report` / `--latest` renders the most recent.
- **D5-07** — After a run, print the compact summary **and** write `results/<run_id>/report.html`, echoing the path. `report` regenerates the same file.
- **D5-08** — `run` exits **0 whenever it produced a scored row** (incl. build_failed/start_failed/timeout). Non-zero **only** for harness failure (unresolvable spec, DB write error, uncaught crash).
- **D5-09** — Screenshots embedded **inline as base64 data URIs** — one portable `.html`, no sibling files, no network.
- **D5-10** — Re-running the same stack+model+scenario **appends a new rep-keyed row**; never overwrite. v1 always writes a rep and reports the latest.
- **D5-11** — A **correction = any 2nd-or-later `file_mutation` on the same path** (every repeated write after the first). Purely event-derived, ordered by `seq`. No dependency on stage outcome.
- **D5-12** — Backoff/rate-limit wait time is its **own metric** (`backoff_wait_ms`), attributed separately from productive wall time, folded from the D4-14 retry/backoff events.

### Claude's Discretion (mechanical — planner decides)
- Exact fold arithmetic once D5-11/D5-12 definitions are applied (ordering, summation windows).
- Projector shape: one `projectMetrics(runId)` pass vs per-metric folders; read via `StoragePort.readEvents` vs SQL folds over promoted `events` columns.
- CLI framework: commander (per CLAUDE.md) vs native `node:util parseArgs`; `bin` wiring.
- HTML templating approach (string template vs tiny helper) — no runtime framework; static, self-contained.
- Where the orchestrator lives (`src/orchestrator/` vs `src/cli/`) and how it threads run_id.
- Exact D5-01 capability-probe mechanics and report caveat wording.

### Deferred Ideas (OUT OF SCOPE)
Matrix/multi-row reports, leaderboards, heatmaps (v2); Markdown/CSV export (v2); live-streaming dashboard (out of scope); swapping the v1 model to a vision model (not chosen); Lighthouse perf/a11y (v2).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|--------------------------------------------|------------------|
| TEL-02 | Metrics are projections folded from the event log (never computed inline) | Projector reads `readEvents(runId)` **after** the run; orchestrator only `appendEvent`s. Validation: projection tables empty until `projectMetrics` runs. |
| TEL-03 | Performance metrics (wall/build/startup/render), rate-limit/backoff attributed separately | Fold from `stage_completed` durations + `session_started`/`first_token`/`benchmark_finished` ts + `usage`; `backoff_wait_ms` from `unknown` auto-retry events. **Gap: startup/render are not separate events** (see Telemetry Gaps). |
| TEL-04 | Engineering metrics (files created/edited, lines +/−) | Fold from `file_mutation` events (`op`, `path`, `linesAdded`, `linesRemoved`). Line counts are best-effort (may be 0). |
| TEL-05 | Iteration count + correction density | Iterations = count of `usage` events (one per turn). Corrections = D5-11 fold over `file_mutation` by `path`, `seq`-ordered. |
| TEL-06 | Tool-call counts by type (read/write/edit/bash/grep/find/mcp) | Group `tool_call` events by `toolName`; `call_count`, `error_count = count(isError)`. |
| REPORT-01 | CLI terminal summary (composite + sub-scores + key metrics) | Read `runs` + `evaluations` + projected `metrics`; format per UI-SPEC §Terminal summary. |
| REPORT-02 | Static HTML report with side-by-side expected/generated diff, scores, metrics | String template + base64-inline images; data from `runs`/`evaluations`/`metrics`/`tool_calls`/`iterations`/`artifacts`/`screenshots`/`events`. |
| CLI-01 | `run` executes one benchmark row from specs end-to-end | Orchestrator sequences load→manifest→agent→build/render→evaluate→score→project→summary+report. |
| CLI-02 | `report` regenerates the HTML report from stored results | Read a stored run by id (or latest) → render the same template. |
</phase_requirements>

## Summary

Phase 5 is glue over ports **in principle**, but reading the actual Phase 1–4 code surfaces **three concrete seams that do not compose as CONTEXT.md assumes**. All three are HIGH-confidence and must be resolved before/while planning:

1. **Workspace clobber.** `runStack` (src/pipeline/runStack.ts:58) begins by `copyWorkspace(stack.template, runId)` which `cpSync`-copies the pristine template into `tmp/<runId>/angular/`. The CONTEXT flow ("agent mutates `tmp/<run_id>/angular/`, then `runStack` builds that mutated workspace") is **broken by this copy** — runStack would overlay the pristine skeleton over the agent's work and build the template, not the agent's app.
2. **Live page for axe.** Evaluation (`evaluateRun`, src/pipeline/evaluate.ts) requires a **live Playwright `page`** for the axe evaluator (unconditional in `buildRegistry`). But `runStack` screenshots with the tear-down renderer and then `killProcessTree`s the server + `cleanupWorkspace`s the tmp dir in its `finally`. After `runStack` returns, **there is no running server and no workspace to re-serve** — axe cannot run.
3. **`runs` row status never updated.** `persistManifest` inserts the row with `status='pending'`; only `updateRunComposite` touches it afterward (composite only). **Nothing sets `runs.status`/`failed_stage`/`finished_at`.** The orchestrator must write the terminal row state from the `RunOutcome`/`benchmark_finished` event, or every row stays `pending`.

**Primary recommendation:** Resolve gaps 1+2 with the smallest additive change to the build/render pipeline: refactor `runStack` so it (a) can build an **already-populated** workspace (skip/parameterize the copy) and (b) exposes a **server-up evaluation window** — either by having runStack call `renderWithPage` (which already returns `{png, page, close}`) and invoke an injected `onLivePage` callback before teardown, or by extracting a `runBuildAndRender(appDir, …)` core that both `runStack` and the orchestrator call. This keeps the scored-outcome mapping and teardown discipline in **one** place (vs. re-implementing runStack's fatal-stage logic in the orchestrator). It is a real (small) touch to Phase 2 code, which contradicts CONTEXT's "does not change the build/render pipeline" — **flag for the planner/discuss as the top decision (Assumption A1).** Everything else (metric folds, CLI, HTML report, capability probe) is mechanical and grounded below.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Spec resolution → manifest → run_id | Orchestrator (`src/orchestrator` or `src/cli`) | `src/specs`, `src/manifest` | Reuses `loadStack/Scenario/Model`, `buildManifest`, `persistManifest`, `newRunId`. |
| Agent execution (paid Pi turn) | Agent adapter (`src/agent`) | — | `runSession(input, {createSession})`; Pi stays behind the adapter (AGENT-01). |
| Build / serve / screenshot (authoritative status) | Build/render pipeline (`src/pipeline/runStack` + `src/runtime` + `src/render`) | — | Owns install/build/start/readiness/screenshot/teardown + scored `RunOutcome`. |
| Live-page evaluation window (axe) | Build/render pipeline (server-up) | `src/render/renderWithPage` | Axe needs a live `page`; only the pipeline controls server lifecycle. |
| Evaluate + compose score | Evaluation pipeline (`src/pipeline/evaluate`, `composite`) | `src/eval/registry` | Already persists evaluations rows + `runs.composite_score`. |
| **Metric projection (fold the log)** | **Projector (new, `src/telemetry`)** | `StoragePort.readEvents` / SQL over `events` | TEL-02: folded *after*, from the persisted log; never inline. |
| Terminal summary | CLI (`src/cli`) | — | Reads `runs`/`evaluations`/`metrics`. |
| HTML report | Reports (new, `src/reports`) | `src/storage` reads | String template + base64; consumed by both `run` (auto-emit) and `report`. |
| Run-row terminal state (status/finished_at) | Orchestrator → Storage | new tiny `updateRunOutcome(db,…)` | Gap #3: nothing writes it today. |

## Standard Stack

**No new external packages are required.** Everything Phase 5 needs is already installed or in the Node 24 stdlib.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:util` `parseArgs` | Node 24 stdlib | CLI flag parsing (`--stack/--model/--scenario`, `report <id>`/`--latest`) | [VERIFIED: package.json — no `commander` dependency present]. Two subcommands with named flags is exactly `parseArgs`' sweet spot; zero new dependency, zero legitimacy gate. |
| `better-sqlite3` | 12.11.1 | Read projection + run/eval rows for summary & report | [VERIFIED: package.json]. Already the storage backend — but the orchestrator uses it **only through `openDb`/`StoragePort`/existing storage fns** (D-23), not a new direct import in the CLI. |
| `@earendil-works/pi-ai` `createModels` | 0.80.3 | Build the real `Models` for the judge evaluator | [VERIFIED: package.json]. `importBoundary.test.ts` guards **only** `@earendil-works/pi-coding-agent`, **not** pi-ai — so a production `createModels()` is allowed (registry.ts already type-imports `Models`). |
| `pngjs` | 7.0.0 | (only if needed) decode PNG for report | [VERIFIED: package.json]. Base64 embedding needs no decode — `readFileSync(png).toString("base64")` suffices. Skip pngjs unless a metric needs pixel data. |
| `tsx` | 4.22.4 (dev) | Run the CLI (`tsx src/cli/index.ts run …`) | [VERIFIED: package.json]. No bundler for v1. |

**Installation:** none — `npm install` already satisfies the phase.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `parseArgs` | `commander@15.0.0` [ASSUMED — from CLAUDE.md, **not installed**] | Nicer help/subcommand ergonomics, but adds a dependency + legitimacy gate for a 2-command CLI. Only adopt if the CLI grows toward the v2 matrix. |
| Orchestrator re-implements runStack internals | Refactor runStack minimally (recommended) | Re-implementing duplicates fatal-stage→`RunOutcome` mapping + teardown in two places (bug surface). One touch to Phase 2 is cheaper than two copies of the logic. |

## Package Legitimacy Audit

No external packages are added by this phase (recommended `parseArgs` path). Audit is therefore **empty by construction**.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.
*If the planner elects `commander@15.0.0` instead of `parseArgs`, it is `[ASSUMED]` (sourced from CLAUDE.md/training) and the plan must gate its install behind a `checkpoint:human-verify` task + `npm view commander version`.*

## Metric Fold Arithmetic (TEL-02…06)

All folds read `readEvents(runId): AgentEvent[]` (src/storage/db.ts:66) — **already in `seq` order** (`ORDER BY seq ASC`). Each event variant's fields are in src/core/events.ts. Write results to the three projection tables (src/storage/schema.sql.ts): `metrics(name,value,unit)`, `tool_calls(tool_name,call_count,error_count)`, `iterations(iteration_index,correction_count)`.

### Event inventory actually present in the log
`session_started{provider,modelId}` (once), `first_token{}` (once), `usage{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens?,totalTokens,costUsd,aborted}` (per turn), `tool_call{toolName,argsSummary,isError}`, `file_mutation{op:create|edit|delete,path,linesAdded,linesRemoved}`, `stage_started{stage}` / `stage_completed{stage,durationMs,exitCode}` / `stage_failed{stage,durationMs,exitCode}` for `install|build|lint|test` **only**, `benchmark_finished{status,failedStage}`, `unknown{piType,raw}` (narration `message_update` + Pi auto-retry passthrough).

### TEL-03 Performance → `metrics` (unit `ms` / `usd` / `tokens`)
| Metric | Fold | Confidence |
|--------|------|-----------|
| `install_ms` | `stage_completed`/`stage_failed` where `stage='install'` → `durationMs` | HIGH [VERIFIED: runStack.ts:97, runAndRecordStage] |
| `build_ms` | same, `stage='build'` → `durationMs` | HIGH |
| `lint_ms` / `test_ms` | same, if present (non-fatal, may be absent) | HIGH |
| `ttft_ms` | `first_token.ts − session_started.ts` | HIGH [VERIFIED: events.ts:90 comment states exactly this] |
| `wall_ms` | `benchmark_finished.ts − session_started.ts` (or `finished_at − started_at` on the run row). Fallback `max(ts) − min(ts)` if no `session_started` (agent never started). | HIGH |
| `cost_usd` | Σ `usage.costUsd` across all `usage` events (incl. `aborted` reconciliation delta, D4-15) — verbatim, unrounded (D-26) | HIGH |
| `input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_write_tokens`/`total_tokens` | Σ of the respective `usage` fields | HIGH |
| `backoff_wait_ms` (D5-12) | Σ over Pi retry episodes. **Robust deterministic fold: for each `unknown` retry-start event, `backoff = ts(matching auto_retry_end) − ts(auto_retry_start)`, summed.** This is timestamp-derived and does not depend on any Pi-internal field name. | MEDIUM [ASSUMED — Pi 0.80.3 auto-retry event names/shape not verified this session; see A2] |

**Telemetry Gap — `startup_ms` / `render_ms` are NOT separately foldable.** `runStack` starts the server via `startServer` (src/runtime/stage.ts:82) and screenshots via `createPlaywrightRenderer` **without emitting any stage event** for `start` or for the screenshot (only `install/build/lint/test` go through `runAndRecordStage`). So TEL-03's "startup" and "render" sub-times are not in the log. Options for the planner:
- **(a, recommended)** Emit them: if gap #1/#2 is resolved by refactoring runStack, add `stage_started/completed{stage:'start'}` around readiness and a `render` duration event/metric at the same time (tiny). Then they fold like the others.
- **(b)** Derive a combined `startup_render_ms = benchmark_finished.ts − last(stage_completed).ts` (coarse; conflates start+ready+screenshot). Foldable today, no code change, but not separable.
Flag as Assumption A3.

### TEL-04 Engineering → `metrics` (unit `count` / `count`)
| Metric | Fold |
|--------|------|
| `files_created` | distinct `path` whose first `file_mutation` `op='create'` (or simply `count(file_mutation where op='create')` — decide once; recommend distinct-path) |
| `files_edited` | distinct `path` that received any `op='edit'` |
| `lines_added` | Σ `file_mutation.linesAdded` |
| `lines_removed` | Σ `file_mutation.linesRemoved` |

**Caveat:** `linesAdded/linesRemoved` are best-effort — mapEvent.ts:146 sets them from `piEvent.result.details` and defaults to `0/0` when the Pi tool result carries no diff. Lines metrics may read 0. [VERIFIED: mapEvent.ts:137-153] Flag as Assumption A4.

### TEL-05 Iteration + correction density → `iterations` + `metrics`
- `iteration_count` = count of `usage` events (one per `turn_end`, D4-11 — the adapter itself counts turns this way, piAgentAdapter.ts:289). [VERIFIED]
- **Corrections (D5-11)** = per path, every 2nd-or-later `file_mutation`. Precise `seq`-ordered fold that also populates the per-iteration `iterations` table:
  - Walk events in `seq` order, maintaining a running `iterationIndex` incremented on each `usage` event, and a `Map<path, count>`.
  - For each `file_mutation`: `count[path]++`; if `count[path] > 1` it is a correction → increment `correction_count` for the current `iterationIndex`.
  - Write one `iterations(iteration_index, correction_count)` row per turn (or a single summary row if the planner prefers simpler — the table allows either).
- `correction_density` (metric) = `totalCorrections / iteration_count` (guard divide-by-zero → 0 when no turns).

### TEL-06 Tool calls → `tool_calls`
Group `tool_call` events by `toolName`; per group write `tool_calls(tool_name, call_count = n, error_count = count where isError)`. Pi default tool names (D4-21): `read/write/edit/bash/grep/find/ls`; `mcp` absent in v1 (Pi has no native MCP). [VERIFIED: piAgentAdapter.ts:104 comment lists the default tool set] The `events.tool_name` promoted column + `idx_events_tool_name` index make an SQL `GROUP BY` fold cheap if the planner prefers SQL over in-memory.

### TEL-02 Projection-not-inline
Implement a single pure `projectMetrics(db, runId)` (in `src/telemetry`) that reads the persisted log and writes all three tables. The orchestrator **only** `appendEvent`s during the run; it calls `projectMetrics` **after** `runStack`+`evaluateRun`. Validation below asserts the projection tables are empty until this pass runs.

## D5-01 Capability Probe (mockup image gating)

**What Pi exposes:** a resolved model object carries an `input: string[]` field (e.g. `["text","image"]`) — visible in the faux provider used by tests: `models: [{ id, input: ["text","image"] }]` (evalPipeline.integration.test.ts:46) and consumed by createPiSession via `modelRegistry.find(provider, modelId)` (piAgentAdapter.ts:68). The probe is: `model.input?.includes("image")`.

**Boundary constraint:** `ModelRegistry`/`model.input` are Pi-typed → the probe must live **inside `src/agent`** (only piAgentAdapter.ts may import `@earendil-works/pi-coding-agent`, enforced structurally by importBoundary.test.ts). Add a sibling helper, e.g. `src/agent/modelCapabilities.ts`, exporting `modelAcceptsImage(spec: AgentModelSpec): boolean` (does `ModelRegistry.create(AuthStorage.inMemory())` + `.find` + checks `input`). This is a **new file in the agent module**, not a modification of piAgentAdapter.ts — but note it is a *second* pi-coding-agent importer, so **importBoundary.test.ts must be updated to allow it** (it currently asserts the importer list `=== [piAgentAdapter.ts]`). Flag as Assumption A5.

**Wiring the decision:** the adapter currently injects the mockup **unconditionally** (piAgentAdapter.ts:306-315 always sends `images:[mockup]`). To actually skip injection (D5-01's whole point — "stop paying for tokens the model ignores"), the cleanest minimal change is an optional `injectImage?: boolean` on `AgentInput` (default `true`) that the adapter honors with a one-line ternary on the `images` array. The orchestrator sets `injectImage = modelAcceptsImage(model)`; when false it records a report flag. `assertAgentInput` still requires `mockupBytes: Buffer` (unchanged) — the flag only controls whether it is sent. This is ~2 lines in the adapter → the "does not change the agent adapter" constraint is *narrowly* violated; flag as Assumption A5.

**Report caveat wording (already fixed by UI-SPEC.md:125, use verbatim):** "Visual-fidelity caveat: the agent had no mockup grounding for this run — the resolved model does not accept image input, so the expected screenshot was not shown to it. Scoring is unaffected (the judge diffs screenshots on its own vision model)."

For the v1 named model, `models/deepseek4pro.json` → provider `deepseek`, modelId `deepseek-4-pro`. Whether DeepSeek's Pi registry entry declares `input:["image"]` is **unknown this session** — the probe resolves it at runtime; if it lacks image input the caveat fires. (This is exactly why D5-01 exists.)

## Orchestrator Seam & Placement

**Placement:** put the sequencing function in `src/orchestrator/run.ts` (the CONTEXT names `src/{orchestrator,telemetry,reports,cli}`); the CLI in `src/cli/index.ts` is a thin `parseArgs` wrapper that calls it. Dependency-injection seams so tests never make paid calls: `createSession` (default `piAgentAdapter`'s), `models` (default real `createModels()` + judge provider), `dbPath`, `resultsRoot`.

**Concrete call sequence (existing signatures named):**
1. `newRunId()` → `runId` (src/core/ids.ts).
2. `loadStack("stacks/<stack>.yaml")`, `loadScenario("scenarios/<scenario>/<scenario>.yaml")`, `loadModel("models/<model>.json")` (src/specs/load.ts). **Note:** production `stacks/angular.yaml` exists; `models/` and `scenarios/` dirs **do not exist yet** — only `tests/fixtures/models/deepseek4pro.json` + `tests/fixtures/scenarios/dashboard/dashboard.yaml`. The plan must **create the production `models/deepseek4pro.json` + `scenarios/dashboard/dashboard.yaml` (+ `expected.png`)** or point flags at the fixtures. Flag as Assumption A6.
3. Read `expected` PNG: `readFileSync(join(scenarioDir, scenario.expected.path))` → Buffer.
4. `openDb(dbPath)` (src/storage/db.ts) → `createStoragePort(db, resultsRoot)` (src/storage/storagePort.ts).
5. `buildManifest({runId, stack, scenario, model, prompt, mockup, expected, skills, versionStamp})` → `persistManifest(db, manifest)` — inserts the `runs` row `status='pending'`, `started_at` (src/manifest/manifest.ts). Build `versionStamp` (node version, deps, playwright/chromium, modelId, modelParams).
6. **Workspace + agent:** `copyWorkspace(stack.template, runId, "tmp")` → `appDir = tmp/<runId>/angular/` (src/workspace/copy.ts). Build `AgentInput` = `{runId, workspacePath: appDir, promptText: scenario.prompt, preamble: stack.preamble, mockupBytes, mockupMimeType:"image/png", skillPaths: scenario.skills, model:{provider,modelId,thinkingLevel?,temperature}, budget:{maxWallClockMs: scenario.budget.maxMinutes*60000, maxCostUsd: scenario.budget.maxUsd, maxTurns: scenario.budget.maxTurns}, injectImage}`. Stream: `for await (const draft of runSession(agentInput, {createSession})) storage.appendEvent(draft)` (piAgentAdapter.ts:238; a natural completion yields NO terminal — runStack owns it, D4-21).
7. **Build/render (gaps #1/#2):** per the recommendation, call the refactored pipeline entry that builds `appDir` **without re-copying** and yields a live page for evaluation before teardown. It appends stage + `benchmark_finished` events and writes `generated.png`; returns `RunOutcome{status,failedStage,screenshotArtifactId}` + (in the eval window) `{generatedPng, page}`.
8. **Evaluate** (only on `completed` with a generated screenshot; on failed/capped skip to step 10): `models = createModels(); models.setProvider(anthropicProvider)`; `registry = buildRegistry({db, models, expectedElements: scenario.expectedElements, judgeModel})` (src/eval/registry.ts — dom is auto-included only when `expectedElements` non-empty; the dashboard fixture has none → **dom excluded**, axe+judge+pixelmatch run). `evaluateRun({db, runId, repIndex, expectedPng, generatedPng, viewport: stack.viewport, page, registry, defaultWeights: scenario.evaluatorWeights ?? DEFAULT_EVALUATOR_WEIGHTS})` (src/pipeline/evaluate.ts) — persists evaluations rows, links diff screenshot, writes `runs.composite_score` when ≥1 evaluator survived. Close the live page.
9. **Persist expected screenshot** for self-contained report regen: `writeArtifact(runId,"screenshot","expected.png",expectedPng)` + a `screenshots role='expected'` row (mirror `linkDiffScreenshot`). No existing code persists `expected` — the report needs it (gap-adjacent finding). Flag A7.
10. **Terminal run state (gap #3):** new tiny `updateRunOutcome(db, runId, status, failedStage, finishedAt)` (mirror `updateRunComposite` in src/storage/evaluations.ts) — sets `runs.status`, `failed_stage`, `finished_at` from `RunOutcome`. Nothing does this today.
11. **Project metrics:** `projectMetrics(db, runId)` — folds the log into `metrics`/`tool_calls`/`iterations` (TEL-02, after the run).
12. **Present:** print terminal summary (REPORT-01, D5-03) + `renderReport(db, runId) → results/<runId>/report.html` (REPORT-02, D5-07); echo the path.
13. **Exit code (D5-08):** `0` if a scored row persisted (any `RunStatus`); non-zero only on harness throw (unresolvable spec, DB error). Wrap the harness-fatal boundary; scored failures are not thrown.

**Isolation check (D-23):** the orchestrator imports `AgentPort`/`StoragePort`/pipeline/eval seams — it may import `openDb` + storage fns (already the norm in tests) and `createModels` from pi-ai (allowed — importBoundary guards only pi-coding-agent). It must **not** import `@earendil-works/pi-coding-agent`, `better-sqlite3` directly for ad-hoc SQL (use storage fns), or `playwright` (only render modules).

## HTML Report (REPORT-02, D5-04/09) — honor UI-SPEC.md

**Approach:** a single `renderReport(db, runId): string` in `src/reports/` using **template literals** (no framework, no CDN, no `<link>`/`<img src>`/`fetch` — the self-containment invariant, UI-SPEC.md:32). One inline `<style>`, one inline `<script>` (only the `<details>` collapse — native `<details>`/`<summary>` needs no JS at all, so the script may be empty). System font stack; light theme; hex colors baked in (UI-SPEC §Color). Escape all interpolated text (narration, run_id) — untrusted agent output goes into HTML.

**Data sources (all from the DB + artifacts, so `report <run_id>` regenerates without specs):**
- `runs`: status, failed_stage, composite_score, composite_weights, manifest (→ stack×model×scenario names, rep_index), started_at/finished_at.
- `evaluations`: per-evaluator raw_score + detail (sub-score bars; dropped → "—").
- `metrics` / `tool_calls` / `iterations`: the folded tables (Performance / Engineering / Iteration / Tool-calls groups, UI-SPEC §Report Layout item 5).
- `artifacts`+`screenshots`: `generated.png` (kind='screenshot'), `diff.png` (role='diff'), `expected.png` (role='expected', persisted in step 9). Read bytes via `getArtifactPath` → `readFileSync` → `data:image/png;base64,…`.
- `events` (`readEvents`): collapsible timeline — `tool_call` entries (monospace) + verbatim narration from `unknown` events with `piType='message_update'` (extract display text best-effort from `raw.assistantMessageEvent`; Pi-shaped → tolerate missing fields).

**Section order (UI-SPEC.md:142, executor contract):** Header (status pill) → mockup-grounding caveat banner (only if `injectImage` was false) → Scorecard (Display composite + 4 sub-score bars) → Screenshot triptych (expected/generated/diff; absent slots use the empty-state copy) → Folded metrics table → collapsible Agent timeline. Status pill copy + backoff note copy are fixed in UI-SPEC §Copywriting.

**Partial/failed rendering (D5-05):** null composite → "—" + note; missing generated screenshot → empty-state copy naming `failed_stage`, **not** an error screen.

## CLI Wiring (CLI-01/02, D5-02/06/07/08)

- **Framework:** `node:util` `parseArgs` (stdlib, no dep). `bin`: add `"bin": { "bench": "src/cli/index.ts" }` with a `#!/usr/bin/env -S npx tsx` shebang, or (simpler for v1) just document `tsx src/cli/index.ts …` and add an npm script. Package is `type:module`, runs via `tsx` (devDep) — no build step.
- **`run --stack <s> --model <m> --scenario <sc>`** (D5-02): resolve each flag to a spec path, run the orchestrator, print summary + write `results/<run_id>/report.html` (D5-07), echo path. Exit 0 on any scored row (D5-08).
- **`report [<run_id>] [--latest]`** (D5-06): `<run_id>` → that run; bare/`--latest` → `SELECT run_id FROM runs ORDER BY started_at DESC LIMIT 1` (run_id is lexically chronological, so `ORDER BY run_id DESC` also works). Unknown id / empty DB → terminal error copy (UI-SPEC.md:114-115), exit non-zero (harness error, D5-08).
- **DB path:** pick a canonical single DB file, e.g. `results/bench.sqlite` (WAL, rep-keyed). Not defined yet — small decision (Assumption A8).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event `seq` ordering | Manual sort | `readEvents` returns `ORDER BY seq ASC` | Already authoritative (db.ts:66). |
| Composite renormalization when an evaluator drops | Custom averaging | `composeScore` (composite.ts) | Already renormalizes survivors; judge-drops-still-scores handled. |
| Server start / readiness / process-tree kill | Re-spawn logic | `startServer`+`waitForHttp200`+`killProcessTree` (src/runtime) | Battle-tested teardown (WORK-04); orphan-proof. |
| Live page + screenshot for eval | New Playwright wiring | `renderWithPage` (returns `{png,page,close}`) | Exactly the live-page-plus-bytes shape evaluateRun needs. |
| CLI subcommand parsing | Hand string-split of argv | `node:util parseArgs` | Stdlib; handles `--flag value`, positionals. |
| Base64 image embedding | pngjs decode/re-encode | `readFileSync(path).toString("base64")` | Bytes are already PNG on disk; no decode needed. |
| Terminal-state/composite writes | Ad-hoc SQL in CLI | tiny storage fns mirroring `updateRunComposite` | Keeps SQL bound + out of the CLI (D-23, T-1-SQL). |

**Key insight:** the pipeline primitives (`runStage`, `startServer`, `waitForHttp200`, `killProcessTree`, `renderWithPage`, `buildAllowlistedEnv`) are all already exported and reusable — so gaps #1/#2 are solvable by *recomposing existing pieces*, not by writing new capability. The only question is *where* the recomposition lives (refactored runStack vs orchestrator).

## Runtime State Inventory

Not a rename/refactor phase in the data sense, but there is **pre-existing runtime state the plan must reconcile:**
| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `runs` rows persist with `status='pending'` forever (gap #3) | New `updateRunOutcome` write; existing tests insert bare rows — projector/report must tolerate partial rows. |
| Live service config | Angular dev server (`ng serve` on :4200) started per run | Must be kept alive for axe eval then torn down (gap #2). Memory: integration tests need Node 24.18.0 + `--no-file-parallelism` (fixed port 4200). |
| OS-registered state | None | — |
| Secrets/env vars | `DEEPSEEK_API_KEY` (agent, required for the real E2E row), `ANTHROPIC_API_KEY` (judge live call; absent → judge drops, composite renormalizes) | E2E green-row needs both; unit/golden tests use fakes and need neither. |
| Build artifacts | Missing `models/` + `scenarios/` production dirs (only fixtures exist) | Create production specs or point flags at fixtures (A6). |

## Common Pitfalls

### Pitfall 1: Assuming "agent → runStack" composes as-is
`runStack` re-copies the pristine template first (copy.ts:16) and tears down the workspace/server in `finally`. Building on that assumption yields a benchmark that scores the *template*, not the agent's app, and an axe evaluator with no server. **Resolve gaps #1/#2 explicitly.**

### Pitfall 2: `runs.status` left `'pending'`
Nothing updates it after insert. Summary/report/exit-code logic keying off `runs.status` will read `'pending'` for every run unless the orchestrator writes the terminal state.

### Pitfall 3: Computing a metric inline (violates TEL-02/D-24)
Tempting to sum cost or count turns during the stream. Don't — append events only; fold afterward in `projectMetrics`. The validation harness checks projection tables are empty mid-run.

### Pitfall 4: Trusting `linesAdded/linesRemoved`
mapEvent defaults them to 0 when Pi's tool result lacks diff details. Report/metrics must render 0 gracefully, not as "no data."

### Pitfall 5: Judge with no API key crashes the row
The judge makes a live pi-ai call; without `ANTHROPIC_API_KEY` (or on error) it returns `{dropped:true}` and `composeScore` renormalizes pixelmatch (+dom). Never let a judge failure throw the orchestrator (D5-05).

### Pitfall 6: Adding a second pi-coding-agent importer silently breaks CI
The D5-01 capability helper in `src/agent` is a *new* importer; `importBoundary.test.ts` asserts an exact list. Update the allowlist in the same task, or CI fails.

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| commander for every CLI | `node:util parseArgs` (Node ≥18, stable) | Zero-dep parsing for small CLIs; matches "boring, no new deps." |
| Runtime template engine for HTML | Tagged template literals + inline assets | Self-contained portable report (D5-09); no framework. |

## Validation Architecture

Nyquist validation is **enabled**. Test framework: **vitest 4.1.9** [VERIFIED: package.json], config `vitest.config.ts`. Commands: quick `vitest run <file>`; full `npm test` (`vitest run`). Integration tests touching the dev server require Node 24.18.0 (nvm) + `--no-file-parallelism` (fixed port 4200) per project memory; the projector/report/CLI-format tests are **pure** (no server) and run fast/parallel.

### Strategy per fold — deterministic golden fixtures
The projector is the product-critical risk: a wrong fold = wrong benchmark numbers. Prove each fold with **hand-authored event-log fixtures** (arrays of `AgentEventDraft`) appended to a tmp/in-memory DB via `appendEvent`, then `projectMetrics(db, runId)`, then assert exact projection rows. One golden fixture per metric family + the two locked edge cases:

| Req | Fixture (event log in) | Expected projection (out) |
|-----|------------------------|---------------------------|
| TEL-03 wall/build/ttft | session_started@1000, first_token@1200, stage_completed{build,durationMs:4000}, usage×2 (cost 0.01+0.02), benchmark_finished@9000 | `ttft_ms=200`, `build_ms=4000`, `wall_ms=8000`, `cost_usd=0.03`, token sums exact |
| TEL-03 backoff (D5-12) | two auto-retry episodes: unknown{auto_retry_start@t}/{auto_retry_end@t+500} and @u/@u+800 | `backoff_wait_ms=1300` (Σ of end−start) |
| TEL-04 engineering | file_mutation create A(+10/−0), edit A(+3/−1), create B(+5/−0) | `files_created=2`, `files_edited=1`, `lines_added=18`, `lines_removed=1` |
| TEL-05 corrections (D5-11) | seq: create A, usage, edit A, edit A, usage, create B | `iteration_count=2`; corrections: path A written 3× → 2 corrections; B → 0; `correction_density=1.0`; per-iteration `iterations` rows reflect seq attribution |
| TEL-06 tool calls | tool_call bash×3 (1 isError), read×2, write×1 | rows: bash{3,1}, read{2,0}, write{1,0} |

### Property / held-out tests (better than fixtures here)
- **Projection determinism:** running `projectMetrics` twice on the same log yields identical rows (idempotent fold; guards accidental accumulation / double-insert).
- **Sum-conservation:** Σ per-iteration `correction_count` (iterations table) == `correction_density × iteration_count` == the standalone total-corrections fold — three independent computations agree (property, not a single fixture).
- **Order-invariance of storage, order-dependence of fold:** shuffle append order but preserve `seq` → same result (proves the fold keys off `seq`, per D5-11, not arrival order).

### Validate "projection-not-inline" (D-24 / TEL-02)
- After `runSession` streaming + `runStack` + `evaluateRun` but **before** `projectMetrics`, assert `SELECT count(*) FROM metrics/tool_calls/iterations WHERE run_id=?` is **0**. Only `projectMetrics` populates them. This is the concrete, checkable evidence that no metric is computed inline.
- Structural: `projectMetrics(db, runId)` takes only `(db, runId)` and reads via `readEvents`/SQL over `events` — it has no access to live run state (no session, no timers), so it *cannot* compute inline by construction.

### Validate scored-outcome-never-crash (D5-05/D5-08)
- **build_failed fixture:** log with `stage_failed{build}` + `benchmark_finished{status:'build_failed',failedStage:'build'}`, no generated screenshot, no evaluations, null composite. Assert: `projectMetrics` folds the partial metrics (cost/tokens/iterations/tool-calls that exist) without throwing; `updateRunOutcome` sets status; terminal summary renders (status pill FAILED·build, composite "—"); `renderReport` produces valid HTML with the empty-state screenshot copy; **exit code 0**.
- **timeout fixture:** `benchmark_finished{status:'timeout'}` + a reconciliation `usage{aborted:true}` → cost still folds; CAPPED pill; exit 0.
- **harness-error:** unresolvable spec path → orchestrator throws before any row → **exit non-zero**, no partial `report.html`.
- **End-to-end (paid, gated):** one real `run --stack angular --model deepseek4pro --scenario dashboard` producing a green scored row — the phase's SC#1. Guard behind an env flag / `.live.test` naming (mirror `judgeEvaluator.live.test.ts`) so CI stays free/offline; the injectable `createSession` fake + faux judge provider cover the wiring without paid calls.

### Wave 0 Gaps
- [ ] `tests/projector.test.ts` — golden fixtures for TEL-02…06 + edge cases (above).
- [ ] `tests/projectionNotInline.test.ts` — mid-run emptiness assertion.
- [ ] `tests/orchestrator.test.ts` — full sequence with injected fake session + faux judge (no paid calls), incl. build_failed/timeout paths.
- [ ] `tests/renderReport.test.ts` — self-containment invariant (no `<link>`/`http`/`src=` external; images are `data:`), partial-run rendering, HTML-escaping of narration.
- [ ] `tests/cli.test.ts` — `parseArgs` flag resolution, `report --latest` selection, exit codes.
- [ ] Update `tests/importBoundary.test.ts` allowlist if a second `src/agent` pi importer is added (A5).

## Project Constraints (from CLAUDE.md)
- TypeScript / Node 24, ESM (`type:module`, `module:nodenext`, strict, `verbatimModuleSyntax`).
- Pi SDK fully encapsulated behind the agent adapter (AGENT-01) — no other module imports `@earendil-works/pi-coding-agent`.
- `better-sqlite3` synchronous storage; Playwright only behind render modules; ports isolate concretes (D-23).
- All artifacts in English.
- Reuse `@earendil-works/pi-ai` for the judge — no second LLM SDK. No native MCP in v1.
- GSD: edits only through a GSD workflow; read-before-edit, grep callers before modifying.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Gaps #1/#2 are best resolved by a minimal additive refactor of `runStack` (skip-copy + server-up eval window), not by re-implementing it in the orchestrator | Summary / Orchestrator | Wrong choice → duplicated fatal-stage logic (bug surface) or an unnecessary Phase-2 change. **Top decision for discuss/planner.** |
| A2 | Pi 0.80.3 emits paired `auto_retry_start`/`auto_retry_end`-style events; `backoff_wait_ms` = Σ(end.ts − start.ts) | TEL-03 backoff | If Pi emits a single event or different names, the fold key changes. Verify against Pi docs/`raw` payloads from a live run; the timestamp-delta approach is robust to field renames but assumes paired events. |
| A3 | startup/render times are acceptable as either newly-emitted stage events (recommended) or a coarse derived `startup_render_ms` | TEL-03 gap | TEL-03 literally lists "startup/render time"; the coarse derivation conflates them — planner must pick. |
| A4 | `lines_added/removed` may legitimately be 0 (Pi tool results often lack diff details) | TEL-04 | If a stakeholder expects real line deltas, needs a Pi-side capture change (out of this phase). |
| A5 | D5-01 needs a new `src/agent` capability helper (second pi importer → importBoundary allowlist update) + optional `AgentInput.injectImage` (~2 lines in the adapter) | D5-01 probe | Contradicts "does not change the agent adapter." If disallowed, injection can't actually be skipped and D5-01 is only cosmetic (caveat without token savings). |
| A6 | Production `models/deepseek4pro.json` + `scenarios/dashboard/` must be created (only fixtures exist), or flags point at `tests/fixtures/*` | Orchestrator step 2 | `run --model deepseek4pro` fails to resolve a path otherwise. |
| A7 | The orchestrator should persist `expected.png` as a `screenshots role='expected'` artifact so `report <run_id>` regenerates self-contained | Orchestrator step 9 | Without it, `report` can't show the expected panel from stored results alone (would need the scenario file). |
| A8 | Canonical DB file = `results/bench.sqlite` (WAL, rep-keyed) | CLI | If a different path is expected, `report --latest` reads the wrong/empty DB. |

## Open Questions

1. **How to reconcile CONTEXT's "no Phase 1–4 changes" with gaps #1/#2/#3?**
   - Known: the three seams don't compose as written; all fixes are small.
   - Unclear: whether the user accepts a minimal `runStack` refactor (A1) + a 2-line adapter touch (A5), or wants the orchestrator to recompose primitives without touching Phase 2/4.
   - Recommendation: take this to `/gsd-discuss-phase` follow-up or plan the minimal-refactor path and flag the two touched files for review. It is the phase's critical path.
2. **Does DeepSeek 4 Pro's Pi registry entry declare `input:["image"]`?** Resolved at runtime by the probe; determines whether the caveat fires. No action needed pre-plan.
3. **startup/render granularity (A3)** — emit new events or derive coarse? Small, but affects TEL-03 completeness.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | runtime | ✓ | ≥24 (24.18.0 for server integration tests) | — |
| better-sqlite3 / playwright / pi-ai / pi-coding-agent | installed deps | ✓ | per package.json | — |
| `DEEPSEEK_API_KEY` | real E2E green-row (SC#1) | ✗ (env, user-provided) | — | Fake `createSession` for all non-live tests |
| `ANTHROPIC_API_KEY` | judge live call | ✗ (env) | — | Judge drops → composite renormalizes (D5-05 holds) |
| `commander` | only if CLI framework chosen over parseArgs | ✗ (not installed) | — | `node:util parseArgs` (stdlib) — recommended |

**Missing with no fallback:** none for the coded/tested deliverable. The *paid green-row* (SC#1) needs `DEEPSEEK_API_KEY` at run time — a user/runtime concern, not a code blocker.

## Sources

### Primary (HIGH confidence) — read this session
- src/pipeline/runStack.ts, evaluate.ts, composite.ts — build/eval/score contracts + the copy/teardown seams.
- src/core/events.ts, ports.ts, units.ts — event union + port shapes + unit conventions (D-26).
- src/agent/piAgentAdapter.ts, mapEvent.ts, types.ts — event emission, unconditional image injection, retry-as-unknown, tool/file-mutation mapping.
- src/storage/{schema.sql.ts, db.ts, storagePort.ts, evaluations.ts, artifacts.ts} — projection tables, readEvents order, status-never-updated, artifact/screenshot persistence.
- src/specs/{load.ts, schema.ts, types.ts}, src/manifest/manifest.ts, src/core/ids.ts, src/workspace/{copy.ts, teardown.ts}, src/runtime/stage.ts, src/render/{playwrightRenderer.ts, renderWithPage.ts}, src/eval/{registry.ts, axeEvaluator.ts, judgeEvaluator.ts} — orchestrator building blocks.
- tests/{evalPipeline.integration.test.ts, runStack.integration.test.ts, importBoundary.test.ts} — proven wiring patterns + boundary enforcement.
- tests/fixtures/models/deepseek4pro.json, tests/fixtures/scenarios/dashboard/dashboard.yaml, stacks/angular.yaml, package.json, tsconfig.json — the v1 row inputs + toolchain.
- .planning/{REQUIREMENTS.md, phases/05-*/05-CONTEXT.md, 05-UI-SPEC.md} — requirement text + locked decisions + UI contract.

### Secondary (MEDIUM)
- Pi SDK retry-event shape for `backoff_wait_ms` (A2) — inferred from D4-14/mapEvent passthrough, not verified against Pi 0.80.3 docs this session.

## Metadata

**Confidence breakdown:**
- Seam gaps (#1 clobber, #2 live-page, #3 status): HIGH — read directly from source.
- Metric folds TEL-02/04/05/06: HIGH — exact event fields confirmed. TEL-03 backoff + startup/render: MEDIUM — Pi retry shape assumed (A2), startup/render not in log (A3).
- D5-01 probe: HIGH on mechanism (`model.input`), MEDIUM on the boundary/AgentInput touch needed (A5).
- CLI + HTML report: HIGH — mechanical, stdlib + existing data.

**Research date:** 2026-07-03
**Valid until:** ~2026-08-02 (stable codebase; re-verify only if Phase 1–4 files change or Pi SDK version bumps).
