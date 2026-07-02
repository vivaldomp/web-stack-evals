# Phase 3: Evaluation Pipeline + Scorer - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Given a matched **expected/generated screenshot pair plus the generated app's rendered DOM**, compute the **four evaluator sub-scores** (PixelMatch %, DOM structural presence, axe-core accessibility, LLM-judge verdict) behind one `Evaluator` interface + registry, and aggregate them into a **normalized composite** — deterministically, **with no LLM agent in the loop**. Checkpoint: the full evaluation pipeline runs green end-to-end on fixture screenshots without the agent.

Requirements: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, SCORE-01, SCORE-02.

**Not this phase:** the agent runtime (Phase 4), the orchestrator/reports (Phase 5), matrix breadth / multi-rep aggregation / comparison axes (v2).

</domain>

<decisions>
## Implementation Decisions

### Composite & Normalization (SCORE-01, SCORE-02)
- **D3-01:** Each evaluator emits `rawScore ∈ [0,1]`, higher = better. Composite = **weighted mean** of the four sub-scores.
- **D3-02:** Weights default to **equal (0.25 each)**; a scenario may override them in `scenario.yaml`. Stored per-run alongside the composite — the existing `runs.composite_score` + `runs.composite_weights` columns already provide this (D-21), so the composite stays re-derivable from raw sub-scores + recorded weights.
- **D3-03:** When an evaluator is **dropped** (infra failure or absent config), the composite **renormalizes over the surviving evaluators** (remaining weights rescaled to sum to 1). A dropped evaluator is never silently counted as 0.

### Failure / Degraded-Input Handling
- **D3-04:** **Distinguish the cause.**
  - *Agent-caused* degradation (broken/blank generated app from an upstream build/start failure) → **real low/zero** pixel/DOM/judge scores that **count** — the run genuinely scores poorly, that's the signal.
  - *Tool/infra* failure (e.g. judge API error after retries) → **drop that evaluator**, renormalize (D3-03), and record the reason in the evaluation's `detail` JSON. Do not punish the agent for our infrastructure.
  - Escalate to a run-level `eval_error` outcome (D-19) only when the failure is systemic and prevents scoring entirely.

### EVAL-01 — PixelMatch (visual similarity)
- **D3-05:** "Expected" = the **scenario's mockup PNG**. Normalize **both** expected and generated to the stack viewport via **`sharp`** before diffing (pixelmatch requires equal dimensions). `sharp` graduates from optional to a Phase-3 production dependency — CLAUDE.md pre-flagged it for exactly this dimension-mismatch case.
- **D3-06:** Similarity `= 1 − (diffPixels / totalPixels)`, using an **AA-tolerant threshold (~0.1)** so sub-pixel noise isn't penalized. Exact threshold/`includeAA` value: planner/research.
- **D3-07:** **Always** generate the diff image and persist it as a `screenshots.role='diff'` artifact (schema already supports it) — every evaluation, for debuggability.

### EVAL-02 — DOM structural presence
- **D3-08:** The list of expected elements/roles is **declared in `scenario.yaml`** (selectors/roles). Score = **fraction present** (`found / declared`) — a gradient, not pass/fail. Matches the declarative-spec pattern (D-07). Runs against the rendered DOM, not the screenshot.
- **D3-09:** If a scenario declares **no** expected-elements list, the DOM evaluator is **dropped** (not scored 1.0 or 0.0) and the composite renormalizes — consistent with D3-03/D3-04.

### EVAL-03 — axe-core accessibility
- **D3-10:** axe runs against the **generated app's live DOM**. Score = **severity-weighted penalty from 1.0**: start at 1.0, subtract weighted penalties by impact (critical > serious > moderate > minor), floored at 0. Exact per-severity penalty weights: planner/research.

### EVAL-04 — LLM judge
- **D3-11:** Judge model is **configurable** via a model spec (like the agent models), defaulting to a **current Claude vision model**. Must be an **independent model family** from the agent-under-test (v1 agent row = DeepSeek4Pro). Reuses **`@earendil-works/pi-ai`** — no second LLM SDK. `temperature=0`, images-only (locked by requirement).
- **D3-12:** Judge inputs = the **two images only** (expected mockup + generated screenshot) + fixed rubric instructions. **No** prompt, code, or DOM is given to the judge (maximal blindness/independence).
- **D3-13:** Rubric is **structured + zod-validated**: per-dimension scores for **layout fidelity**, **component presence**, **visual/styling fidelity** (each 0–1) + a short rationale. **`overall` = mean of the dimension scores** (re-derivable, deterministic); `overall` is the judge sub-score.
- **D3-14:** **One judge call** per evaluation, **cached by input fingerprint** (identical, free re-runs — fits the deterministic substrate). On transient API error: **bounded retry**, then drop per D3-04.

### Evaluator framework & execution (EVAL-05)
- **D3-15:** All four evaluators run behind the existing `EvaluatorPort` + a **registry**; adding an evaluator = a registry entry with no core/orchestrator edits (the D-23 seam + D-20 storage already make this a no-schema-change addition).
- **D3-16:** **All four always run in v1** (registry supports subsets structurally for later, but scenarios cannot select a subset yet) — keeps every run comparable.
- **D3-17:** **One shared render pass** — a single loaded page yields the screenshot **and** is exposed for axe + DOM-presence checks; all evaluators score from that one snapshot (consistent DOM state, deterministic, no repeated loads). ⚠ Phase-2's `RenderPort.screenshot()` returns the PNG only — research must decide how to expose the live page/DOM (extend the render seam vs. a dedicated render-with-page step).

### Scope
- **D3-18:** v1 evaluates a **single rep** (`rep_index=0`). Multi-rep aggregation is deferred to the matrix milestone (v2); the rep-keyed schema already supports it with no rework.

### Claude's Discretion (defer to research/planning)
- Exact axe per-severity penalty weights (D3-10); exact pixelmatch threshold + `includeAA` flag (D3-06).
- Concrete default Claude judge model id — research to confirm current vision-capable id via `pi-ai` (D3-11).
- The mechanism for exposing the live DOM to axe/DOM evaluators from a single render (D3-17).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & phase goal
- `.planning/REQUIREMENTS.md` — EVAL-01..05, SCORE-01/02 definitions.
- `.planning/ROADMAP.md` §"Phase 3: Evaluation Pipeline + Scorer" — goal + the 5 success criteria.

### Locked contracts (Phase 1) — the seams Phase 3 fills, do NOT redesign
- `.planning/phases/01-foundations-contracts/01-CONTEXT.md` — **D-20** (evaluations = one row per (run,rep,evaluator), raw_score + detail JSON, new evaluator = new rows), **D-21** (composite stored with its weights, separate from raw, re-derivable), **D-23** (ports import nothing concrete).
- `src/core/ports.ts` — `EvaluatorPort { name, evaluate(input) → { rawScore, detail } }` seam (EVAL-05); `RenderPort`/`RenderResult` (extend for DOM access per D3-17).
- `src/storage/schema.sql.ts` — `evaluations` table; `runs.composite_score` + `runs.composite_weights`; `screenshots.role = expected|generated|diff`.

### Upstream output Phase 3 consumes
- `.planning/phases/02-workspace-build-serve-runtime/02-CONTEXT.md` — the generated screenshot Phase 2 writes; D-19 outcome/`eval_error` semantics.

### Locked stack (versions + rationale — not up for debate)
- `.claude/CLAUDE.md` §"Recommended/Supporting" — `pixelmatch`+`pngjs` (EVAL-01), `@axe-core/playwright` (EVAL-03), `sharp` (D3-05 resize), `zod` (judge verdict), and **"reuse `@earendil-works/pi-ai` for the Judge — no second LLM SDK"** (EVAL-04).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EvaluatorPort` (`src/core/ports.ts`) — the registry entry contract; each evaluator implements `evaluate()`.
- `evaluations` table + `createStoragePort` (`src/storage/storagePort.ts`, `schema.sql.ts`) — sub-score persistence already modeled (D-20); composite columns on `runs`.
- `pixelmatch` + `pngjs` (pinned in 02-01) — EVAL-01 core; `@axe-core/playwright` still to add.
- `createPlaywrightRenderer` / `RenderResult` (`src/render/`, 02-04) — reuse for the shared render pass; `RenderResult` already carries page-error arrays (potential extra signal).

### Established Patterns
- Declarative zod specs (`src/specs/schema.ts` `StackSchema`, `ScenarioSchema`) → `scenario.yaml` gains **expected-elements** (D3-08) and **optional per-scenario evaluator weights** (D3-02).
- One-row-per-`(run, rep, evaluator)`; composite re-derivable from raw + recorded weights.
- Sub-scores self-normalize to `[0,1]`, higher=better (D3-01).

### Integration Points
- Consumes the **generated screenshot** written by Phase 2; produces `evaluations` rows + a `composite_score`/`composite_weights` on the `runs` row.
- Extends `ScenarioSchema` (expected elements list + optional weights) — new optional fields on `src/specs/schema.ts`.
- Extends the render seam so the live DOM is reachable for axe + DOM presence (D3-17).

</code_context>

<specifics>
## Specific Ideas

- Judge defaults to a **Claude vision model** via `pi-ai`; the agent-under-test is DeepSeek4Pro, so the judge is provably a different family (D3-11).
- Mockup→generated size reconciliation via **`sharp`** (D3-05).
- Diff image is a **first-class artifact** every run (D3-07).

</specifics>

<deferred>
## Deferred Ideas

- **Multi-rep aggregation** (median across N reps) — matrix milestone (v2). Schema already rep-keyed (D3-18).
- **Scenario-selectable evaluator subsets** — registry supports it structurally; not exposed in v1 (D3-16).
- **Best-of-N judge calls** — revisit only if temp=0 + fingerprint cache proves insufficient for determinism (D3-14).

None of these are in Phase 3 scope — discussion stayed within the evaluator/scorer boundary.

</deferred>

---

*Phase: 03-evaluation-pipeline-scorer*
*Context gathered: 2026-07-02*
