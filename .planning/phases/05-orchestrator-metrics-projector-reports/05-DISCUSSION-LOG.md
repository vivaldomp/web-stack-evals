# Phase 5: Orchestrator + Metrics Projector + Reports - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 5-Orchestrator + Metrics Projector + Reports
**Areas discussed:** Mockup grounding, `run` CLI shape, CLI summary, HTML report

> **Note:** The four gray areas were presented via AskUserQuestion but the user
> was away (no response in 60s). Per workflow guidance, Claude proceeded with
> recommended defaults grounded in the project's existing principles. Selections
> below are Claude's defaults.
>
> **Second session (2026-07-03, re-run of `/gsd-discuss-phase 5`):** D5-01 was
> re-surfaced for explicit confirmation alongside a "confirm / accept / re-discuss"
> choice. The user was away again (no response in 60s). Per graceful-absence
> handling, the recommended **capability-conditional** default (D5-01) now stands
> as the decision and the CONTEXT.md/STATE.md confirm-before-planning gate was
> cleared. All decisions remain overridable via a future `/gsd-discuss-phase 5`.

---

## Mockup grounding (resolves STATE.md vision-gap blocker)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep DeepSeek, skip image for text-only models | Capability-gate injection; document caveat; keep the named row | ✓ (default) |
| Swap v1 row to a vision-capable model | Mockup grounds the build, but changes the benchmarked subject | |
| Keep DeepSeek, inject image unconditionally | No code change; pays for ignored tokens; behavior stays implicit | |

**Chosen (default):** Keep DeepSeek 4 Pro; make image injection capability-conditional (D5-01).
**Notes:** Scoring is unaffected either way — pixelmatch + judge diff screenshots on the judge's own vision model. This is a product/vision call → **confirm before planning.**

---

## `run` CLI shape (CLI-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Named spec flags | `run --stack angular --model deepseek4pro --scenario dashboard` | ✓ (default) |
| Positional spec names | `run angular deepseek4pro dashboard` — terser, order-sensitive | |
| Single bench.config file | `run --config bench.config.ts` — v2-matrix shaped | |

**Chosen (default):** Named spec flags (D5-02).
**Notes:** Self-documenting, 1:1 with the three spec files, matches CLAUDE.md's commander convention.

---

## CLI summary (REPORT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Scores + headline metrics | Composite, sub-scores, status, one-line headline (wall/cost/tokens/iters) | ✓ (default) |
| Full metric dump | Every folded metric in the terminal | |
| Scores only | Composite + sub-scores + status; metrics HTML-only | |

**Chosen (default):** Scores + headline metrics (D5-03).
**Notes:** Compact terminal footprint; full breakdown reserved for the HTML report.

---

## HTML report (REPORT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Scorecard + full metrics + agent narration | Screenshots + scorecard + metrics table + collapsible turn/tool timeline | ✓ (default) |
| Scorecard + metrics (no narration) | Result-focused; skips the timeline | |
| Minimal scorecard | Screenshots + composite + sub-scores only | |

**Chosen (default):** Scorecard + full metrics + collapsible agent narration (D5-04).
**Notes:** D4-12 already persists narration verbatim specifically to feed this view — data exists at zero extra capture cost.

---

## Claude's Discretion

- Exact per-metric fold rules (backoff/rate-limit attribution TEL-03, correction density D4-11).
- Projector shape (single pass vs per-metric) and read path (`readEvents` vs SQL folds).
- CLI framework (commander vs `parseArgs`), command wiring, exit codes, `bin` entry.
- HTML templating approach (static, no runtime framework).
- Orchestrator module location and run_id threading.
- Model-capability probe mechanics for D5-01 and caveat wording.

## Deferred Ideas

- Matrix/multi-row reports, leaderboards, comparison heatmaps — v2.
- Markdown/CSV export — v2.
- Live-streaming dashboard — Out of Scope.
- Swapping the v1 model to a vision-capable one — not chosen; revisit for a future vision row.
- Lighthouse perf/a11y in the report — v2.
</content>
