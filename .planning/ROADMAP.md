# Roadmap: Web Stack Benchmark Platform

## Milestones

- ✅ **v1.0 MVP** — Phases 1–5 (shipped 2026-07-03) — one green benchmark row (Angular + DeepSeek 4 Pro + dashboard) end-to-end. Full detail: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–5) — SHIPPED 2026-07-03</summary>

- [x] Phase 1: Foundations & Contracts (5/5 plans) — completed 2026-07-01
- [x] Phase 2: Workspace + Build/Serve Runtime (6/6 plans) — completed 2026-07-02
- [x] Phase 3: Evaluation Pipeline + Scorer (7/7 plans) — completed 2026-07-02
- [x] Phase 4: Agent Runtime (Pi SDK adapter) (6/6 plans) — completed 2026-07-03
- [x] Phase 5: Orchestrator + Metrics Projector + Reports (7/7 plans) — completed 2026-07-03

Deterministic-substrate-first build order: the agnostic core (contracts, specs, event log, storage), then the workspace + build/serve/render runtime and the four-evaluator scoring pipeline (both provable green with no LLM in the loop), then the Pi SDK behind a single port, then the orchestrator wiring the single row end-to-end. Full phase details, goals, success criteria, and per-wave plan breakdown archived in [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md).

</details>

### 📋 v1.1+ (Planned)

Next milestone not yet scoped. Start with `/gsd-new-milestone` (questioning → research → requirements → roadmap). v2 candidates already tracked in the archived requirements: matrix generator (stack × model × scenario × reps), scheduler with concurrency/resume, Docker-per-run isolation, Lighthouse a11y/perf, Markdown/CSV + comparison heatmap reports, and CI/regression analysis.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundations & Contracts | v1.0 | 5/5 | Complete | 2026-07-01 |
| 2. Workspace + Build/Serve Runtime | v1.0 | 6/6 | Complete | 2026-07-02 |
| 3. Evaluation Pipeline + Scorer | v1.0 | 7/7 | Complete | 2026-07-02 |
| 4. Agent Runtime (Pi SDK adapter) | v1.0 | 6/6 | Complete | 2026-07-03 |
| 5. Orchestrator + Metrics Projector + Reports | v1.0 | 7/7 | Complete | 2026-07-03 |
