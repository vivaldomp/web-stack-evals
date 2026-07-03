---
phase: 05-orchestrator-metrics-projector-reports
reviewed: 2026-07-03T14:40:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - models/deepseek4pro.json
  - package.json
  - scenarios/dashboard/dashboard.yaml
  - src/agent/modelCapabilities.ts
  - src/agent/piAgentAdapter.ts
  - src/agent/types.ts
  - src/cli/cli.ts
  - src/cli/index.ts
  - src/core/events.ts
  - src/orchestrator/run.ts
  - src/pipeline/runStack.ts
  - src/reports/renderReport.ts
  - src/storage/evaluations.ts
  - src/telemetry/projectMetrics.ts
  - tests/agentAdapter.test.ts
  - tests/cli.test.ts
  - tests/importBoundary.test.ts
  - tests/modelCapabilities.test.ts
  - tests/orchestrator.test.ts
  - tests/productionSpecs.test.ts
  - tests/projectionNotInline.test.ts
  - tests/projector.test.ts
  - tests/renderReport.test.ts
  - tests/runOutcome.test.ts
  - tests/runStack.integration.test.ts
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-07-03T14:40:00Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Phase 5 wires the orchestrator, metric projector, capability probe, and self-contained
HTML report. The security-critical surfaces reviewed as focus areas are **sound**:

- **XSS choke point (renderReport.ts):** every untrusted interpolation traced —
  `runId`, `stackName`/`modelName`/`scName` (manifest-derived), `failedStage`,
  timeline narration, `toolName`/`argsSummary`, metric name/value/unit — passes
  through `esc()`. Image `src` is a base64 `data:` URI (charset can't break the
  attribute). Self-containment holds: no `<link>`, `<script>`, external `src`, or
  `fetch`. No XSS finding.
- **SQL (evaluations.ts, projectMetrics.ts, cli.ts):** all statements use bound
  named/positional params; no string interpolation into SQL. The one interpolated
  table name (`projectionNotInline.test.ts`) is a hard-coded literal set. Clean.
- **Projection-not-inline (D-24):** `projectMetrics(db, runId)` takes no live-run
  state and is the sole writer of the three projection tables; fold is idempotent
  via delete-then-insert in one transaction. Correct.
- **Pi-SDK boundary (D-23):** `importBoundary.test.ts` structurally enforces the
  two-importer allowlist; `modelCapabilities.ts` reads only `ModelRegistry`, never
  `createAgentSession`. Correct.
- **Exit-code mapping (D5-08):** scored terminals return; harness-fatal conditions
  throw. The one gap is the crash path in CR-01 below.

One BLOCKER (an unhandled-rejection crash path that can bypass the whole exit-code
contract), two WARNINGs, and three INFO items follow.

## Critical Issues

### CR-01: Unguarded `void session.abort()` on ceiling trips can crash the orchestrator and strand the run at `status='pending'`

**File:** `src/agent/piAgentAdapter.ts:264`, `:294`, `:297`
**Issue:** Three ceiling-trip abort calls are fire-and-forget:

```ts
const wallTimer = setTimeout(() => {
  tripped ??= "wall";
  void session.abort();          // :264 — no .catch
}, agentInput.budget.maxWallClockMs);
...
if (turns >= agentInput.budget.maxTurns) {
  tripped ??= "turns";
  void session.abort();          // :294 — no .catch
} else if (session.getSessionStats().cost >= agentInput.budget.maxCostUsd) {
  tripped ??= "usd";
  void session.abort();          // :297 — no .catch
}
```

The teardown `finally` block wraps the *same* call in `try { await session.abort() } catch {}`
(`:382-386`) with the comment "abort() after a natural completion resolves as a
no-op — swallow" — i.e. the author already knows `abort()` can reject. The three
inline sites fire while a turn is genuinely in-flight (the case most likely to
reject), yet leave the rejection unhandled. Under Node 24's default
`--unhandled-rejections=throw`, an unhandled rejection **terminates the process**.

Impact: a wall/usd/turns ceiling trip is exactly a paid, long-running run. If the
in-flight `abort()` rejects, the orchestrator process dies mid-`runBenchmark`,
before `updateRunOutcome` (`run.ts:254`) runs — the `runs` row stays `pending`
forever, no metrics fold, and the D5-08 "scored terminals never throw → exit 0"
guarantee is silently violated (process crashes instead of returning a code).
Tests don't catch it because the fake `abort()` always resolves.

**Fix:** guard every fire-and-forget abort the same way the `finally` already does:

```ts
const swallow = () => {}; // abort() may reject on an in-flight turn — never let it go unhandled
const abortNow = () => { void session.abort().catch(swallow); };
// then at :264 / :294 / :297
abortNow();
```

## Warnings

### WR-01: `modelAcceptsImage` conflates "unknown model" with "text-only", and `runBenchmark` exposes no resolver seam — the production model silently loses mockup grounding

**File:** `src/agent/modelCapabilities.ts:35`, `src/orchestrator/run.ts:171`
**Issue:** `modelAcceptsImage` returns `resolve(spec)?.input?.includes("image") ?? false`.
A model that fails to resolve in the default registry (`ModelRegistry.create(AuthStorage.inMemory())`)
returns `false` — indistinguishable from a genuinely text-only model. `run.ts:171`
calls it with the **default** resolver only (`RunBenchmarkDeps` has no resolver
override), so:

1. The production model `models/deepseek4pro.json` (`deepseek-4-pro`) is almost
   certainly not present in an empty-auth pi registry → `injectImage=false` → the
   mockup is **never sent** on the real benchmark, and every prod run emits the
   `mockup_grounding_skipped` caveat. The image-injection path (`piAgentAdapter.ts:307`)
   is effectively dead in production.
2. Because there's no injectable resolver on `runBenchmark`, this can't be
   exercised against a real image-capable model in a test either.

This is partially documented as D5-14 behavior, but folding "registry miss" into
"text-only" is a silent, scoring-relevant degradation with no diagnostic.

**Fix:** distinguish the two states — if `resolve(spec)` is `undefined`, log/emit a
distinct "model unresolved, cannot determine image capability" marker rather than
the "text-only skip" caveat; and thread a `resolveModel?` dep through
`RunBenchmarkDeps` so the gate is testable and overridable per deployment.

### WR-02: `agent_error` / `eval_error` terminals render a blank failed-stage label in the report pill

**File:** `src/reports/renderReport.ts:123-126`, `src/orchestrator/run.ts:217-218`
**Issue:** For an agent-emitted terminal, `run.ts` sets `failedStage = null`
(`:218`). In `renderReport`, `failedStage = run?.failed_stage ?? ""` (`:112`) and
the fallback pill is:

```ts
pillText = `FAILED ${MIDDOT} ${esc(failedStage)}`;  // → "FAILED · " (empty tail)
```

So `agent_error` and `eval_error` runs display `FAILED · ` with nothing after the
middot — a blank, confusing label on the flagship post-mortem. The `completed` and
`timeout` statuses have dedicated branches; the catch-all assumes a non-empty
`failedStage` that agent terminals never carry. `cli.ts:145`'s `statusPill` has the
same shape but is saved by its `?? "unknown"` fallback — the report has no such
fallback.

**Fix:** derive the label from `status` when `failedStage` is empty:

```ts
pillText = `FAILED ${MIDDOT} ${esc(failedStage || status)}`;
```

## Info

### IN-01: Reconciliation usage delta is emitted (and tagged `aborted: true`) even on natural completion

**File:** `src/agent/piAgentAdapter.ts:343-357`
**Issue:** `const delta = session.getSessionStats().cost - emittedCost;` then
`if (delta > 0) yield { ... aborted: true }`. This runs on every path, including a
natural, non-aborted completion. If Pi's authoritative total differs from the sum
of per-turn `costUsd` by any rounding, a spurious extra `usage` row is folded and
mislabeled `aborted: true` on a run that never aborted. Cost totals stay correct
(it's the residual), but the `aborted` flag is semantically wrong and an extra
phantom turn's worth of a usage event lands in the log.
**Fix:** only tag `aborted: true` when `tripped !== null || sawFatalError`;
otherwise emit the reconciliation delta with `aborted: false` (or skip it below a
sub-cent epsilon).

### IN-02: Manifest-name / scenario-name / SUB_SCORES logic duplicated across the report and CLI

**File:** `src/reports/renderReport.ts:37-42,73-77,99-109`, `src/cli/cli.ts:61-79,135-140`
**Issue:** `scenarioName`/`scenarioNameFrom`, the manifest name-extraction block
(`stack.template` / `versionStamp.modelId` / expected-path), and the `SUB_SCORES`
array are copy-pasted between the two modules. They will drift (already: one is
`scenarioName`, the other `scenarioNameFrom`). 
**Fix:** hoist a shared `manifestDisplayNames(manifestJson)` helper and a single
`SUB_SCORES` constant into a small module both import.

### IN-03: `scenario.viewport` is declared but the orchestrator renders/evaluates at `stack.viewport`

**File:** `src/orchestrator/run.ts:161,235`, `src/pipeline/runStack.ts:182`
**Issue:** `linkExpectedScreenshot(..., stack.viewport, ...)` (`:161`) and
`evaluateRun({ ..., viewport: stack.viewport })` (`:235`) both use the *stack*
viewport; `runStack` also renders at `stack.viewport`. The zod-validated
`scenario.viewport` (dashboard.yaml: 1280×800) is never consumed by the run path,
so a scenario-level viewport is silently inert. If the authored `expected.png`
dimensions ever diverge from `stack.viewport`, pixelmatch throws on the mismatched
buffers and the `onLivePage` catch (`run.ts:242`) swallows it to a `null`
composite with no surfaced reason.
**Fix:** decide one authoritative viewport source; if scenario is meant to win,
pass `scenario.viewport` through the render/eval/link calls; otherwise drop the
field from `ScenarioSchema` to remove the dead knob.

---

_Reviewed: 2026-07-03T14:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
