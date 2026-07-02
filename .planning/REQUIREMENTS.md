# Requirements: Web Stack Benchmark Platform

**Defined:** 2026-07-01
**Core Value:** Given the same standardized inputs, produce an objective, reproducible score for a (stack × model × scenario) run — end to end, without human judgment.

## v1 Requirements

v1 is a **thin vertical slice**: one row (Angular + DeepSeek 4 Pro, "dashboard" scenario) that exercises the full evaluation pipeline. Everything is declarative-first and rep-keyed so v2 matrix expansion needs no core changes.

### Specification & Config

- [x] **SPEC-01**: Engine loads and zod-validates a declarative `stack.yaml` (template path, install/build/start commands, port, viewport)
- [x] **SPEC-02**: Engine loads and zod-validates a declarative `scenario.yaml` (prompt, expected screenshot + its provenance, viewport, skills)
- [x] **SPEC-03**: Engine loads a declarative model config consumed by the Agent Runtime (no model hardcoded in core)
- [x] **SPEC-04**: Each run resolves its inputs into a single stamped run manifest (spec snapshot + dependency/model/browser versions + input fingerprint)

### Agent Runtime

- [ ] **AGENT-01**: Pi SDK is fully encapsulated behind an `AgentPort`; no other module imports the Pi SDK
- [ ] **AGENT-02**: Start a session injecting prompt + skills + mockup image
- [ ] **AGENT-03**: Agent builds the app in the workspace using Pi native tools (no MCP required for the v1 row)
- [ ] **AGENT-04**: Pi SDK events are normalized into the canonical `AgentEvent` stream
- [ ] **AGENT-05**: Capture raw per-turn usage (input / output / cache-read / cache-write tokens + cost) and derive TTFT

### Workspace & Isolation

- [ ] **WORK-01**: Create a disposable temp workspace per run (`tmp/run-XXX/`)
- [ ] **WORK-02**: A run never mutates the main project
- [x] **WORK-03**: Execute generated code with isolation mitigations (`npm ci --ignore-scripts`, env-stripped spawn, per-stage timeouts)
- [ ] **WORK-04**: Clean teardown — no orphaned dev-server processes or held ports across runs

### Build & Render

- [ ] **BUILD-01**: Run install → build → start → wait-ready with per-stage timeouts; failures are recorded as scored outcomes, not crashes
- [x] **BUILD-02**: Capture build / lint / test results as metrics
- [x] **BUILD-03**: Screenshot the running app with headless Playwright at the declared viewport and `deviceScaleFactor: 1`
- [x] **BUILD-04**: Screenshot determinism controls (fixed viewport/DPR, disable animation/motion, pinned/bundled fonts); baseline uses the same pinned renderer as the run

### Evaluation

- [ ] **EVAL-01**: PixelMatch visual-similarity score between expected and generated screenshot
- [ ] **EVAL-02**: DOM Diff structural-presence checks (expected elements/roles exist)
- [ ] **EVAL-03**: Accessibility eval via axe-core
- [ ] **EVAL-04**: LLM Judge compares expected vs generated screenshot — independent model family, temp=0, images-only input, structured rubric output
- [ ] **EVAL-05**: All evaluators run behind one `Evaluator` interface + registry (add an evaluator without touching core)

### Scoring

- [ ] **SCORE-01**: Compute a composite score from evaluator sub-scores
- [ ] **SCORE-02**: Persist raw sub-scores separately from the normalized composite

### Telemetry & Metrics

- [x] **TEL-01**: Append-only event log is the single source of truth for telemetry
- [ ] **TEL-02**: Metrics are projections folded from the event log (never computed inline)
- [ ] **TEL-03**: Performance metrics captured (wall / build / startup / render time), with rate-limit/backoff time attributed separately
- [ ] **TEL-04**: Engineering metrics captured (files created/edited, lines added/removed)
- [ ] **TEL-05**: Iteration count and correction density captured
- [ ] **TEL-06**: Tool-call counts captured by type (read/write/edit/bash/grep/find/mcp)

### Storage

- [x] **STORE-01**: SQLite schema (rep-keyed for future N>1): runs, stacks, artifacts, events, metrics, screenshots, tool_calls, iterations, evaluations; WAL + single-writer
- [x] **STORE-02**: Store run manifest / spec snapshot / version stamps on each run row
- [x] **STORE-03**: On-disk artifact store (screenshots, logs, generated code) linked from the DB

### Reporting

- [ ] **REPORT-01**: CLI terminal summary after a run (composite + sub-scores + key metrics)
- [ ] **REPORT-02**: Static HTML report with side-by-side expected/generated visual diff, scores, and metrics

### CLI

- [ ] **CLI-01**: `run` command executes one benchmark row from specs end-to-end
- [ ] **CLI-02**: `report` command regenerates the HTML report from stored results

## v2 Requirements

Tracked, deferred, not in the current roadmap. v1 schema and interfaces already accommodate these.

### Matrix & Scale

- **MATRIX-01**: Matrix generator (stack × model × scenario × repetitions)
- **MATRIX-02**: Scheduler with concurrency + resume/retry
- **MATRIX-03**: Repetitions (N>1) with mean / stddev / pass@k aggregation

### Isolation

- **ISO-01**: Docker-per-run isolation (escalation triggers documented in PITFALLS.md)

### Evaluation & Reporting

- **EVAL2-01**: Lighthouse a11y/perf pass
- **REPORT2-01**: Markdown + CSV report export
- **REPORT2-02**: Comparison heatmaps / leaderboards across rows

### Comparison Axes & CI

- **CMP-01**: Compare prompts / skills / MCP servers / engineering strategies (Loop Engineering, SDD) as matrix axes
- **CI-01**: CI/CD integration with historical / regression analysis

## Out of Scope

Explicitly excluded (vision non-goals + conscious v1 cuts). Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| IDE / manual code editing | Vision non-goal — platform is benchmarking only |
| Dev framework / IDE-for-agents | Vision non-goal — not a development tool |
| Production deployment | Vision non-goal — evaluation only |
| Live streaming dashboard | Batch-benchmark scope creep; contradicts "not an IDE" |
| Human-in-the-loop scoring | Contradicts Core Value ("without human judgment") |
| Full matrix breadth in v1 (multi-stack/model/reps) | Prove one row first; declarative specs already support breadth — v2 |
| Docker isolation in v1 | Local temp dir + mitigations sufficient to start — v2 |
| Markdown/CSV reports in v1 | HTML + CLI cover v1 — v2 |

## Traceability

Every v1 requirement maps to exactly one phase. See `.planning/ROADMAP.md` for phase details.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SPEC-01 | Phase 1 | Complete |
| SPEC-02 | Phase 1 | Complete |
| SPEC-03 | Phase 1 | Complete |
| SPEC-04 | Phase 1 | Complete |
| TEL-01 | Phase 1 | Complete |
| STORE-01 | Phase 1 | Complete |
| STORE-02 | Phase 1 | Complete |
| STORE-03 | Phase 1 | Complete |
| WORK-01 | Phase 2 | Pending |
| WORK-02 | Phase 2 | Pending |
| WORK-03 | Phase 2 | Complete |
| WORK-04 | Phase 2 | Pending |
| BUILD-01 | Phase 2 | Pending |
| BUILD-02 | Phase 2 | Complete |
| BUILD-03 | Phase 2 | Complete |
| BUILD-04 | Phase 2 | Complete |
| EVAL-01 | Phase 3 | Pending |
| EVAL-02 | Phase 3 | Pending |
| EVAL-03 | Phase 3 | Pending |
| EVAL-04 | Phase 3 | Pending |
| EVAL-05 | Phase 3 | Pending |
| SCORE-01 | Phase 3 | Pending |
| SCORE-02 | Phase 3 | Pending |
| AGENT-01 | Phase 4 | Pending |
| AGENT-02 | Phase 4 | Pending |
| AGENT-03 | Phase 4 | Pending |
| AGENT-04 | Phase 4 | Pending |
| AGENT-05 | Phase 4 | Pending |
| TEL-02 | Phase 5 | Pending |
| TEL-03 | Phase 5 | Pending |
| TEL-04 | Phase 5 | Pending |
| TEL-05 | Phase 5 | Pending |
| TEL-06 | Phase 5 | Pending |
| REPORT-01 | Phase 5 | Pending |
| REPORT-02 | Phase 5 | Pending |
| CLI-01 | Phase 5 | Pending |
| CLI-02 | Phase 5 | Pending |

**Coverage:**

- v1 requirements: 37 total (the earlier "33" note was an undercount of the listed REQ-IDs)
- Mapped to phases: 37 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 after roadmap traceability mapping*
