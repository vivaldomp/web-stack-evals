---
phase: 4
slug: agent-runtime-pi-sdk-adapter
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-02
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

All Phase-4 behaviour is validated against **fake/mock Pi sessions** (zero paid tokens) per the
RESEARCH `## Validation Architecture`. No test in this phase makes a live provider call or launches
a browser — every task runs in the fast unit tier.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (two-tier, already configured in Phases 1–3) |
| **Config file** | `vitest.config.ts` (unit tier — every Phase-4 test lives here) |
| **Quick run command** | `npx vitest run {the task's own test file}` |
| **Full suite command** | `npx vitest run` (unit tier — whole repo) |
| **Estimated runtime** | ~5–8s unit tier (no browser, no network, no live Pi session) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run {the task's own test file}` + `npm run typecheck`
- **After every plan wave:** `npx vitest run` (full unit tier stays green)
- **Before `/gsd-verify-work`:** full unit tier green + `npm run typecheck` clean
- **Max feedback latency:** ~8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | AGENT-01 | T-04-SC | exact-pin dep; no `@mariozechner/*`; no postinstall script | unit | `node -e "…version/scope guard…"` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | AGENT-04 | — | new event variants typed; events.ts stays zod-free | unit | `npm run typecheck` + grep on events.ts | ✅ | ⬜ pending |
| 04-02-01 | 02 | 1 | AGENT-04 | T-04-05 | storage stamps per-run monotonic seq atomically | unit | `npx vitest run tests/db.test.ts tests/storagePort.test.ts` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 1 | AGENT-04 | T-04-05 | interleaved two-writer appends: gap-free, collision-free seq | unit | `npx vitest run tests/seqOwnership.test.ts tests/runStack.test.ts` | ✅ (seqOwnership ❌ W0) | ⬜ pending |
| 04-03-01 | 03 | 1 | AGENT-05 | T-04-budget | three budget ceilings declared in `ScenarioSchema` | unit | `npx vitest run {scenario/stack schema test}` | ✅ | ⬜ pending |
| 04-03-02 | 03 | 1 | AGENT-02 | — | `AgentInput` is the Pi-free resolved adapter contract | unit | `npm run typecheck` | ✅ | ⬜ pending |
| 04-04-01 | 04 | 2 | AGENT-04 | — | first-token latch (once); verbatim usage; UnknownEvent passthrough | unit | `npx vitest run tests/mapEvent.test.ts` | ❌ W0 (fake Pi events) | ⬜ pending |
| 04-04-02 | 04 | 2 | AGENT-04 | — | tool_execution→tool_call; write→file_mutation | unit | `npx vitest run tests/mapEvent.test.ts` | ❌ W0 | ⬜ pending |
| 04-05-01 | 05 | 3 | AGENT-02, AGENT-03 | T-04-19 | `DEEPSEEK_API_KEY` in-memory only, never in events/subprocess; cwd-lock; skills via additionalSkillPaths | unit | `npx vitest run {adapter fake-session test}` | ❌ W0 (fakeSession) | ⬜ pending |
| 04-05-02 | 05 | 3 | AGENT-02, AGENT-04 | — | one verbatim mockup-only prompt; live event bridge; no steering | unit | `npx vitest run {adapter fake-session test}` | ❌ W0 | ⬜ pending |
| 04-05-03 | 05 | 3 | AGENT-01 | — | `piAgentAdapter.ts` is the SOLE `src/**` importer of the Pi coding-agent SDK | unit | `npx vitest run tests/importBoundary.test.ts` | ❌ W0 | ⬜ pending |
| 04-06-01 | 06 | 4 | AGENT-05 | T-04-01 | first-to-trip ceiling aborts, keeps partial work, emits `benchmark_finished{timeout}` | unit | `npx vitest run {budget fake-session test}` | ❌ W0 | ⬜ pending |
| 04-06-02 | 06 | 4 | AGENT-05 | T-04-01 | honest usage on abort (no token loss); guaranteed-once teardown | unit | `npx vitest run {teardown fake-session test}` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*File Exists "❌ W0" = the test file/fixture is created by the plan's own first task (fake-session scaffolding), not a pre-existing file.*

---

## Wave 0 Requirements

vitest (two-tier) is already installed and configured from Phases 1–3 — no framework install needed.
The only new test scaffolding is the zero-cost **fake Pi session** infrastructure, created inside the
plans that first need it (not a separate Wave-0 pass):

- `tests/_fakes/fakeSession.ts` — a scripted-event fake `AgentSession` (created in Plan 04-05) that
  drives `runSession` and the 04-06 ceiling/teardown tests with no live provider call.
- Hand-authored fake Pi event objects for `mapEvent` (created in Plan 04-04) — cover the
  first-token latch, aborted-turn usage, retry→UnknownEvent, and tool/file derivations.

*Existing vitest infrastructure covers all phase requirements; the fake-session helpers are built in-plan.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| One live paid v1 row (Angular + DeepSeek 4 Pro + dashboard) to calibrate default ceilings & retry tuning | AGENT-05 | Real cost/latency numbers need one real run; RESEARCH marks defaults `[ASSUMED]` | After the phase is green, run the v1 row once; confirm the run completes or trips a ceiling cleanly, usage/cost recorded verbatim, no orphaned process/port. |
| `models/deepseek4pro.json` provider/modelId resolves & advertises image input | AGENT-02 | Requires the real provider registry | Before the first paid row, confirm `getModel(provider, id)` resolves and the model accepts image input. |

*All automated phase behaviors have fake-session coverage; only live-cost calibration is manual (Open Questions 3 + ceiling tuning).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (fake-session scaffolding built in-plan)
- [x] No watch-mode flags
- [x] Feedback latency < 8s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-02
