# Phase 5: Orchestrator + Metrics Projector + Reports - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

> ✅ **Decisions stand as defaults.** These are Claude's recommended defaults,
> each grounded in the project's existing principles. D5-01 (mockup grounding)
> was surfaced to the user for explicit confirmation across two discuss-phase
> sessions (2026-07-02 and 2026-07-03); the user was away both times, so the
> recommended **capability-conditional** default stands and is safe to plan
> against. It remains overridable — re-run `/gsd-discuss-phase 5` to change it
> before or after planning.

<domain>
## Phase Boundary

Wire the already-proven pieces into **one green benchmark row, end to end**:
`agent (runSession) → build/render (runStack) → evaluate → score → persist`,
driven by a `run` CLI command. Then fold the append-only event log into the
`metrics` / `tool_calls` / `iterations` projection tables (never computed
inline), and render two human-facing outputs: a terminal summary and a static
HTML report (regenerable from stored results via a `report` command).

**Requirements in scope:** TEL-02, TEL-03, TEL-04, TEL-05, TEL-06,
REPORT-01, REPORT-02, CLI-01, CLI-02.

This phase does **not** change the agent adapter, the build/render pipeline,
the evaluators, the scorer, or the event/storage schema — all authoritative
from Phases 1–4. It only **orchestrates** them and **projects/presents** their
output. No matrix, scheduler, Docker, or Markdown/CSV (all v2).
</domain>

<decisions>
## Implementation Decisions

### Mockup Image Grounding (resolves STATE.md Phase-5 vision-gap blocker)
- **D5-01 (default stands — user absent both sessions):** Keep **DeepSeek 4 Pro as the named
  v1 model** (don't change the benchmark subject). Make image injection
  **capability-conditional** — when the resolved model's Pi registry entry does
  not declare `input: ["image"]`, **do not inject the mockup** (stop paying for
  tokens the model ignores). The visual-fidelity caveat ("agent had no mockup
  grounding for this run") is surfaced in the report. Rejected: swapping the
  named model to a vision model (changes the benchmarked subject away from the
  vision doc's DeepSeek row); injecting unconditionally (wasteful + implicit).
  **Note:** scoring is unaffected — pixelmatch and the LLM judge diff
  expected-vs-generated screenshots on the judge's own independent vision model
  (EVAL-04), which never depended on the agent seeing the mockup.

### `run` CLI Surface (CLI-01)
- **D5-02:** Invocation is **named spec flags**:
  `run --stack angular --model deepseek4pro --scenario dashboard`. Each flag
  names a spec file under `stacks/` / `models/` / `scenarios/`. Self-documenting,
  maps 1:1 to the three declarative specs, matches the commander-subcommand
  convention already noted in CLAUDE.md, and lets a human vary one axis by hand
  toward v2. Rejected: positional args (order-sensitive), single `bench.config.ts`
  (v2-matrix ceremony with no v1 payoff).

### Terminal Summary (REPORT-01)
- **D5-03:** After a run the CLI prints a **compact scores + headline-metrics
  block**: composite, the four sub-scores, run status, and a one-line headline
  (wall time, cost, tokens, iterations). The full folded-metrics breakdown lives
  in the HTML report, not the terminal. Rejected: full metric dump (long scroll),
  scores-only (too thin to be useful at a glance).

### HTML Report (REPORT-02)
- **D5-04:** The static HTML report is a **self-contained post-mortem**:
  side-by-side expected / generated / diff screenshots, a scorecard (composite +
  sub-score bars), the **complete folded-metrics table** (performance /
  engineering / iteration / per-type tool calls), and a **collapsible agent
  narration + tool-call timeline**. D4-12 already persists narration verbatim in
  the event log's `UnknownEvent` payloads *specifically* to feed this view, so
  the data exists at zero extra capture cost. Single self-contained HTML file.

### Partial / Failed Run Rendering (behavioral, spans REPORT-01/02)
- **D5-05:** A capped (`timeout`) or `build_failed` / `start_failed` run is a
  **scored data point, not an error screen** (consistent with D2-13 / D4-02).
  When there is no generated screenshot or the composite is null, the summary
  and report render the run's **status + whatever metrics did fold** (cost,
  tokens, iterations, which stage failed) instead of blank/crash. The row still
  persists complete.

### Claude's Discretion
Left to research/planner — no user preference expressed:
- Exact fold rules per metric (e.g. how backoff/rate-limit time is summed and
  attributed separately per TEL-03; how correction density is computed from
  repeated `file_mutation`s on one path per D4-11).
- Whether the projector is one `projectMetrics(runId)` pass or per-metric
  folders; how it reads the log (`StoragePort.readEvents` vs SQL folds over the
  promoted `events` columns / indexes).
- CLI framework choice (commander per CLAUDE.md vs native `parseArgs`) and the
  `run`/`report` command wiring, exit codes, and `bin` entry.
- HTML templating approach (string template vs tiny helper) — no runtime
  framework; the report is static and self-contained.
- Where the orchestrator lives (`src/orchestrator/` vs `src/cli/`) and how it
  threads run_id from manifest → agent → runStack → evaluate → project → report.
- Exact model-capability probe for D5-01 (reading Pi's model registry `input`
  field) and the caveat wording in the report.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Vision & Scope (source of truth)
- `PRODUCT.md` (repo root) — full framework vision; the telemetry event list
  (`SessionStarted → PromptSent → ToolExecuted → FileWritten → Build* →
  ScreenshotTaken → *Completed → BenchmarkFinished`), the metrics catalogue, the
  v1 row, and the proposed `src/{orchestrator,telemetry,reports,cli}` +
  `results/` layout and `bench.config.ts` mention. English artifacts.
- `.planning/PROJECT.md` — core value (reproducible/comparable/measurable),
  constraints, Key Decisions table (incl. the DeepSeek vision-gap row).
- `.planning/REQUIREMENTS.md` — Phase 5 owns TEL-02..06, REPORT-01/02,
  CLI-01/02; §Traceability confirms the mapping.
- `.planning/ROADMAP.md` §"Phase 5" — phase goal + the four success criteria
  this phase must make TRUE (end-to-end `run`; metrics-as-projections;
  terminal summary; regenerable HTML `report`).
- `.planning/STATE.md` §Blockers/Concerns — the ⚠️ DeepSeek vision-gap note that
  D5-01 resolves.

### Prior-phase contracts this phase folds into / wires together
- `.planning/phases/04-agent-runtime-pi-sdk-adapter/04-CONTEXT.md` — D4-09/10/11
  (which events make TTFT / iteration count / correction density foldable),
  D4-12 (verbatim narration for the report), D4-22 (orchestrator hands the
  adapter one resolved `AgentInput`), D4-15 (usage captured on aborted turns),
  D4-26 (storage owns `seq`; the integration point where agent + runStack share
  one log). Its `<code_context>` names the exact Phase-5 wiring: `runSession`
  output → event log → `runStack` build → evaluate → score.
- `.planning/phases/01-foundations-contracts/01-CONTEXT.md` — D-13/16/24 (event
  log → projections; events are the single source of truth), D-19 (`RunStatus`
  enum + `failed_stage`), D-26 (units: epoch-ms, ms durations, USD verbatim).
- `.planning/phases/03-evaluation-pipeline-scorer/03-CONTEXT.md` — the
  `evaluateRun` / `composeScore` contract this phase calls.

### Code the orchestrator/projector/reports integrate with (implement/consume)
- `src/core/ports.ts` — `AgentPort.runSession` (consume), `StoragePort`
  (`appendEvent` seqless drafts, `readEvents`, `writeArtifact`,
  `persistManifest`), `RenderPort`.
- `src/core/events.ts` — the `AgentEvent` union the projector folds
  (`usage`, `first_token`, `session_started`, `tool_call`, `file_mutation`,
  `stage_*`, `benchmark_finished`) + `AgentEventDraft`.
- `src/pipeline/runStack.ts` — authoritative build/render; returns `RunOutcome`
  (`status`, `failedStage`, `screenshotArtifactId`). The orchestrator runs the
  agent first (mutating `tmp/<run_id>/angular/`), then calls this.
- `src/pipeline/evaluate.ts` (`evaluateRun`) + `src/pipeline/composite.ts`
  (`composeScore`, `DEFAULT_EVALUATOR_WEIGHTS`) — evaluation + composite,
  already persist evaluations rows + `runs.composite_score`.
- `src/eval/registry.ts` (`buildRegistry`) — assembles the evaluator set.
- `src/agent/piAgentAdapter.ts` + `src/agent/types.ts` (`AgentInput`) — the
  concrete adapter and its Pi-free input contract (D5-01's capability probe
  lives near here).
- `src/storage/schema.sql.ts` — target projection tables: `metrics`
  (name/value/unit), `tool_calls` (tool_name/call_count/error_count),
  `iterations` (iteration_index/correction_count); `runs` row
  (status/composite/started_at/finished_at); `artifacts`/`screenshots`
  (report reads these paths).
- `src/storage/storagePort.ts`, `src/storage/db.ts`, `src/storage/artifacts.ts`,
  `src/storage/evaluations.ts` — concrete storage the projector writes through
  and the `report` command reads back.
- `src/manifest/manifest.ts` + `src/specs/load.ts` — resolve specs → stamped
  manifest → run_id at the top of `run`.

No external ADRs — the decisions above plus the cited CONTEXT.md files ARE the
Phase 5 contract record.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Every downstream stage already exists behind a port** — Phase 5 writes glue,
  not new capability: `piAgentAdapter` (agent), `runStack` (build/render),
  `evaluateRun`/`composeScore` (eval/score), storage helpers (persist). The
  orchestrator is a sequencing function over these.
- **Projection tables already in the schema** (`metrics`, `tool_calls`,
  `iterations`) — the projector only writes rows, no DDL/migration (SCHEMA_VERSION
  stays 1).
- **The event log is already complete and foldable** — Phase 4 emitted
  `session_started` / `first_token` / `usage` / `file_mutation` / `tool_call` /
  `stage_*` precisely so TEL-02..06 fold without any new capture.
- **`runs` row already stores composite + status + timestamps** — the report's
  scorecard reads existing columns; `evaluations` rows hold sub-scores; the
  pixelmatch diff is already linked as `screenshots.role='diff'`.

### Established Patterns
- **Projections-not-inline (D-24 / TEL-02):** metrics are folded from the log
  after the run, never computed during it. The orchestrator must not compute a
  metric inline — it appends events; a separate projector pass folds them.
- **Ports isolate concretes (D-23):** the orchestrator depends on `AgentPort` /
  `StoragePort` / evaluator seams, not on Pi / better-sqlite3 / Playwright
  directly (those stay in their adapter modules).
- **Scored-outcome, never-crash (D2-13 / D4-02):** `runStack` never rejects;
  the orchestrator inherits that — a failed/capped row persists as a data point
  (D5-05), it does not throw.
- **Storage owns `seq` (D4-26):** producers append seqless drafts; the agent
  adapter then `runStack` share one run's ordered log with no coordination —
  the orchestrator just runs them in sequence.

### Integration Points
- `run` = load specs → manifest/run_id → (capability-gate image, D5-01) →
  `runSession` streaming into `appendEvent` → `runStack` (authoritative build on
  the mutated workspace) → `evaluateRun` (expected vs generated) → project
  metrics from the log → print summary. `report` = read stored run → render HTML.
- The agent and `runStack` both append to the **same run_id's** log; ordering is
  agent-first (it mutates the workspace `runStack` then builds).
</code_context>

<specifics>
## Specific Ideas

- v1 row fixed: **Angular template @ 4200 + DeepSeek 4 Pro
  (`models/deepseek4pro.json`) + "dashboard" scenario.**
- The HTML report is a **single self-contained file** (screenshots inline or
  linked from the artifact store) — shareable without the DB.
- Metric values persist **verbatim / unrounded** (D-26): USD cost, ms durations,
  epoch-ms timestamps; any rounding is presentation-only in the summary/report.
- Rate-limit / backoff time is **attributed separately** (TEL-03) from the
  agent's productive wall time, folded from the retry/backoff events D4-14 emits.
</specifics>

<deferred>
## Deferred Ideas

- **Matrix / multi-row reports, leaderboards, comparison heatmaps** — v2
  (REPORT2-02); v1 renders one row. The schema is already rep-keyed.
- **Markdown / CSV export** — v2 (REPORT2-01); HTML + CLI cover v1.
- **Live-streaming dashboard** — explicitly Out of Scope (contradicts
  "not an IDE").
- **Swapping the v1 model to a vision-capable one** — not chosen (D5-01 keeps
  DeepSeek); revisit if/when a vision benchmark row is added.
- **Lighthouse perf/a11y metrics in the report** — v2 (EVAL2-01).

</deferred>

---

*Phase: 5-Orchestrator + Metrics Projector + Reports*
*Context gathered: 2026-07-03*
</content>
</invoke>
