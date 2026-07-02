# Phase 3: Evaluation Pipeline + Scorer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 3-evaluation-pipeline-scorer
**Areas discussed:** Composite weighting & normalization, LLM judge (model / rubric / inputs / ops / aggregation), DOM structural-presence, Degraded inputs & evaluator failures, axe severity mapping, Expected-image source, PixelMatch diff output, Render access model, Reps scope

---

## Composite weighting & normalization (SCORE-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Equal, scenario-overridable | Default 25% each, scenario.yaml may override; weights already stored per-run (D-21) | ✓ |
| Fixed equal (25% each) | No override knob in v1 | |
| Visual-weighted | Judge + PixelMatch heavier (e.g. 35/35/15/15) | |

**User's choice:** Equal, scenario-overridable → D3-01/D3-02.

---

## LLM judge — model family (EVAL-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable, default Claude | Judge model spec, default a Claude vision model; independent of DeepSeek4Pro | ✓ |
| Hardcode Claude vision | Pin a Claude vision model, no config | |
| Hardcode GPT vision | Pin an OpenAI vision model | |

**User's choice:** Configurable, default Claude → D3-11.

---

## LLM judge — rubric shape (EVAL-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-dimension + overall | layout / component presence / visual fidelity each 0–1 + rationale + overall | ✓ |
| Single holistic score | one 0–1 + reasoning | |
| Researcher proposes rubric | defer dimensions to research | |

**User's choice:** Multi-dimension + overall → D3-13.

---

## LLM judge — inputs (EVAL-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Two images + rubric only | expected mockup + generated + fixed rubric; no prompt/code/DOM | ✓ |
| Images + scenario description | also give the intended-UI text | |

**User's choice:** Two images + rubric only → D3-12.

---

## LLM judge — calls & determinism (EVAL-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Single call, cached | one call, cached by input fingerprint | ✓ |
| Best-of-N / average | N calls aggregated | |

**User's choice:** Single call, cached → D3-14.

---

## LLM judge — overall derivation (EVAL-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Mean of dimensions | overall = mean of dimension scores, re-derivable | ✓ |
| Holistic model call | model emits independent gestalt overall | |

**User's choice:** Mean of dimensions → D3-13.

---

## DOM structural-presence (EVAL-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Scenario-declared, fraction | scenario.yaml selectors/roles; score = fraction present | ✓ |
| Scenario-declared, all-or-nothing | 1.0 only if all present | |
| Derived from mockup | auto-infer from expected image | |

**User's choice:** Scenario-declared, fraction → D3-08.

---

## DOM — absent expected-elements list (EVAL-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Drop + renormalize | skip DOM evaluator, renormalize composite | ✓ |
| Score 1.0 | nothing required = trivially satisfied | |
| Require a list (error) | validation error if missing | |

**User's choice:** Drop + renormalize → D3-09.

---

## axe-core accessibility mapping (EVAL-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Severity-weighted penalty | 1.0 minus impact-weighted penalties, floored at 0 | ✓ |
| Pass ratio | rules passed / total | |
| Binary-ish by count | 1.0 if none, else scaled by count | |

**User's choice:** Severity-weighted penalty → D3-10.

---

## Expected image & dimension reconciliation (EVAL-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Mockup, resized via sharp | mockup PNG = expected; sharp-normalize both to viewport | ✓ |
| Mockup at exact viewport | require authored-at-viewport, no resize | |
| Rendered reference shot | screenshot a reference implementation | |

**User's choice:** Mockup, resized via sharp → D3-05 (adds `sharp` as a Phase-3 dependency).

---

## PixelMatch diff output (EVAL-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Always emit, AA-tolerant | save role=diff artifact every run; ~0.1 AA threshold | ✓ |
| Emit diff only on mismatch | save diff only when similarity low | |
| Skip diff in v1 | similarity % only | |

**User's choice:** Always emit, AA-tolerant → D3-06/D3-07.

---

## Render access model (EVAL-03 / EVAL-02 / EVAL-05)

| Option | Description | Selected |
|--------|-------------|----------|
| One shared render pass | single page → screenshot + axe + DOM checks | ✓ |
| Each evaluator loads its own | independent loads per evaluator | |

**User's choice:** One shared render pass → D3-17 (research: expose DOM from the render seam, which today returns PNG only).

---

## Evaluator set per scenario (EVAL-05)

| Option | Description | Selected |
|--------|-------------|----------|
| All 4 always (v1) | registry supports subsets structurally, not exposed | ✓ |
| Scenario-selectable now | scenario.yaml selects evaluators | |

**User's choice:** All 4 always (v1) → D3-16.

---

## Reps scope (SCORE-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Single rep (v1) | rep_index=0; multi-rep deferred to v2 matrix | ✓ |
| Multi-rep now (median) | N reps, median composite | |

**User's choice:** Single rep (v1) → D3-18.

---

## Claude's Discretion

- Exact axe per-severity penalty weights (D3-10); exact pixelmatch threshold + includeAA (D3-06).
- Concrete default Claude judge model id, confirmed via pi-ai (D3-11).
- Mechanism to expose the live DOM to axe/DOM evaluators from a single render (D3-17).

## Deferred Ideas

- Multi-rep aggregation (median) — v2 matrix.
- Scenario-selectable evaluator subsets — later.
- Best-of-N judge calls — only if temp=0 + cache proves insufficient.
