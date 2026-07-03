# Phase 5: Orchestrator + Metrics Projector + Reports - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 5-Orchestrator + Metrics Projector + Reports
**Areas discussed:** Mockup grounding, `run` CLI shape, terminal summary, HTML
report, failed-run rendering, `report` target, auto-emit, exit codes, screenshot
embedding, rep handling, correction-density definition, backoff attribution

> **Session history:** The first two discuss-phase sessions (2026-07-02 and an
> earlier 2026-07-03 pass) ran with the user away — Claude proposed defaults.
> **This third session (2026-07-03) was fully interactive:** the user chose
> "re-discuss from scratch" and **explicitly confirmed all 12 decisions**
> (D5-01–D5-12). Selections below are the user's actual choices.

---

## D5-01 — Mockup grounding (resolves STATE.md vision-gap blocker)

| Option | Description | Selected |
|--------|-------------|----------|
| Capability-conditional | Keep DeepSeek; inject mockup only when the model declares image input; report the caveat | ✓ user |
| Swap v1 to a vision model | Mockup grounds the build but changes the benchmarked subject | |
| Always inject | No code change; pays for ignored tokens; behavior stays implicit | |

**Notes:** Scoring unaffected — the judge diffs screenshots on its own vision model.

## D5-02 — `run` CLI shape (CLI-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Named flags | `run --stack angular --model deepseek4pro --scenario dashboard` | ✓ user |
| Positional args | `run angular deepseek4pro dashboard` — order-sensitive | |
| Single bench.config | v2-matrix shaped; no v1 payoff | |

## D5-03 — Terminal summary (REPORT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Compact scores + headline | Composite + 4 sub-scores + status + one-line headline | ✓ user |
| Full metric dump | Every folded metric in the terminal | |
| Scores only | Too thin at a glance | |

## D5-04 — HTML report (REPORT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Full post-mortem | Screenshots + scorecard + full metrics + collapsible narration/timeline | ✓ user |
| No narration | Result-focused; skips the timeline | |
| Minimal scorecard | Screenshots + scores only | |

## D5-05 — Failed / capped run rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Scored data point | Status + folded metrics; never a crash/blank (D2-13/D4-02) | ✓ user |
| Error/blank state | Discards the partial data point | |

## D5-06 — `report` target (CLI-02)

| Option | Description | Selected |
|--------|-------------|----------|
| run_id, default `--latest` | `report <run_id>`; bare `report` = most recent | ✓ user |
| run_id required only | No latest shortcut | |
| Results path | Leaks storage layout into the CLI | |

## D5-07 — Does `run` auto-emit HTML?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-write every run | Prints summary + writes `results/<run_id>/report.html` | ✓ user |
| Summary only; report separate | HTML only after a separate `report` step | |

## D5-08 — Exit code on failed/capped runs

| Option | Description | Selected |
|--------|-------------|----------|
| 0 when benchmarked, non-zero only on tooling error | A scored row = success; harness failure = non-zero | ✓ user |
| Non-zero on any failed/capped run | Conflates "tool broke" with "result was low" | |

## D5-09 — HTML screenshot embedding

| Option | Description | Selected |
|--------|-------------|----------|
| Inline base64 | One truly portable file; larger | ✓ user |
| Linked artifact files | Smaller HTML; breaks unless the folder travels with it | |

## D5-10 — Repeated-run / rep handling

| Option | Description | Selected |
|--------|-------------|----------|
| Append a new rep row | History accumulates; matches rep-keyed schema | ✓ user |
| Overwrite prior row | Discards run-to-run variance | |
| Require explicit `--rep` | Ceremony for v1's single row | |

## D5-11 — What counts as a "correction" (D4-11)

| Option | Description | Selected |
|--------|-------------|----------|
| Any 2nd+ write to the same path | Purely event-derived; folds deterministically (D-24) | ✓ user |
| Only rewrites after a failure | Couples projector to stage outcomes; fragile | |

## D5-12 — Rate-limit / backoff attribution (TEL-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Its own metric (`backoff_wait_ms`) | Throttling is visible, not blamed on model/stack | ✓ user |
| Silently subtracted from wall time | Hides why a run was slow | |

---

## Claude's Discretion (unchanged — mechanical, planner's call)

- Exact fold arithmetic once D5-11/D5-12 definitions apply (seq ordering, interval summation).
- Projector shape (single pass vs per-metric) and read path (`readEvents` vs SQL folds).
- CLI framework (commander vs `parseArgs`) and `bin` entry wiring.
- HTML templating approach (static, no runtime framework).
- Orchestrator module location and run_id threading.
- Model-capability probe mechanics for D5-01 and caveat wording.

## Deferred Ideas

- Matrix/multi-row reports, leaderboards, comparison heatmaps — v2.
- Markdown/CSV export — v2.
- Live-streaming dashboard — Out of Scope.
- Swapping the v1 model to a vision-capable one — not chosen; revisit for a future vision row.
- Lighthouse perf/a11y in the report — v2.
