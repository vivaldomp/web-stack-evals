---
phase: 5
slug: orchestrator-metrics-projector-reports
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` §Validation Architecture. The product-critical
> risk is the **metrics projector**: a wrong fold silently produces wrong
> benchmark numbers, so every fold is proven by a deterministic golden fixture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 [VERIFIED: package.json] |
| **Config file** | `vitest.config.ts` (default/CI) · `vitest.integration.config.ts` (server + `.live.test.ts`) |
| **Quick run command** | `npx vitest run <file>` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | pure projector/report/CLI tests ~seconds (parallel); server-integration tests need Node 24.18.0 (nvm) + `--no-file-parallelism` (fixed port 4200) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <file>` for the touched area
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (pure tests); server-integration tests run separately

---

## Per-Requirement Verification Map

> Task IDs are assigned when the plans are written (chunked planning). Anchored
> here to the stable phase requirements + the Wave-0 test that proves each.

| Requirement | Secure/Correct Behavior | Test Type | Automated Command | Wave-0 File | Status |
|-------------|-------------------------|-----------|-------------------|-------------|--------|
| TEL-02 | Projection tables empty mid-run; only `projectMetrics(db,runId)` populates them (never inline) | unit | `npx vitest run tests/projectionNotInline.test.ts` | ✅ new | ⬜ pending |
| TEL-03 | wall/build/ttft/cost/tokens + `backoff_wait_ms` (Σ end−start) + emitted start/render times fold to exact values | unit (golden fixture) | `npx vitest run tests/projector.test.ts` | ✅ new | ⬜ pending |
| TEL-04 | files_created/edited + lines_added/removed fold from `file_mutation` (0 tolerated) | unit (golden fixture) | `npx vitest run tests/projector.test.ts` | ✅ new | ⬜ pending |
| TEL-05 | iteration_count = usage-events; corrections = 2nd+ `file_mutation` per path, `seq`-ordered (D5-11); order-invariance property | unit (golden + property) | `npx vitest run tests/projector.test.ts` | ✅ new | ⬜ pending |
| TEL-06 | tool_call grouped by toolName → `tool_calls(call_count,error_count)` | unit (golden fixture) | `npx vitest run tests/projector.test.ts` | ✅ new | ⬜ pending |
| REPORT-01 | Terminal summary renders composite + 4 sub-scores + headline; partial/failed run shows status not crash (D5-05) | unit | `npx vitest run tests/orchestrator.test.ts` | ✅ new | ⬜ pending |
| REPORT-02 | Self-contained HTML: no external `<link>`/`http`/`src=`, images are `data:`; narration HTML-escaped; partial-run empty-state | unit | `npx vitest run tests/renderReport.test.ts` | ✅ new | ⬜ pending |
| CLI-01 | `run` sequences the row end-to-end (injected fake session + faux judge, no paid call); exit 0 on any scored row incl. build_failed/timeout (D5-08) | unit | `npx vitest run tests/orchestrator.test.ts tests/cli.test.ts` | ✅ new | ⬜ pending |
| CLI-02 | `report <id>` / `--latest` selects + regenerates from stored results only | unit | `npx vitest run tests/cli.test.ts` | ✅ new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Cross-cutting property / held-out checks (05-RESEARCH.md §Property tests)
- **Projection determinism / idempotence** — `projectMetrics` twice on the same log yields identical rows (no double-insert).
- **Sum-conservation** — Σ per-iteration `correction_count` == `correction_density × iteration_count` == standalone total-corrections fold (three independent computations agree).
- **Order-invariance of storage, order-dependence of fold** — shuffle append order but preserve `seq` → identical result (proves the fold keys off `seq`, D5-11).
- **Scored-outcome-never-crash** — build_failed & timeout fixtures fold partial metrics, set status via `updateRunOutcome`, render summary+report (empty-state), exit 0; harness-error (unresolvable spec) throws before any row → exit non-zero, no partial `report.html`.

---

## Wave 0 Requirements

- [ ] `tests/projector.test.ts` — golden fixtures for TEL-02…06 + D5-11 correction-density and D5-12 backoff edge cases + determinism/order-invariance properties
- [ ] `tests/projectionNotInline.test.ts` — mid-run projection-tables-empty assertion (TEL-02 / D-24)
- [ ] `tests/orchestrator.test.ts` — full sequence with injected fake `createSession` + faux judge provider (no paid calls), incl. build_failed / timeout paths
- [ ] `tests/renderReport.test.ts` — self-containment invariant, partial-run rendering, HTML-escaping of narration
- [ ] `tests/cli.test.ts` — `parseArgs` flag resolution, `report --latest` selection, exit codes
- [ ] Update `tests/importBoundary.test.ts` allowlist for the new `src/agent/modelCapabilities.ts` Pi importer (D5-14 / A5)

*Existing vitest infrastructure is present — Wave 0 adds test files, not a framework.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real paid green benchmark row (SC#1) | CLI-01 (E2E) | Needs `DEEPSEEK_API_KEY` (agent) + `ANTHROPIC_API_KEY` (judge); paid + non-deterministic — gated out of CI | With both env vars set: `tsx src/cli/index.ts run --stack angular --model deepseek4pro --scenario dashboard`; expect a stored scored row + `results/<run_id>/report.html`. Wire as a `.live.test.ts` (mirror `judgeEvaluator.live.test.ts`) so CI stays free/offline. |
| DeepSeek `input:["image"]` capability (D5-01 caveat firing) | TEL/REPORT | Depends on live Pi model registry entry for `deepseek-4-pro` | Resolved at runtime by `modelAcceptsImage`; if it lacks image input the report caveat fires. No pre-plan action. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, never `vitest --watch`)
- [ ] Feedback latency < 30s (pure tests)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
