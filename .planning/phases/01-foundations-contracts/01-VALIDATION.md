---
phase: 1
slug: foundations-contracts
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-01
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` §Validation Architecture + the `<automated>` verify blocks of plans 01-01…01-05.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` 4.1.9 (dev dep; installed by task 01-01-01) |
| **Config file** | `vitest.config.ts` (created in task 01-01-01) |
| **Quick run command** | `npx vitest run <file>` |
| **Full suite command** | `npx vitest run` |
| **Type gate** | `npx tsc --noEmit` (proves the `z.infer` typed-object contract, SPEC-02) |
| **Estimated runtime** | ~5 seconds (pure unit tests; in-memory/tmp SQLite; no browser, no agent, no network) |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command (`npx vitest run <file> && npx tsc --noEmit`)
- **After every plan wave:** Run `npx vitest run` (full suite)
- **Before `/gsd-verify-work`:** `npx vitest run` and `npx tsc --noEmit` must both be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | (infra) | — | No Pi/Playwright deps present (forbidden-import guard) | build | `npm ls zod yaml better-sqlite3 typescript tsx vitest >/dev/null && node -e "require('better-sqlite3');require('yaml')" && npx tsc --noEmit` | ✅ inline | ⬜ pending |
| 01-01-02 | 01 | 1 | TEL-01 | — | AgentEvent union total; UnknownEvent fallback (no unhandled event) | unit | `npx vitest run tests/core.test.ts && npx tsc --noEmit` | ✅ inline (tdd) | ⬜ pending |
| 01-02-01 | 02 | 2 | SPEC-01/02/03 | T-V5 | Valid + malformed (`.bad.yaml`) fixtures present for negative tests | fixture | `test -s tests/fixtures/stacks/angular.yaml && test -s tests/fixtures/stacks/angular.bad.yaml && test -s tests/fixtures/scenarios/dashboard/dashboard.yaml && test -s tests/fixtures/models/deepseek4pro.json && test -s tests/fixtures/scenarios/dashboard/mockup.png && test -s tests/fixtures/scenarios/dashboard/expected.png` | ✅ inline | ⬜ pending |
| 01-02-02 | 02 | 2 | SPEC-01/02 | T-V5 | `z.strictObject` rejects unknown keys (V5 input validation) | build | `npx tsc --noEmit && grep -c strictObject src/specs/schema.ts` | ✅ inline | ⬜ pending |
| 01-02-03 | 02 | 2 | SPEC-01/02/03 | T-V5 | Malformed spec → throw whose message names the bad key via `z.prettifyError` (SC#1) | unit | `npx vitest run tests/specs.test.ts && npx tsc --noEmit` | ✅ inline (tdd) | ⬜ pending |
| 01-03-01 | 03 | 2 | STORE-01 | — | Idempotent init via `CREATE TABLE IF NOT EXISTS` + `user_version` (no destructive re-init) | build | `npx tsc --noEmit && grep -c "CREATE TABLE IF NOT EXISTS" src/storage/schema.sql.ts` | ✅ inline | ⬜ pending |
| 01-03-02 | 03 | 2 | STORE-01/TEL-01 | — | WAL on; all SC#4 tables; event append reads back identically (SC#4) | unit | `npx vitest run tests/db.test.ts && npx tsc --noEmit` | ✅ inline (tdd) | ⬜ pending |
| 01-04-01 | 04 | 3 | STORE-03 | T-V12 | Artifact path containment — traversal (`../`) rejected; DB stores relative path only (SC#5) | unit | `npx vitest run tests/artifacts.test.ts && npx tsc --noEmit` | ✅ inline (tdd) | ⬜ pending |
| 01-05-01 | 05 | 3 | SPEC-04 | — | Fingerprint stable across identical builds; differs on mockup byte change (reproducibility) | unit | `npx vitest run tests/manifest.test.ts && npx tsc --noEmit` | ✅ inline (tdd) | ⬜ pending |
| 01-05-02 | 05 | 3 | SPEC-04/STORE-02/TEL-01 | — | Stamped manifest (snapshot + VersionStamp + fingerprint) persisted to `runs` row + read back identical (SC#3) | unit | `npx vitest run tests/manifest.test.ts && npx tsc --noEmit` | ✅ inline (tdd) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` + `vitest.config.ts` installed by task **01-01-01** (framework bootstrap)

*No separate Wave 0 test-stub pass: every requirement is covered by a `type="tdd"` task that authors its own test file inline (`tests/core.test.ts`, `tests/specs.test.ts`, `tests/db.test.ts`, `tests/artifacts.test.ts`, `tests/manifest.test.ts`). `wave_0_complete` flips to true once 01-01-01 lands the framework.*

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification (unit tests + `tsc --noEmit`). No browser, agent, or network behavior exists in this phase to verify manually.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has one)
- [x] Wave 0 covers all MISSING references (framework install in 01-01-01; tdd tasks author test files inline)
- [x] No watch-mode flags (`vitest run`, not `vitest`)
- [x] Feedback latency < ~5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-01 (populated at plan-phase from RESEARCH Validation Architecture + plan verify blocks)
