---
phase: 2
slug: workspace-build-serve-runtime
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` § Validation Architecture. Task IDs are filled in by the planner; this draft keys rows by REQ-ID until plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 |
| **Config file** | none yet — Wave 0 adds a dedicated integration config (or per-test overrides) raising `testTimeout` well past the 5000ms default (Pitfall 6) |
| **Quick run command** | `npx vitest run tests/<file>.test.ts` |
| **Full suite command** | `npm test` (→ `vitest run`) |
| **Estimated runtime** | ~minutes (integration suite runs a real `npm ci` + `ng build` on a warm cache; determinism self-test serves + screenshots twice) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/<touched-file>.test.ts`
- **After every plan wave:** Run `npm test` (full suite, incl. slow integration + determinism self-test)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** targeted test < ~30s; full suite bounded by the run cap

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | WORK-01 | — | `runStack` only ever writes under `tmp/<run_id>/` (paths derived from run_id) | integration | `npx vitest run tests/runStack.integration.test.ts -t "creates workspace"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | WORK-02 | T-2 (V12) | main tree byte-identical before/after (path-containment holds) | integration self-test | `npx vitest run tests/isolation.selftest.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | WORK-03 | T-1/T-2 (V5) | install spawns `--ignore-scripts`, allowlisted env only, aborts at timeout | unit + integration | `npx vitest run tests/runStage.test.ts -t "install stage"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | WORK-04 | T-3 | after teardown port 4200 is free, no child survives (process-group kill) | integration | `npx vitest run tests/runStack.integration.test.ts -t "teardown"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BUILD-01 | — | build/start/timeout failures → scored `RunStatus` + `failedStage`, never an uncaught throw | integration (happy + 3 forced-failure) | `npx vitest run tests/runStack.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BUILD-02 | T-5 | lint/test failures recorded, never block screenshot; `dist/` size captured | integration | `npx vitest run tests/runStack.integration.test.ts -t "non-fatal stages"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BUILD-03 | — | screenshot PNG dimensions == declared viewport at dpr=1 | integration | `npx vitest run tests/runStack.integration.test.ts -t "screenshot dimensions"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BUILD-04 | — | same fixture screenshotted twice → ≤0.1% differing pixels (threshold check) | integration self-test | `npx vitest run tests/determinism.selftest.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Held-out vs. direct assertion split:**
- **Direct assertions** (single expected value): screenshot dimensions (BUILD-03); `RunStatus` value + `failedStage` per forced-failure (BUILD-01); port-free check (WORK-04); tree-hash equality (WORK-02).
- **Property/threshold check** (BUILD-04 only): pixel-diff % must stay ≤0.1%, not equal an exact value — sub-pixel/AA jitter makes exact equality flaky by construction. This is the one place a threshold is correct.

---

## Wave 0 Requirements

- [ ] `stacks/angular/template/` — committed Angular skeleton + `package-lock.json` (D2-01); **prerequisite for every integration test**, not just a test gap
- [ ] `tests/runStack.integration.test.ts` — WORK-01/04, BUILD-01/02/03
- [ ] `tests/determinism.selftest.test.ts` — BUILD-04
- [ ] `tests/isolation.selftest.test.ts` — WORK-02 (may fold into the integration file — planner's call)
- [ ] `tests/fixtures/` — minimal static HTML fixture for the determinism self-test
- [ ] vitest config / per-test timeout overrides raising `testTimeout` past 5000ms for the integration suite (Pitfall 6)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (Angular `ng test` runs one-shot; vitest `run`)
- [ ] Feedback latency acceptable
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
