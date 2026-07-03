# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-07-03
**Phases:** 5 | **Plans:** 31 | **Tasks:** 48

### What Was Built
- The agnostic core substrate: zod-strict `stack.yaml`/`scenario.yaml`/`model.json` loaders, a stamped run manifest + input fingerprint, an 11-table rep-keyed SQLite schema (WAL, idempotent init), an append-only event log, and the `AgentPort`/`StoragePort`/`EvaluatorPort` isolation seams (Phase 1).
- The deterministic runtime: disposable `tmp/<run_id>/` workspace leaving the main tree byte-identical, env-stripped `npm ci --ignore-scripts` with per-stage timeouts, headless Playwright screenshot at fixed viewport/DPR with frozen time/motion, and process-group teardown — driven end-to-end by a committed Angular template with no agent (Phase 2).
- The full four-evaluator scoring pipeline behind one registry — PixelMatch, DOM structural presence, axe accessibility, images-only LLM judge — with drop-and-renormalize composite and raw sub-scores persisted separately, proven green on fixture screenshots (Phase 3).
- The Pi SDK fully encapsulated behind `AgentPort` (single importer, enforced by an import-boundary test), with capability-conditional image injection and verbatim per-turn usage/TTFT capture (Phase 4).
- The end-to-end orchestrator + metrics projector + reports: `runBenchmark` sequences agent → build → render → evaluate → score → persist; every metric is a fold of the event log; CLI terminal summary + self-contained HTML report. Confirmed by a live paid row (`run-20260703173100-f26ce5`: SCORED, exit 0, 129.1s, $0.017, 448.3k tok, 21 iters) (Phase 5).

### What Worked
- **Deterministic-substrate-first build order.** Proving ~80% of the pipeline on fixtures before the flaky/paid Pi agent landed (Phase 4) meant the agent was the *only* new variable at integration — de-risked the expensive dependency instead of debugging it against untested infrastructure.
- **Ports as the single seam.** `AgentPort`/`StoragePort`/`EvaluatorPort` + the import-boundary test let every phase author against fakes with zero network/cost; the sole-importer guard caught boundary regressions mechanically.
- **Projections over inline metrics.** Folding an append-only event log into metrics/tool_calls/iterations (never computed inline) made telemetry idempotent and re-derivable — golden-fixture + property tests pinned it.
- **Declarative-first even for one row.** No stack/model/scenario hardcoded in core, so the v2 matrix expansion needs no core changes.

### What Was Inefficient
- **STATE.md progress bar drifted repeatedly** — percent and the ASCII bar fell out of sync across several plan closes and needed manual correction (observed at 90%/94%/97%). A known gsd-tools regex quirk; worked around by hand each time.
- **The vision-model gap surfaced late.** No vision-capable DeepSeek model exists in Pi 0.80.3; only caught at Phase 5, resolved by D5-01 making image injection capability-conditional. Earlier capability probing during Phase 4 planning would have surfaced it a phase sooner.
- **Milestone-close accomplishment extraction is noisy** — the auto-extractor pulled a few malformed one-liners (bare filenames, `[Rule N - Blocking]` fragments) from SUMMARY.md files that had to be pruned by hand.

### Patterns Established
- **Sole-importer boundary tests** for any paid/external dependency (Pi SDK) — enforce encapsulation in CI, not by convention.
- **Capability-conditional feature gates** (e.g. `modelAcceptsImage` → `injectImage`) instead of hard assumptions about model inputs.
- **Distributive `Omit` caution** — bare `Omit<Union, K>` collapses discriminated unions; storage-owned fields (`seq`) belong behind the port, stamped in-transaction.
- **Two-tier vitest** (fast unit vs slow integration) with live/paid tests gated out of the default suite via glob.

### Key Lessons
1. Land the risky, expensive dependency last, behind a single port, on top of a fully-tested deterministic substrate — the integration cost collapses to one variable.
2. Probe external-model *capabilities* (not just availability) during planning; a text-only model silently paying for discarded image tokens is a design smell caught cheaply up front.
3. Metrics that are folds of an append-only log are idempotent and auditable; inline counters are neither.
4. Keep the core declarative from the first row — the cost is near-zero at N=1 and it removes all core churn for the N>1 matrix.

### Cost Observations
- Live benchmark row: $0.017 for one full Angular + DeepSeek 4 Pro dashboard build (448.3k tokens, 21 iterations, 129.1s wall).
- Phase-4 smoke row on `deepseek-v4-flash`: $0.0066 — cheap enough to run real integration proofs, not just fakes.
- 177/177 unit tests green at close; no paid calls in the default suite (all gated behind the integration config).

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 31 | Deterministic-substrate-first order; ports + import-boundary tests established as the core discipline |

### Cumulative Quality

| Milestone | Tests | Src LOC | Requirements Validated |
|-----------|-------|---------|------------------------|
| v1.0 | 177 unit + integration/isolation (12/12) | ~3,884 TS | 37/37 |

### Top Lessons (Verified Across Milestones)

1. Risky dependency last, behind one port, on a tested substrate. *(v1.0 — re-verify next milestone.)*
2. Metrics as folds of an append-only log, never inline. *(v1.0 — re-verify next milestone.)*
