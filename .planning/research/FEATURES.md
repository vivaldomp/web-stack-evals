# Feature Research

**Domain:** Automated benchmark / evaluation platform for AI coding agents building front-end web apps (scored on visual fidelity, structure, accessibility, cost, speed, self-correction)
**Researched:** 2026-07-01
**Confidence:** HIGH (feature taxonomy is well-established across SWE-bench, WebArena/VISTA, terminal-bench, inspect-ai, promptfoo, braintrust, Design2Code, and visual-regression tooling; mapping to this domain is synthesis)

## How to read this doc

The question spans 8 functional categories. For each, features are tagged
**[TABLE STAKES]**, **[DIFFERENTIATOR]**, or **[ANTI-FEATURE]**, with complexity
and a v1/later flag. v1 = the thin vertical slice defined in PROJECT.md
(1 stack × 1 model × 1 scenario, all 4 evaluators). "Later" = v2+.

The dominant lesson from the prior art: **a benchmark that isn't reproducible
and fair is not a benchmark — it's an anecdote.** Every table-stakes call below
traces back to reproducibility, isolation, or determinism. The differentiators
all trace back to the platform's stated Core Value: objective, queryable
comparison across agents/stacks/prompts, especially the self-correction metrics
that comparable tools mostly ignore.

---

## Category 1 — Run Orchestration (matrix: stack × model × scenario × repetitions)

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| Declarative run spec (stack.yaml / scenario.yaml / model.json) interpreted by a generic engine | TABLE STAKES | MEDIUM | **v1** | Non-negotiable per PROJECT.md. Core never hardcodes a stack/model/scenario. v1 loads and runs exactly one row through the same code path v2 will fan out. |
| Matrix expansion (cartesian product of axes → run list) | TABLE STAKES (for the product), deferred for v1 | MEDIUM | later | v1 proves one row; the matrix generator is the trivial part once specs exist. Build the spec loader v1, the cartesian generator v2. |
| **Repetitions per cell + variance reporting (pass@k, mean±stddev)** | DIFFERENTIATOR | MEDIUM | later | Agent trajectories are stochastic; single-run scores overstate capability (confirmed pitfall in SWE-bench literature). Reporting mean/variance over N reps is what separates a credible benchmark from a demo. v1 can run N=1 but the schema must allow N>1 rows per cell from day one. |
| Deterministic run IDs + full input fingerprint (hash of prompt+image+skills+mcp+stack+model+seed) | TABLE STAKES | LOW | **v1** | Reproducibility anchor. Two runs with the same fingerprint should be comparable; a changed input must produce a new fingerprint. Cheap to add early, expensive to retrofit. |
| Scheduler / concurrency control (parallel runs, resource caps) | TABLE STAKES for scale | MEDIUM-HIGH | later | Needed once the matrix is real (dozens–hundreds of runs). v1 is sequential. |
| Resume / retry of failed cells without rerunning the whole matrix | DIFFERENTIATOR | MEDIUM | later | Long matrices will have flaky cells (network, model timeouts). Cell-level idempotency saves hours. Depends on per-cell run IDs. |
| Fair-config enforcement (same prompt/skills/turn-budget/timeout across cells unless that axis is the variable under test) | TABLE STAKES | MEDIUM | later (matters at v2) | Fairness is the whole point of a benchmark. If you compare React vs Angular but give one a better prompt, the result is noise. The engine must make "what varies" explicit. |
| "Everything as a matrix axis" — prompts, skills, MCPs, engineering strategies (Loop Eng, SDD) as first-class axes | DIFFERENTIATOR | MEDIUM | later | Vision doc's endgame. The declarative model already supports it; this is config, not new core. Strong differentiator vs SWE-bench (fixed harness) — this platform benchmarks the *scaffolding*, not just the model. |

---

## Category 2 — Agent Execution & Telemetry

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| Agent Runtime encapsulating the Pi SDK (start session, load prompt/skills/MCP, send image, run) | TABLE STAKES | MEDIUM-HIGH | **v1** | The only path to the agent. Rest of system never touches Pi SDK — this is the swap-a-model seam. Highest-risk v1 module (external SDK, image input, MCP loading). |
| Event-based telemetry stream (SessionStarted → PromptSent → ToolExecuted → FileWritten → Build* → ScreenshotTaken → *Completed → BenchmarkFinished) | TABLE STAKES | MEDIUM | **v1** | Decoupling telemetry from execution (events, not inline logging) is what makes later metrics free. Everything downstream is a fold over this event log. |
| LLM cost/token telemetry (input, output, cache read/write, est. cost, TTFT) | TABLE STAKES | MEDIUM | **v1** | "How much does it cost to generate a React app?" is a headline question in the vision doc. Cost per run must be first-class, not derived guesswork. Depends on Pi SDK exposing token/usage data. |
| Engineering telemetry (files created/edited, lines +/−) | TABLE STAKES | LOW-MEDIUM | **v1** | Derivable from FileWritten/edit events + diffing the workspace. Cheap given the event stream. |
| Tool-call accounting (read/write/edit/bash/grep/find/mcp counts) | TABLE STAKES | LOW | **v1** | Fold over ToolExecuted events. Feeds behavioral comparison ("which model greps more"). |
| **Iteration count (turns-to-success, build-fail → retry cycles)** | DIFFERENTIATOR | MEDIUM | **v1** | The signature metric. Measures self-correction capability — almost no comparable tool captures this cleanly. Requires correlating build/test failures with subsequent agent turns. |
| **Correction density (corrections / generated files)** | DIFFERENTIATOR | MEDIUM | **v1** | Second signature metric. Normalizes churn by project size so a 3-file app and a 30-file app compare fairly. Depends on iteration + engineering telemetry. |
| Full agent trajectory capture (ordered turns, tool inputs/outputs, reasoning) | DIFFERENTIATOR | MEDIUM | **v1** (store raw) / later (analyze) | Recent research ("dissecting model behavior through agent trajectories") shows trajectories are the richest signal. Capture the raw stream in v1 (it's just the event log persisted); build trajectory *analysis/replay* later. |
| Live streaming dashboard of a run in progress | ANTI-FEATURE (for v1/v2) | HIGH | no | Seductive but it's IDE/observability-tool scope, not benchmark scope. A benchmark is batch, not interactive. **Alternative:** write events to SQLite as they occur; tail the DB/log if you must watch. Non-goal in vision doc ("not an IDE for agents"). |

---

## Category 3 — Sandbox / Workspace Isolation

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| Disposable per-run temp workspace (`tmp/run-XXX/{app,logs,screenshots,artifacts}`) | TABLE STAKES | LOW-MEDIUM | **v1** | The main project is never mutated by a run. Isolation is a reproducibility precondition: run N must not see run N−1's state. |
| Clean teardown + artifact preservation (delete workspace, keep artifacts) | TABLE STAKES | LOW | **v1** | Disk fills up fast with node_modules per run. Copy out screenshots/logs/diffs, then nuke the tree. Retention policy config later. |
| Network/filesystem/host isolation levels (the inspect-ai three-axis model: tooling / host / network) | TABLE STAKES for untrusted code | MEDIUM-HIGH | later | You are running LLM-generated `npm install` + arbitrary code. At scale this is a real attack surface (supply-chain, host escape). v1 accepts local-temp-dir risk consciously; **flag: revisit before any shared/CI runner.** |
| Docker-per-run isolation | TABLE STAKES for v2, ANTI-FEATURE for v1 | HIGH | later (explicitly v2 in PROJECT.md) | Docker adds orchestration cost without proving new pipeline logic. Local temp dir is sufficient to validate the pipeline. **Alternative for v1:** temp dir + process-level cleanup. The vision doc's `runtime/docker.ts` is a placeholder. |
| Pinned toolchain (Node version, package-manager version, lockfile-frozen installs) | TABLE STAKES | LOW-MEDIUM | **v1** | SWE-bench's #1 reproducibility lesson: pin the build environment or results drift across machines/time. Use `npm ci` (lockfile) not `npm install`; pin Node via the stack spec. |
| Offline / cached dependency mirror | DIFFERENTIATOR | MEDIUM | later | Registry outages and version drift silently poison a long matrix. A local npm cache/mirror makes runs deterministic and fast. Depends on pinned toolchain. |

---

## Category 4 — App Build / Run (application runtime)

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| Lifecycle: install → build → start → wait-ready | TABLE STAKES | MEDIUM | **v1** | Driven by the stack spec's declared commands + port. "Wait-ready" (poll the port / health check with timeout) is the fiddly part — servers report ready before they actually render. |
| Build/lint/test/coverage capture as metrics (not just pass/fail) | TABLE STAKES | MEDIUM | **v1** (build) / later (lint/test/coverage) | Build success is the gate for iteration-count. Lint/test/coverage are "extra metrics" (vision doc) — wire build in v1, add the rest as the stack specs mature. |
| Per-stage timeouts + hard kill | TABLE STAKES | LOW-MEDIUM | **v1** | An agent can produce a project that hangs on `npm start` forever. Without timeouts one bad cell stalls the whole matrix. |
| Deterministic viewport + wait-for-render before screenshot | TABLE STAKES | MEDIUM | **v1** | Screenshot fidelity depends entirely on capturing after fonts/layout/animation settle. Flaky screenshots = flaky visual scores. Use Playwright's wait-for-network-idle / element-visible, and freeze animations. |
| Graceful "build failed / never rendered" handling (record as a scored outcome, don't crash the run) | TABLE STAKES | LOW-MEDIUM | **v1** | A failed build is data (score 0, iteration count high), not an exception. The pipeline must produce a row for failures. |
| Multi-port / multi-service apps (backend + frontend) | ANTI-FEATURE (for this product) | HIGH | no | Scope is front-end apps. Full-stack orchestration is a different benchmark. **Alternative:** keep scenarios front-end-only; mock any API in the scenario assets. |

---

## Category 5 — Evaluation Pipeline (visual / DOM / a11y / LLM-judge)

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| Extensible evaluator pipeline (pluggable stages, each emits a sub-score) | DIFFERENTIATOR (and architectural table-stakes here) | MEDIUM | **v1** | Design the evaluator interface once; PixelMatch/DOM/a11y/Judge are four implementations of it. inspect-ai's dataset→task→solver→scorer shape is the reference. This extensibility *is* a competitive advantage vs single-metric tools. |
| PixelMatch — pixel-diff visual similarity % | TABLE STAKES | LOW | **v1** | Cheap, deterministic baseline. **Known weakness (Design2Code):** raw pixel diff is brittle to trivial shifts and rewards blank/near-blank pages. Keep it, but never let it be the only visual signal — pair with the judge. |
| DOM Diff — structural presence (button/sidebar/cards/heading exist?) | TABLE STAKES | MEDIUM | **v1** | "Two screens can look alike but have completely different HTML." This is Design2Code's "low-level element matching." Requires an expected-structure spec per scenario (selectors/roles to check). |
| Accessibility eval (axe-core) | TABLE STAKES | LOW-MEDIUM | **v1** | axe-core via Playwright is a solved, deterministic integration. Measures a quality dimension the others miss. |
| Lighthouse / WCAG full audit | DIFFERENTIATOR | MEDIUM | later | Vision doc mentions it; axe-core covers the a11y core for v1. Add Lighthouse (perf/best-practices/SEO scores) when quality axes expand. Slower + flakier than axe. |
| LLM Judge — VLM compares expected vs generated screenshot (layout/spacing/typography/missing/extra) | DIFFERENTIATOR | MEDIUM | **v1** | SOTA for UI fidelity (Design2Code CLIP + VLM-judge, VISTA). Captures perceptual quality pixel-diff can't. **This is where the platform's judgment lives.** Depends on a multimodal model endpoint. |
| Structured judge output (rubric → per-dimension scores, not one number) | TABLE STAKES *within* the judge | MEDIUM | **v1** | A single "8/10" is unusable for comparison. Force the judge to emit layout/spacing/typography/missing/extra as separate fields. Enables per-dimension aggregation. |
| Judge reproducibility controls (fixed judge model+version, temp=0, pinned rubric prompt, self-consistency over k samples) | TABLE STAKES | MEDIUM | **v1** (temp=0 + pinned) / later (k-sample) | LLM-judge is the least reproducible evaluator. Pin the judge model version and rubric; the judge config is part of the run fingerprint. Multi-sample majority vote is a later robustness upgrade. |
| Judge-vs-deterministic disagreement flagging | DIFFERENTIATOR | LOW-MEDIUM | later | When PixelMatch says 95% but the judge says "wrong layout," surface it — it's the most informative signal and a calibration check on both. |
| Human-in-the-loop scoring / manual override | ANTI-FEATURE | MEDIUM | no | Directly contradicts Core Value ("without human judgment"). The whole point is eliminating subjective one-off evaluation. **Alternative:** if you need ground truth, do a *one-time offline* human calibration of the judge, not per-run human scoring. |

---

## Category 6 — Scoring & Aggregation

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| Composite score from evaluator sub-scores (weighted combination) | TABLE STAKES | LOW-MEDIUM | **v1** | Required deliverable. Keep the weighting **declarative and versioned** — the weights are a policy that will change, and changing them retroactively invalidates comparisons. |
| Store raw sub-scores alongside the composite (never only the rollup) | TABLE STAKES | LOW | **v1** | You must be able to re-weight without re-running. Persist every evaluator's raw output; composite is a derived, recomputable view. |
| Normalization across evaluators (0–1 scale, comparable units) | TABLE STAKES | LOW-MEDIUM | **v1** | Pixel % , axe violation counts, and a judge 1–10 are not addable as-is. Define per-evaluator normalization. |
| Aggregation across repetitions (mean, median, stddev, pass@k) | DIFFERENTIATOR | MEDIUM | later | Ties to repetitions (Cat 1). The honest way to report stochastic agents. Schema-ready in v1 (rows keyed by rep), computed in v2. |
| Cross-cell rankings / leaderboards (per stack, per model, per cost) | DIFFERENTIATOR | MEDIUM | later | The comparative payoff. Pure SQL over the results DB once the matrix exists. |
| Cost/quality tradeoff scoring (score per dollar, score per second) | DIFFERENTIATOR | LOW | later | Cheap to compute, high analytical value — "best model per dollar" is a headline the vision doc explicitly wants. |
| Single opaque "overall quality" number as the only output | ANTI-FEATURE | LOW | no | Collapsing everything to one number destroys the multi-dimensional comparison that is the product. **Alternative:** composite + always-visible breakdown. |

---

## Category 7 — Results Storage & Querying

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| SQLite schema (runs, stacks, artifacts, events, metrics, screenshots, tool_calls, iterations) | TABLE STAKES | MEDIUM | **v1** | Explicitly chosen over JSON-only so cost/correction/file queries need no reprocessing. The schema is the product's memory — design it to answer the vision doc's example queries directly. |
| Artifact store on disk (screenshots, diffs, logs, generated source) keyed to run IDs | TABLE STAKES | LOW | **v1** | Binary artifacts don't belong in SQLite; store paths in the DB, blobs on disk. |
| Ad-hoc SQL queryability (which stack cheapest / fewest corrections / most files / fastest converge) | TABLE STAKES | LOW (falls out of schema) | **v1** | This is *why* SQLite was chosen. Validate the v1 schema against these exact questions even though v1 has one row. |
| Schema/migration versioning + benchmark-config version stamped on every run | TABLE STAKES | LOW-MEDIUM | **v1** | Results outlive code. A run must record which evaluator versions, weights, judge model, and schema produced it, or old rows become uninterpretable. Reproducibility spans time, not just machines. |
| Historical / regression analysis (score trends across benchmark versions) | DIFFERENTIATOR | MEDIUM | later | Explicit v2 in PROJECT.md. Depends on config versioning being right from v1 — that's why the stamp is table-stakes now. |
| Export (JSON/CSV) for external analysis | DIFFERENTIATOR | LOW | later | Nice for notebooks/pandas. `SELECT` → CSV is trivial once the DB exists. |
| Full-blown results web app / hosted DB / multi-user backend | ANTI-FEATURE | HIGH | no | A local SQLite file is the right scope. A hosted service is a separate product. **Alternative:** ship the .db file; let users point any SQL tool at it. |

---

## Category 8 — Reporting

| Feature | Category | Complexity | v1? | Notes |
|---------|----------|------------|-----|-------|
| CLI run + terminal summary | TABLE STAKES | LOW | **v1** | The primary UX for "run a benchmark and see the result." |
| HTML report (scores, metrics, screenshots side-by-side) | TABLE STAKES | MEDIUM | **v1** | Shareable, visual. Expected vs generated screenshot side-by-side + the diff image is the single most persuasive artifact. Static HTML, no server. |
| Side-by-side / overlay visual diff in the report | DIFFERENTIATOR | LOW-MEDIUM | **v1** | Cheap given you already produce the pixelmatch diff image. Massively improves trust in the visual score. |
| Comparison reports (matrix heatmaps, per-axis charts, leaderboards) | DIFFERENTIATOR | MEDIUM | later | Depends on the matrix existing (Cat 1) — nothing to compare with one row. `cli/compare.ts` in the vision layout is the v2 entry point. |
| Markdown + CSV report formats | TABLE STAKES eventually | LOW | later | Explicitly deferred (HTML+CLI cover v1). Trivial to add — same data, different renderer. |
| Static shareable report (self-contained HTML, no runtime) | TABLE STAKES | LOW-MEDIUM | **v1** | Inline/relative assets so a report can be zipped and sent. Avoids the "needs a server" trap. |
| Interactive BI dashboard / live-updating charts | ANTI-FEATURE (for now) | HIGH | no | Analytics-product scope. **Alternative:** static HTML from a template + the SQLite file for anyone who wants to go deeper. |

---

## Feature Dependencies

```
Declarative specs (stack/scenario/model)
    └──requires──> Spec loader/validator [v1]
            └──enables──> Matrix generator [v2]
                    └──requires──> Scheduler/concurrency [v2]

Agent Runtime (Pi SDK) [v1]
    └──emits──> Event telemetry stream [v1]
            ├──folds into──> Cost/token metrics [v1]
            ├──folds into──> Engineering + tool-call metrics [v1]
            └──folds into──> Iteration count + correction density [v1]  (DIFFERENTIATORS)

Disposable workspace [v1]
    └──precedes──> App build/run lifecycle [v1]
            └──produces──> Rendered app + Playwright screenshot [v1]
                    └──feeds──> Evaluator pipeline [v1]
                            ├── PixelMatch [v1]
                            ├── DOM Diff [v1]  (requires expected-structure spec)
                            ├── a11y/axe [v1]
                            └── LLM Judge [v1] (requires multimodal endpoint + pinned rubric)
                                    └──produces──> sub-scores
                                            └──requires──> Normalization [v1]
                                                    └──produces──> Composite score [v1]
                                                            └──over reps──> Aggregation/pass@k [v2]

Everything ──persists to──> SQLite + artifact store [v1]
    └──requires──> Config/version stamping [v1]
            └──enables──> Historical/regression analysis [v2]
    └──renders as──> CLI summary + HTML report [v1]
            └──scales to──> Comparison/leaderboard reports [v2]

CONFLICTS / TENSIONS:
- Live streaming dashboard  ✗ conflicts with  batch-benchmark scope (anti-feature)
- Human-in-the-loop scoring ✗ conflicts with  "no human judgment" Core Value
- Docker-per-run [v2]        ~ supersedes  local temp dir [v1] (same seam, heavier impl)
```

### Dependency notes (load-bearing)

- **Iteration count + correction density require the event stream to correlate
  build/test failures with subsequent agent turns.** If telemetry is built as
  inline logging instead of an event log, these differentiators become expensive
  retrofits. Build the event bus first.
- **DOM Diff and the LLM Judge both require per-scenario expectation assets** —
  DOM Diff needs an expected-structure spec (selectors/roles); the Judge needs
  the expected screenshot + a rubric. The scenario spec must carry these in v1.
- **Aggregation/pass@k requires the SQLite schema to key rows by repetition even
  when N=1.** Get the key right in v1 or v2 aggregation forces a migration.
- **Historical analysis requires config/version stamping from the very first
  run.** Unstamped v1 rows are uninterpretable later — this is why stamping is
  table-stakes now, not v2.

---

## MVP Definition

### Launch With (v1 — the thin vertical slice)

One row (Angular + DeepSeek 4 Pro + dashboard), full pipeline:

- [ ] Declarative spec loader (one stack.yaml, one scenario.yaml, one model.json) — proves the generic core
- [ ] Agent Runtime over Pi SDK (session, prompt+skills+MCP+image, run) — the swap seam
- [ ] Event-based telemetry stream — everything downstream folds over it
- [ ] Cost/token, engineering, tool-call metrics — headline questions + cheap given events
- [ ] **Iteration count + correction density** — the signature differentiators, and they must ride the event stream from day one
- [ ] Disposable temp workspace + clean teardown + pinned toolchain (`npm ci`) — reproducibility
- [ ] Build → start → wait-ready with per-stage timeouts; capture build result
- [ ] Playwright screenshot at declared viewport, wait-for-render
- [ ] All four evaluators (PixelMatch, DOM Diff, axe-core, VLM Judge) behind one extensible interface
- [ ] Composite score + raw sub-scores persisted separately, normalized
- [ ] SQLite (full schema, rep-keyed) + artifact store + config/version stamping
- [ ] CLI run + terminal summary + static HTML report with side-by-side visual diff

### Add After Validation (v1.x)

- [ ] Matrix generator + sequential multi-cell runs — trigger: first time you want 2+ rows
- [ ] Repetitions (N>1) + mean/stddev/pass@k aggregation — trigger: first "is this result stable?" question
- [ ] Lint/test/coverage capture — trigger: stack specs stabilize
- [ ] Judge self-consistency (k-sample majority) + disagreement flagging — trigger: judge variance observed
- [ ] Markdown/CSV reports — trigger: someone needs the data outside HTML

### Future Consideration (v2+)

- [ ] Docker-per-run isolation — trigger: shared/CI runner or untrusted-code concern
- [ ] Concurrency/scheduler + resume/retry — trigger: matrix large enough that sequential is too slow
- [ ] Prompts/skills/MCPs/engineering-strategies as matrix axes — the vision endgame
- [ ] Comparison heatmaps/leaderboards, cost/quality tradeoff rankings
- [ ] Historical/regression analysis, CI/CD integration
- [ ] Offline dependency mirror — trigger: registry flakiness poisons long matrices

---

## Feature Prioritization Matrix

| Feature | Benchmark Value | Implementation Cost | Priority |
|---------|-----------------|---------------------|----------|
| Declarative spec loader | HIGH | MEDIUM | P1 |
| Agent Runtime (Pi SDK seam) | HIGH | HIGH | P1 |
| Event telemetry stream | HIGH | MEDIUM | P1 |
| Cost/token metrics | HIGH | MEDIUM | P1 |
| Iteration count + correction density | HIGH | MEDIUM | P1 |
| Disposable workspace + pinned toolchain | HIGH | MEDIUM | P1 |
| Build/run lifecycle + timeouts | HIGH | MEDIUM | P1 |
| Playwright screenshot (wait-for-render) | HIGH | MEDIUM | P1 |
| Extensible evaluator pipeline (4 evaluators) | HIGH | MEDIUM | P1 |
| Composite + raw sub-scores, normalized | HIGH | LOW | P1 |
| SQLite schema + version stamping | HIGH | MEDIUM | P1 |
| CLI summary + HTML report w/ visual diff | HIGH | MEDIUM | P1 |
| Matrix generator | HIGH | MEDIUM | P2 |
| Repetitions + variance/pass@k | HIGH | MEDIUM | P2 |
| Lighthouse/WCAG full audit | MEDIUM | MEDIUM | P2 |
| Comparison reports / leaderboards | HIGH | MEDIUM | P2 |
| Docker-per-run isolation | MEDIUM | HIGH | P3 |
| Concurrency/scheduler + resume | MEDIUM | HIGH | P3 |
| Strategy/prompt/skill/MCP axes | HIGH | MEDIUM | P3 |
| Historical/regression + CI/CD | MEDIUM | MEDIUM | P3 |

---

## Competitor Feature Analysis

| Concern | SWE-bench / VISTA / Design2Code | inspect-ai / promptfoo / braintrust | This platform's approach |
|---------|--------------------------------|-------------------------------------|--------------------------|
| Reproducibility | Docker-pinned repo snapshots, pinned deps; contamination & leakage are documented pitfalls | Sandbox isolation (Docker/K8s), pinned model versions | v1: temp dir + `npm ci` + pinned Node + input fingerprint + config stamping; Docker deferred to v2 |
| Isolation | Container-per-task | inspect-ai's tooling/host/network 3-axis model | Local temp dir v1 → Docker v2 (same seam) |
| Evaluation of UI fidelity | Design2Code: CLIP high-level + low-level element matching; VISTA: executable render + VLM judge | LLM-as-judge, model_graded_qa | Four-evaluator pipeline: PixelMatch (low-level) + DOM Diff (element matching) + axe (a11y) + VLM Judge — broader than any single tool |
| Stochasticity handling | pass@k, mean±stddev; single-run reporting flagged as overstating | Multiple epochs per sample | Rep-keyed schema v1, pass@k aggregation v2 |
| Agent behavior signal | Trajectory analysis (emerging research area) | Full transcript logging + viewer | **Iteration count + correction density as first-class scored metrics** — the platform's distinctive contribution |
| Cost/speed | Rarely first-class | Token/cost logging | Cost/token/TTFT first-class + cost-per-quality rankings |
| Scope of what's benchmarked | The model (fixed harness) | The prompt/eval config | The whole scaffold: model × stack × prompt × skills × MCP × strategy |

---

## Sources

- [Inspect AI — sandbox/solver/scorer architecture, three-axis isolation](https://inspect.aisi.org.uk/) · [AISI sandboxing toolkit](https://www.aisi.gov.uk/blog/the-inspect-sandboxing-toolkit-scalable-and-secure-ai-agent-evaluations) · [Inspect AI review](https://neurlcreators.substack.com/p/inspect-ai-evaluation-framework-review)
- [SWE-bench harness reference (Docker-pinned reproducibility)](https://www.swebench.com/SWE-bench/reference/harness/) · [SWE-rebench (decontaminated eval)](https://arxiv.org/pdf/2505.20411) · [SWE-bench Verified contamination/leakage findings](https://www.emergentmind.com/topics/swe-bench-verified) · [Agent trajectory analysis](https://arxiv.org/pdf/2606.17454)
- [Design2Code benchmark — CLIP high-level + low-level element matching + VLM judge](https://www.emergentmind.com/topics/design2code-benchmark) · [VISTA — visual spec-to-web-app coding agents, executable render + VLM judge](https://arxiv.org/html/2605.26144)
- Project inputs: `.planning/PROJECT.md` (v1 thin-slice scope, key decisions), repo-root `PROJECT.md` (full vision, module roles, metrics taxonomy)

---
*Feature research for: automated benchmark/eval platform for AI coding agents building front-end web apps*
*Researched: 2026-07-01*
