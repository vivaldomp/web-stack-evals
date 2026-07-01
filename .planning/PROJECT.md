# Web Stack Benchmark Platform

## What This Is

An automated evaluation platform that benchmarks AI coding agents on their ability to build complete front-end web applications from a standardized set of assets (prompt + mockup image + skills + MCPs). It runs agents via the Pi SDK, monitors the full execution, builds the generated app in an isolated workspace, renders it with headless Playwright, and automatically computes quality, cost, speed, and visual-fidelity metrics. It is for engineers and researchers who need **reproducible, comparable, measurable** answers about how LLMs, prompts, skills, MCP servers, templates, and web stacks perform — replacing subjective, one-off manual evaluation.

## Core Value

Given the same standardized inputs, the platform produces an objective, reproducible score for a (stack × model × scenario) run — end to end and without human judgment.

## Requirements

### Validated

(None yet — ship to validate)

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

- Vision document lives at repo root `PROJECT.md` (Brazilian Portuguese); it is the source of truth for the full framework vision. This `.planning/PROJECT.md` is the GSD working context.
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
*Last updated: 2026-07-01 after initialization*
