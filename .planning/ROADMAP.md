# Roadmap: Web Stack Benchmark Platform

## Overview

This roadmap follows a **deterministic-substrate-first** build order: prove ~80% of the pipeline on fixtures before the flaky, paid, external agent ever lands. We first lay the agnostic core (contracts, specs, event log, storage), then stand up the workspace + build/serve/render runtime and the full four-evaluator scoring pipeline — both provable green with **no LLM in the loop**. Only then do we plug in the Pi SDK behind a single port, so the agent is the one and only new variable. Finally the orchestrator wires the single row (Angular + DeepSeek 4 Pro + dashboard) end-to-end, folds the event log into metrics, and renders the CLI summary and HTML report. Nothing in v1 touches matrix/scheduler/Docker — those are a v2 loop over proven code.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundations & Contracts** - Agnostic core: ports, canonical event union, zod spec loaders, run manifest, SQLite schema + artifact store (completed 2026-07-01)
- [x] **Phase 2: Workspace + Build/Serve Runtime** - Disposable isolated workspace runs a raw stack template through install→build→serve→deterministic screenshot (no agent) (completed 2026-07-02)
- [x] **Phase 3: Evaluation Pipeline + Scorer** - All four evaluators behind one registry + composite/raw scoring, proven green on fixture screenshots (no LLM agent) (completed 2026-07-02)
- [ ] **Phase 4: Agent Runtime (Pi SDK adapter)** - Pi SDK behind a single AgentPort: inject prompt+skills+image, build the app, normalize events, capture usage/TTFT
- [ ] **Phase 5: Orchestrator + Metrics Projector + Reports** - Wire the single row end-to-end; fold events into metrics; CLI summary + static HTML report

## Phase Details

### Phase 1: Foundations & Contracts

**Goal**: The agnostic core substrate exists — specs load and validate, every run gets a stamped manifest, and events/artifacts/results have a canonical home to write to. Everything downstream depends on these contracts.
**Depends on**: Nothing (first phase)
**Requirements**: SPEC-01, SPEC-02, SPEC-03, SPEC-04, TEL-01, STORE-01, STORE-02, STORE-03
**Success Criteria** (what must be TRUE):

  1. A malformed stack.yaml, scenario.yaml, or model config is rejected with a clear zod validation error before any run starts.
  2. Loading a valid stack.yaml + scenario.yaml + model config yields typed spec objects that the rest of the system consumes (no stack/model/scenario hardcoded in core).
  3. Starting a run produces a stamped run manifest (spec snapshot + dependency/model/browser versions + input fingerprint) persisted to the runs row.
  4. The SQLite DB initializes with the full rep-keyed schema (runs, stacks, artifacts, events, metrics, screenshots, tool_calls, iterations, evaluations) in WAL/single-writer mode, and an event appended to the log reads back identically.
  5. An artifact written to the on-disk store is retrievable via a link stored in the DB.

**Plans**: 5/5 plans complete
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold Node24/TS6 project + core contracts (AgentEvent union, ports, run_id, units)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — zod-strict spec loaders (stack/scenario/model) + v1-row fixtures (SPEC-01/02/03)
- [x] 01-03-PLAN.md — SQLite rep-keyed schema + WAL idempotent init + append-only event log (STORE-01, TEL-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — On-disk artifact store with DB link + path containment (STORE-03)
- [x] 01-05-PLAN.md — Run manifest + input fingerprint (bytes) persisted to runs row (SPEC-04, STORE-02)

### Phase 2: Workspace + Build/Serve Runtime

**Goal**: A raw stack template runs through the full deterministic build-and-render pipeline in a disposable, isolated workspace and produces a screenshot — with zero agent involvement. This proves the deterministic substrate under real processes.
**Depends on**: Phase 1
**Requirements**: WORK-01, WORK-02, WORK-03, WORK-04, BUILD-01, BUILD-02, BUILD-03, BUILD-04
**Success Criteria** (what must be TRUE):

  1. Running the pipeline creates a fresh `tmp/run-XXX/` workspace and the main project tree is byte-identical before and after the run.
  2. Dependencies install with lifecycle scripts disabled (`npm ci --ignore-scripts`) and an env-stripped spawn; install/build/start each abort on their own per-stage timeout.
  3. A build, lint, or start failure is recorded as a scored outcome (not an uncaught crash), and build/lint/test results are captured as metrics.
  4. A headless Playwright screenshot of the served app is captured at the declared viewport with `deviceScaleFactor: 1` and saved to the artifact store.
  5. Determinism controls hold — screenshotting the same app twice yields near-identical images (self-test passes) — and after teardown no dev-server process or port is left held.

**Plans**: 5/6 plans executed
**Wave 1**

- [x] 02-01-PLAN.md — Foundational contracts + deps: playwright/execa/pixelmatch/pngjs pins, Stage/StackSchema lint-test-timeout fields, RenderPort seam, two-tier vitest config

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Committed Angular template scaffold (stacks/angular/template/) + real stacks/angular.yaml spec
- [x] 02-03-PLAN.md — Workspace copy/retention, env allowlist + timeout-guarded stage runner + process-group teardown, StoragePort adapter
- [x] 02-04-PLAN.md — RenderPort implementation (Playwright determinism controls + screenshot capture) + determinism self-test

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-05-PLAN.md — runStack() pipeline orchestration: fatal-stage short-circuit, non-fatal lint/test, dist-size metric, readiness gate, screenshot, teardown

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-06-PLAN.md — End-to-end integration tests against the real template (happy path, forced failures/timeouts, isolation self-test)

### Phase 3: Evaluation Pipeline + Scorer

**Goal**: Given an expected/generated screenshot pair (plus rendered DOM), the platform computes all four evaluator sub-scores and a normalized composite — deterministically, with no LLM agent in the loop. **Checkpoint: full pipeline green without the agent.**
**Depends on**: Phase 1 (runs on fixture screenshots; consumes Phase 2 output at wire-up)
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, SCORE-01, SCORE-02
**Success Criteria** (what must be TRUE):

  1. Feeding a matched expected/generated pair through the pipeline yields four sub-scores: PixelMatch %, DOM structural presence, axe-core accessibility, and LLM-judge verdict.
  2. A new evaluator can be registered through the `Evaluator` interface + registry without editing orchestrator/core code.
  3. The LLM judge runs against an independent model family at temp=0 with images-only input and returns a structured rubric verdict.
  4. Each run persists raw sub-scores separately from the normalized composite score.
  5. The full evaluation pipeline runs green end-to-end on fixture screenshots with no agent present.

**Plans**: 3/7 plans executed
**Wave 1**

- [x] 03-01-PLAN.md — Deps (sharp/@axe-core/playwright/@earendil-works/pi-ai) + ScenarioSchema expectedElements/evaluatorWeights + evaluations/composite/diff-screenshot/judge-cache storage helpers (SCORE-02)
- [x] 03-02-PLAN.md — renderWithPage() shared render-pass seam (D3-17) + composeScore() weighted-mean/renormalize scorer (SCORE-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-03-PLAN.md — PixelMatch (EVAL-01) + LLM Judge (EVAL-04) evaluators, faux-provider tested
- [x] 03-04-PLAN.md — DOM structural-presence (EVAL-02) + axe accessibility (EVAL-03) evaluators, live-page tested
- [x] 03-05-PLAN.md — evaluateRun() orchestrator: registry-driven evaluation + drop/renormalize persistence (SCORE-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-06-PLAN.md — buildRegistry(): always-on pixelmatch/axe/judge + conditional dom (EVAL-05)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-07-PLAN.md — End-to-end fixture pipeline integration proof (ROADMAP Phase 3 Success Criterion 5)

### Phase 4: Agent Runtime (Pi SDK adapter)

**Goal**: The Pi SDK is driven behind a single `AgentPort` — a session builds the app from prompt + skills + mockup image, and every SDK event and usage figure is normalized into the platform's canonical stream. The agent is the only new variable atop a proven pipeline.
**Depends on**: Phase 1, Phase 2
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05
**Success Criteria** (what must be TRUE):

  1. Only the Agent Runtime module imports the Pi SDK; the orchestrator and all other modules depend solely on `AgentPort`.
  2. Starting a session injects the scenario prompt, skills, and mockup image, and the agent builds the app in the disposable workspace using Pi native tools (no MCP required for the v1 row).
  3. Pi SDK events are normalized into the canonical `AgentEvent` stream and appended to the event log.
  4. Raw per-turn usage (input / output / cache-read / cache-write tokens + cost) is captured verbatim, and TTFT is derived from the event stream.

**Plans**: 5/6 plans executed

- [x] 04-01-PLAN.md
- [x] 04-02-PLAN.md
- [x] 04-03-PLAN.md
- [x] 04-04-PLAN.md
- [x] 04-05-PLAN.md
- [ ] 04-06-PLAN.md

### Phase 5: Orchestrator + Metrics Projector + Reports

**Goal**: The whole thing runs as one green benchmark row — Angular + DeepSeek 4 Pro, dashboard — folding the event log into metrics and rendering a CLI summary and a shareable HTML report.
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4
**Requirements**: TEL-02, TEL-03, TEL-04, TEL-05, TEL-06, REPORT-01, REPORT-02, CLI-01, CLI-02
**Success Criteria** (what must be TRUE):

  1. `run` executes the full row end-to-end from specs (agent → build → render → evaluate → score → persist) and exits with a stored, complete run.
  2. Every metric — performance (wall/build/startup/render, rate-limit time attributed separately), engineering (files created/edited, lines +/-), iteration count + correction density, and tool-call counts by type — is a projection folded from the event log, never computed inline.
  3. After a run, the CLI prints a terminal summary with the composite score, sub-scores, and key metrics.
  4. `report` regenerates a static HTML report from stored results, showing the expected/generated screenshots side by side with the visual diff, scores, and metrics.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations & Contracts | 5/5 | Complete    | 2026-07-01 |
| 2. Workspace + Build/Serve Runtime | 6/6 | Complete    | 2026-07-02 |
| 3. Evaluation Pipeline + Scorer | 7/7 | Complete    | 2026-07-02 |
| 4. Agent Runtime (Pi SDK adapter) | 5/6 | In Progress|  |
| 5. Orchestrator + Metrics Projector + Reports | 0/TBD | Not started | - |
