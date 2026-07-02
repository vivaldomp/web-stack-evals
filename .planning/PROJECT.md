# Web Stack Benchmark Platform

## What This Is

An automated evaluation platform that benchmarks AI coding agents on their ability to build complete front-end web applications from a standardized set of assets (prompt + mockup image + skills + MCPs). It runs agents via the Pi SDK, monitors the full execution, builds the generated app in an isolated workspace, renders it with headless Playwright, and automatically computes quality, cost, speed, and visual-fidelity metrics. It is for engineers and researchers who need **reproducible, comparable, measurable** answers about how LLMs, prompts, skills, MCP servers, templates, and web stacks perform — replacing subjective, one-off manual evaluation.

## Core Value

Given the same standardized inputs, the platform produces an objective, reproducible score for a (stack × model × scenario) run — end to end and without human judgment.

## Requirements

### Validated

- **Foundations & Contracts substrate (Phase 1, 2026-07-01)** — the agnostic core downstream depends on: zod-validated `stack.yaml`/`scenario.yaml`/`model` loaders (SPEC-01/02/03), a stamped run manifest + input fingerprint over spec values plus raw asset bytes (SPEC-04, STORE-02), the rep-keyed SQLite schema with idempotent WAL init and append-only event log (STORE-01, TEL-01), the on-disk artifact store with DB-link + path containment (STORE-03), and the `AgentEvent` union / `AgentPort`·`StoragePort`·`EvaluatorPort` isolation seams. 23/23 tests green. *These are contracts, not the running end-to-end slice — the Active items below are validated once the slice runs.*
- **Workspace + Build/Serve Runtime (Phase 2, 2026-07-02)** — the deterministic substrate under real processes: disposable per-run `tmp/run-XXX/` workspace leaving the main tree byte-identical (WORK-01..04), env-stripped `npm ci --ignore-scripts` + per-stage timeout-guarded install/build/start with failures recorded as scored outcomes (BUILD-01/02), headless Playwright screenshot at the declared viewport with `deviceScaleFactor: 1` (BUILD-03), and determinism + isolation self-tests with process-group teardown (BUILD-04). Committed Angular template drives it end-to-end with no agent. *Substrate proven; still upstream of the running matrix row.*
- **Evaluation Pipeline + Scorer (Phase 3, 2026-07-02)** — all four evaluators behind one registry plus composite/raw scoring, deterministic and with no LLM agent in the loop: PixelMatch (EVAL-01), DOM structural presence (EVAL-02), axe accessibility (EVAL-03), and images-only LLM judge (EVAL-04) as pure `EvaluatorPort`s; `buildRegistry()` composes them without editing orchestrator/core (EVAL-05), `evaluateRun()` persists each raw sub-score as its own row separate from the drop-and-renormalized composite (SCORE-01/02). Proven green end-to-end on fixture screenshots by `tests/evalPipeline.integration.test.ts` — the phase checkpoint. 82/82 unit + Phase-3 integration tests green, `core/ports.ts` untouched. *The evaluation half of the slice; wired to real agent output at Phase 4/5.*

### Active

<!-- v1 = one thin vertical slice that exercises the FULL evaluation pipeline on a single matrix row. -->

- [ ] Run one benchmark row end-to-end: Angular + DeepSeek 4 Pro, "dashboard" scenario
- [ ] Agent Runtime wraps the Pi SDK: start session, load prompt + skills + MCPs, send mockup image, run the agent to build the app (rest of system never touches Pi SDK directly)
- [ ] Disposable local temp workspace per run (`tmp/run-XXX/`) — nothing runs inside the main project
- [ ] Application runtime: `npm install` → `npm run build` → start → wait ready (build/lint/test results captured as metrics)
- [ ] Headless Playwright screenshot at the declared viewport
- [ ] Evaluation pipeline (all four, extensible): PixelMatch (visual %) → DOM Diff (structural presence) → Accessibility (axe-core) → LLM Judge (expected vs generated screenshot)
- [ ] Composite score aggregated from the evaluators
- [ ] Event-based telemetry collector (SessionStarted → PromptSent → ToolExecuted → FileWritten → Build* → ScreenshotTaken → *Completed → BenchmarkFinished)
- [ ] Metrics captured: performance (wall/build/startup/render), LLM (in/out tokens, cache read/write, est. cost, TTFT), engineering (files created/edited, lines +/-), agent (iteration count, correction density), tool calls
- [ ] Declarative stack spec (`stack.yaml`: template, commands, port, viewport)
- [ ] Declarative scenario spec (`scenario.yaml`: prompt, expected screenshot, viewport, skills, mcps)
- [ ] Persist to SQLite (runs, stacks, artifacts, events, metrics, screenshots, tool_calls, iterations) + artifact store on disk
- [ ] CLI to run a benchmark and print a terminal summary
- [ ] HTML report of scores, metrics, and screenshots

### Out of Scope

- Full matrix breadth (multiple stacks/models/repetitions in one run) — declarative specs support it; v1 proves one row — **deferred to v2**
- Docker-per-run isolation — local temp dir is enough to start; **deferred to v2**
- Markdown + CSV report formats — HTML + CLI cover v1 — **deferred to v2**
- Comparing prompts / skills / MCPs / engineering strategies (Loop Engineering, SDD) as matrix axes — needs the full matrix first — **deferred**
- CI/CD integration, historical/regression analysis — **deferred**
- Being an IDE, editing code manually, being a dev framework, or deploying to production — **explicitly excluded (non-goal in vision doc)**

## Context

- Vision document lives at repo root `PRODUCT.md`; it is the source of truth for the full framework vision. This `.planning/PROJECT.md` is the GSD working context.
- **All project artifacts (code, docs, comments, configs) are written in English**, despite the Portuguese vision doc.
- Proposed architecture is five independent domains so any component can be swapped without touching the others: CLI/API → Evaluation Orchestrator → {Agent Runtime (Pi SDK), Workspace Runtime (sandbox), Evaluation Runtime (visual/judges)} → Metrics Pipeline + Artifact Store.
- Repo is greenfield; the vision doc includes a proposed directory layout (`assets/`, `stacks/`, `models/`, `evals/`, `src/{orchestrator,agent,sandbox,runtime,telemetry,storage,reports,cli}`, `results/`).
- Everything is declarative-first: the benchmark engine interprets stack.yaml / scenario.yaml and generates the run matrix — the core never hardcodes a stack, model, or scenario.

## Constraints

- **Tech stack**: TypeScript / Node.js (per vision doc: package.json, tsconfig.json, pi.config.ts, bench.config.ts)
- **Agent runtime**: Pi SDK — the only path to the agent; must be fully encapsulated behind the Agent Runtime module
- **Rendering**: Playwright headless for screenshots
- **Storage**: SQLite for structured results (not JSON-only) so cost/correction/file queries need no reprocessing
- **Isolation**: every run in a disposable temp workspace; the main project is never mutated by a run
- **Language**: English for all artifacts

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 = thin vertical slice (1 stack × 1 model × 1 scenario) | Prove the full pipeline end-to-end before scaling the matrix; de-risk everything at once | — Pending |
| All 4 evaluators wired in v1 (not deferred) | Evaluation pipeline is the product's core value and must be extensible from day one | — Pending |
| Local temp dir over Docker for v1 | Simplest sufficient isolation; Docker adds orchestration cost without proving new pipeline logic | — Pending |
| Angular + DeepSeek 4 Pro, dashboard scenario as the v1 row | Matches vision doc examples (deepseek4pro.json, angular template @ 4200, dashboard mockup) | — Pending |
| SQLite + CLI summary + HTML report for v1 | Queryable results + shareable output; Markdown/CSV deferred | — Pending |
| Declarative stack/scenario specs even for a single row | Keeps the core generic so v2 matrix expansion needs no core changes | — Pending |
| English artifacts despite Portuguese vision doc | Explicit user instruction | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-02 after Phase 3 (Evaluation Pipeline + Scorer) complete*
