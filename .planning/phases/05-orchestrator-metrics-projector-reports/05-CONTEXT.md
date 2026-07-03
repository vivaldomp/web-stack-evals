# Phase 5: Orchestrator + Metrics Projector + Reports - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

> ✅ **User-confirmed decisions.** D5-01 through D5-12 were each explicitly
> confirmed by the user in an interactive discuss-phase session (2026-07-03,
> third re-run). The user chose "re-discuss from scratch" and confirmed every
> decision directly — these are no longer provisional defaults. Safe to plan
> against.

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

This phase is **primarily** orchestration + projection/presentation over the
Phases 1–4 pieces. Research (2026-07-03, `05-RESEARCH.md`) found three seams
that do **not** compose as first assumed, so — **user-confirmed** — it also
makes three *minimal, additive* touches to prior-phase code (see D5-13/D5-14/
D5-15): a parameterized `runStack` (skip-copy + server-up eval window), a
~2-line adapter `injectImage` gate + capability probe, and a new
`updateRunOutcome` storage write. The evaluators, scorer, composite, and the
event/storage **schema** stay unchanged. No matrix, scheduler, Docker, or
Markdown/CSV (all v2).
</domain>

<decisions>
## Implementation Decisions

### Mockup Image Grounding (resolves STATE.md Phase-5 vision-gap blocker)
- **D5-01 (user-confirmed):** Keep **DeepSeek 4 Pro as the named
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

### `report` Command Target (CLI-02)
- **D5-06 (user-confirmed):** `report <run_id>` renders a specific stored run;
  bare `report` (or `--latest`) renders the **most recent** run. Explicit +
  scriptable, with a zero-arg convenience for the common case. Rejected:
  run_id-always (copy the id every time); results-path arg (leaks storage layout
  into the CLI).

### `run` Auto-Emits the HTML Report (REPORT-02 / CLI-01)
- **D5-07 (user-confirmed):** After a run, the CLI prints the compact summary
  (D5-03) **and** writes `results/<run_id>/report.html`, echoing the path.
  `report` (D5-06) just regenerates the same file later. One command yields
  everything; still fully regenerable from stored results. Rejected: summary-only
  (HTML only after a separate `report` step — extra ceremony for the normal case).

### Exit Code Semantics (CLI-01, spans D5-05)
- **D5-08 (user-confirmed):** `run` exits **0 whenever it produced a scored row**
  — including a `build_failed` / `start_failed` / `timeout` run, because the
  benchmark *succeeded* at benchmarking (D5-05: a failed build is a valid data
  point). Reserve **non-zero** for the *harness itself* failing: unresolvable
  spec, DB write error, uncaught crash. CI/scripts gate on the score, not the
  exit code. Rejected: non-zero on any failed/capped run (conflates "tool broke"
  with "result was low").

### HTML Screenshot Embedding (REPORT-02)
- **D5-09 (user-confirmed):** Screenshots (expected / generated / diff) are
  embedded **inline as base64 data URIs** — one truly portable `.html` file that
  emails/moves anywhere without the artifact folder or DB (honors the
  "self-contained / shareable" goal in `<specifics>`). Larger file is the
  accepted cost. Rejected: linked artifact files (smaller HTML but breaks unless
  the image folder travels with it — not self-contained).

### Repeated-Run / Rep Handling (CLI-01, TEL storage)
- **D5-10 (user-confirmed):** Re-running the same stack+model+scenario **appends
  a new rep-keyed row**; history accumulates and no prior data point is ever
  destroyed. Matches the rep-keyed schema built for the v2 matrix; v1 always
  writes a rep and reports the latest. Rejected: overwrite (discards run-to-run
  variance — the thing a benchmark measures); require explicit `--rep` (ceremony
  for v1's single row).

### Correction-Density Definition (TEL / D4-11 / iterations)
- **D5-11 (user-confirmed):** A **correction = any 2nd-or-later `file_mutation`
  on the same path** (every repeated write after the first). Purely event-derived
  — no dependency on build/test outcome or event interleaving — so it folds from
  the log deterministically and reproducibly (D-24). Rejected: only rewrites
  after a failure (couples the projector to stage outcomes; fragile to fold,
  harder to reproduce).

### Rate-Limit / Backoff Attribution (TEL-03)
- **D5-12 (user-confirmed):** Backoff / rate-limit wait time is surfaced as its
  **own distinct metric** (e.g. `backoff_wait_ms`) alongside productive time in
  the report — a run slowed by provider throttling is *visible*, not silently
  blamed on the model/stack. Honest attribution per TEL-03, folded from the
  retry/backoff events D4-14 emits. Rejected: silently subtracting backoff from
  wall time (hides why a run was slow).

### Post-Research Scope Resolutions (user-confirmed 2026-07-03, after 05-RESEARCH.md)
Research reading the real Phase 1–4 code found the original "changes nothing in
Phases 1–4" fence unachievable — three seams don't compose. The user confirmed
the following, relaxing that fence **only** as stated here:

- **D5-13 (user-confirmed) — Pipeline seam via minimal `runStack` refactor.**
  Resolve the workspace-clobber + live-page-for-axe gaps by *additively*
  parameterizing `src/pipeline/runStack.ts`: (a) skip the template copy when the
  workspace is already agent-populated, and (b) expose a server-up evaluation
  window (yield the live Playwright `page` before teardown) so axe runs against
  the agent's real app. The fatal-stage→`RunOutcome` mapping and orphan-proof
  teardown stay in ONE place (not re-implemented in the orchestrator). Also emit
  `stage_started/completed{stage:'start'}` + a `render` duration so TEL-03's
  startup/render times fold like the others (resolves A1/A3). Rejected: the
  orchestrator recomposes the primitives itself (duplicates teardown/outcome
  logic in two places, higher bug surface).

- **D5-14 (user-confirmed) — D5-01 `injectImage` is real, not cosmetic.**
  Add `src/agent/modelCapabilities.ts` exporting `modelAcceptsImage(spec)` (reads
  the Pi model registry `input` field) — a *second* `@earendil-works/pi-coding-agent`
  importer, so `tests/importBoundary.test.ts`'s allowlist is updated in the same
  task. Add optional `injectImage?: boolean` (default `true`) to `AgentInput`; the
  adapter honors it with a one-line ternary on the `images` array. The
  orchestrator sets `injectImage = modelAcceptsImage(model)` and records the
  report caveat when false. Delivers D5-01's token-saving intent (resolves A5).
  Rejected: leave the adapter untouched (D5-01 becomes presentation-only, still
  pays for image tokens the model ignores).

- **D5-15 — Additive resolutions the planner takes as given (no alternative):**
  (i) new `updateRunOutcome(db, runId, status, failedStage, finishedAt)` storage
  fn mirroring `updateRunComposite` — nothing sets the terminal `runs` row today
  (gap #3, else every row stays `'pending'`). (ii) Create production
  `models/deepseek4pro.json` + `scenarios/dashboard/dashboard.yaml` (+ `expected.png`)
  from the fixtures so the named D5-02 flags resolve (A6). (iii) Persist
  `expected.png` as a `screenshots role='expected'` artifact so `report <id>`
  regenerates self-contained (A7). (iv) CLI = `node:util parseArgs` (commander is
  not installed); canonical DB = `results/bench.sqlite` (WAL, rep-keyed) (A8).

### Claude's Discretion
Left to research/planner — mechanical, no user preference expressed. (The
*semantic* fold rules the user cared about are now locked: correction density
D5-11, backoff attribution D5-12.)
- Exact arithmetic of each fold (summation/windowing details) once the D5-11 /
  D5-12 definitions are applied — e.g. how overlapping `file_mutation`s are
  ordered by `seq`, how `backoff_wait_ms` sums multiple retry intervals.
- Whether the projector is one `projectMetrics(runId)` pass or per-metric
  folders; how it reads the log (`StoragePort.readEvents` vs SQL folds over the
  promoted `events` columns / indexes).
- CLI framework choice (commander per CLAUDE.md vs native `parseArgs`) and the
  `bin` entry wiring (the `run`/`report` command *behavior* — targets, exit
  codes, auto-emit — is locked by D5-06/07/08).
- HTML templating approach (string template vs tiny helper) — no runtime
  framework; the report is static and self-contained (D5-09 inline assets).
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
- The HTML report is a **single self-contained file** with screenshots embedded
  **inline as base64** (D5-09) — shareable without the DB or artifact folder.
  `run` writes it to `results/<run_id>/report.html` every run (D5-07).
- Metric values persist **verbatim / unrounded** (D-26): USD cost, ms durations,
  epoch-ms timestamps; any rounding is presentation-only in the summary/report.
- Rate-limit / backoff time is its **own metric** (`backoff_wait_ms`, D5-12),
  attributed separately (TEL-03) from the agent's productive wall time, folded
  from the retry/backoff events D4-14 emits.
- Re-runs **append a new rep-keyed row** (D5-10); `report` defaults to the
  latest, or takes an explicit `<run_id>` (D5-06). `run` exits 0 on any scored
  row (even a failed build), non-zero only on harness error (D5-08).
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
