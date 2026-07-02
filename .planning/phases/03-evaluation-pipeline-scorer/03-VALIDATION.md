---
phase: 3
slug: evaluation-pipeline-scorer
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-02
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (two-tier, already configured in Phase 1/2) |
| **Config file** | `vitest.config.ts` (unit) / `vitest.integration.config.ts` (integration/live-browser) |
| **Quick run command** | `npx vitest run {test-file}` (unit tier: `vitest.config.ts`, excludes `*.integration.test.ts`/`*.selftest.test.ts`) |
| **Full suite command** | `npx vitest run --config vitest.integration.config.ts` (adds live-Chromium + full-pipeline tests) |
| **Estimated runtime** | ~5s unit tier; ~60-90s integration tier (Chromium launches in renderWithPage/dom/axe/evalPipeline tests) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run {the task's own test file}` (unit tier — fast, no browser/network for pixelmatch/composite/registry/judge-faux/storage tasks)
- **After every plan wave:** `npx vitest run --config vitest.integration.config.ts` (full suite, including renderWithPage/dom/axe/evalPipeline live-Chromium tests)
- **Before `/gsd-verify-work`:** Full suite must be green — `npx vitest run && npx vitest run --config vitest.integration.config.ts`
- **Max feedback latency:** ~90 seconds (the heaviest single command is the integration-tier full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | SCORE-02 | T-3-SC | Package Legitimacy Audit already Approved — no blocking checkpoint | unit | `node -e "require('sharp'); require('@axe-core/playwright'); require('@earendil-works/pi-ai')"` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | EVAL-02, SCORE-01 | T-3-01 | `.strict()` rejects unknown scenario keys after extension | unit | `npx vitest run tests/specs.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | SCORE-02 | — | Dropped evaluator persists with `raw_score IS NULL`, never 0 | unit | `npx vitest run tests/evaluationsPersistence.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | SCORE-01 | T-3-02 | Bounded navigation timeout carried over from playwrightRenderer.ts | integration | `npx vitest run --config vitest.integration.config.ts tests/renderWithPage.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | SCORE-01 | T-3-08 | All-dropped composite is `null`, never `0`/`NaN` | unit | `npx vitest run tests/composite.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | EVAL-01 | T-3-09 | Dimension mismatch normalized via sharp, never throws | unit | `npx vitest run tests/pixelmatchEvaluator.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | EVAL-04 | T-3-03, T-3-04, T-3-05 | Judge verdict zod-bounded; malformed/missing tool call retried then dropped; no secrets in `detail` | unit (faux provider, no network) | `npx vitest run tests/judgeEvaluator.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02b | 03 | 2 | EVAL-04 | — | Live model call end-to-end (optional, gated) | integration, `skipIf` | `npx vitest run --config vitest.integration.config.ts tests/judgeEvaluator.live.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 2 | EVAL-02 | T-3-06 | Fraction-present scoring against a live page; malformed selector never breaks the pipeline | integration | `npx vitest run --config vitest.integration.config.ts tests/domEvaluator.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 2 | EVAL-03 | T-3-10 | Severity-weighted penalty floored at 0; clean fixture scores 1.0 | integration | `npx vitest run --config vitest.integration.config.ts tests/axeEvaluator.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 2 | SCORE-02 | T-3-07, T-3-11 | Every outcome (survivor or dropped) persists its own row; diff image linked only for pixelmatch; composite write skipped when all dropped | unit (real better-sqlite3, fake evaluators) | `npx vitest run tests/evaluateRun.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-01 | 06 | 3 | EVAL-05 | T-3-12 | No `expectedElements` -> dom evaluator omitted from registry entirely | unit | `npx vitest run tests/registry.test.ts` | ❌ W0 | ⬜ pending |
| 03-07-01 | 07 | 4 | EVAL-01..05, SCORE-01, SCORE-02 | T-3-13 (inherits all) | Full pipeline green on fixtures, no agent, no network; shared page closed once after both live evaluators | integration | `npx vitest run --config vitest.integration.config.ts tests/evalPipeline.integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All Wave 0 scaffolding is created inline by the task that first needs it (no separate pre-wave scaffolding plan) — tracked here so nothing is silently skipped:

- [ ] `sharp@0.35.3`, `@axe-core/playwright@4.12.1`, `@earendil-works/pi-ai@0.80.3` installed — 03-01-PLAN.md Task 1
- [ ] `ScenarioSchema.expectedElements` / `evaluatorWeights` fields — 03-01-PLAN.md Task 2
- [ ] `tests/evaluationsPersistence.test.ts`, `src/storage/evaluations.ts` — 03-01-PLAN.md Task 3
- [ ] `tests/renderWithPage.integration.test.ts`, `src/render/renderWithPage.ts` — 03-02-PLAN.md Task 1
- [ ] `tests/composite.test.ts`, `src/pipeline/composite.ts` — 03-02-PLAN.md Task 2
- [ ] `tests/fixtures/eval/pngFixtures.ts` (procedural, no checked-in binary art) — 03-03-PLAN.md Task 1
- [ ] `tests/fixtures/eval/app.html`, `tests/fixtures/eval/app-clean.html` — 03-04-PLAN.md Task 1
- [ ] `tests/evaluateRun.test.ts`, `src/pipeline/evaluate.ts` — 03-05-PLAN.md Task 1
- [ ] `tests/registry.test.ts`, `src/eval/registry.ts` — 03-06-PLAN.md Task 1
- [ ] `tests/evalPipeline.integration.test.ts` (ROADMAP SC5 proof) — 03-07-PLAN.md Task 1

---

## Manual-Only Verifications

"All phase behaviors have automated verification." The one live-network path (a real `claude-sonnet-5` judge call) has an automated, `skipIf`-gated test (`tests/judgeEvaluator.live.test.ts`) rather than a manual verification step — it is exercised automatically whenever `ANTHROPIC_API_KEY` is present (e.g. a developer's local environment) and skips cleanly otherwise (CI, this planning environment).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-02
