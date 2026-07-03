---
status: testing
phase: 05-orchestrator-metrics-projector-reports
source: [05-VERIFICATION.md]
started: "2026-07-03T14:57:35Z"
updated: "2026-07-03T14:57:35Z"
---

## Current Test

number: 1
name: Run the real live benchmark row (Angular + DeepSeek 4 Pro, dashboard)
expected: |
  Exits 0; prints the D5-03 terminal summary (status pill, composite score, 4 sub-scores,
  wall/cost/tokens/iterations); writes results/<run_id>/report.html with the
  expected/generated/diff triptych. The runs row persists a terminal status.
awaiting: user go/no-go on closing Phase 5 / v1.0 milestone (G3 known debt open)
note: |
  Test 2 (integration + selftest suite) auto-verified pass on 2026-07-03 once port 4200
  freed — 12/12. Test 1's first attempt failed pre-flight with "Model not found in Pi
  registry: deepseek/deepseek-4-pro" — root-caused to a typo in models/deepseek4pro.json
  (deepseek-4-pro → deepseek-v4-pro). Fixed + suite still 177/177. Re-run the run command
  to observe the live green row.

## Tests

### 1. Live green benchmark row
expected: |
  With a free port 4200 and a DeepSeek API key set, run:
  `nvm exec 24.18.0 npx tsx src/cli/index.ts run --stack angular --model deepseek4pro --scenario dashboard`
  → exits 0; prints the D5-03 terminal summary (status pill, composite, 4 sub-scores,
  wall/cost/tokens/iterations); auto-writes results/<run_id>/report.html with the
  expected/generated/diff triptych; the runs row persists a terminal status.
why_human: |
  The headline "one green benchmark row" requires a live, paid Pi/DeepSeek call + a real
  Angular build + a real Playwright render — not reachable programmatically here. Orchestration
  logic is fully unit/behaviorally verified with fakes (orchestrator.test.ts); only the live
  green row itself is a runtime observation.
result: pass
verified: |
  Live run executed end-to-end after the G1 fix: run-20260703173100-f26ce5, status SCORED,
  wall 129.1s $0.017 448.3k tok 21 iters, terminal runs row persisted, report + triptych
  written. Headline "one green benchmark row" (orchestrate→agent→build→render→score→persist
  →report) is proven. The 182 MB report defect surfaced here (G2) has been FIXED + verified
  (regenerated from the stored run → 192 KB, triptych intact, no raw-event leaks; suite
  178/178). Composite value itself is not meaningful for this run because the dashboard
  scenario ships a 1×1 placeholder expected.png (G3) — a scenario-asset gap, out of Phase-5
  orchestration scope, tracked as known debt.

### 2. Environment-blocked integration + selftest suite
expected: |
  Free port 4200 first (an orphaned Phase-4 smoke-test sirv process, pid 690263, from
  tmp/smoke-686950 has been squatting on it — kill it: `kill -9 $(lsof -t -i:4200)`), then:
  `nvm exec 24.18.0 npx vitest run --config vitest.integration.config.ts --no-file-parallelism tests/runStack.integration.test.ts tests/isolation.selftest.test.ts`
  → the two real-server teardown assertions (server torn down after the eval window; timeout
  leaves port free) and tests/isolation.selftest.test.ts all pass.
why_human: |
  The default unit suite (177/177) + typecheck are clean, but these real-server assertions
  need the fixed port 4200 free. The orchestrator was denied authorization to kill the
  untracked squatting process, so a human must free the port and re-run.
result: pass
verified: |
  Port 4200 was free (orphaned Phase-4 sirv process gone). Ran the integration + selftest
  suite: 2 files / 12 tests passed in 30s — both real-server teardown assertions and
  tests/isolation.selftest.test.ts green.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0
known_debt: 1  # G3 — scenario asset (1×1 expected.png), out of Phase-5 scope

## Gaps

- id: G1
  truth: "`run --model deepseek4pro` starts a live Pi session (reaches the paid call)"
  status: fixed_pending_reverify
  reason: "User reported: Model not found in Pi registry: deepseek/deepseek-4-pro"
  severity: blocker
  test: 1
  root_cause: "models/deepseek4pro.json declared modelId 'deepseek-4-pro'; Pi's registry lists it as 'deepseek-v4-pro' (missing the 'v'). piAgentAdapter.ts:68 ModelRegistry.find returns undefined → throws before any paid call. The real deepseek-v4-pro has input:['text'], so the D5-01 image-gate (text-only → skip mockup) is unaffected."
  artifacts:
    - path: "models/deepseek4pro.json"
      issue: "modelId typo deepseek-4-pro → deepseek-v4-pro"
    - path: "tests/productionSpecs.test.ts"
      issue: "assertion pinned the typo'd id"
  fix: "Corrected modelId to deepseek-v4-pro (verified present in Pi registry) + updated the production-spec assertion. Default suite 177/177 green."
  reverify: "Re-run: nvm exec 24.18.0 npx tsx src/cli/index.ts run --stack angular --model deepseek4pro --scenario dashboard"

- id: G2
  truth: "report.html is a self-contained, portable report (REPORT-02 / D5-09)"
  status: fixed
  fix: "renderReport timeline now extracts only incremental assistant text (raw.text / raw.delta / assistantMessageEvent.delta for text_delta), coalesces consecutive fragments, and never JSON.stringify(raw) nor embeds toolcall_delta `partial` fields. Added renderReport BOUNDED test (200×50KB partials → report <200KB). Verified by regenerating the stored run: 183MB → 192KB, triptych intact, 0 raw-event leaks, suite 178/178."
  reason: "report.html rendered at 182 MB — a browser will choke; not portable"
  severity: major
  test: 1
  root_cause: "src/reports/renderReport.ts timeline (lines 242-264) maps EVERY event; for `message_update` events the real text lives at raw.assistantMessageEvent.delta, but the code checks only raw.text/raw.delta and falls through to JSON.stringify(raw). Run run-20260703173100-f26ce5 has 7,240 message_update events (streaming toolcall_delta, each carrying a cumulative `partial`) totaling 155 MB of raw JSON, all dumped + HTML-escaped into one timeline line → 182 MB."
  artifacts:
    - path: "src/reports/renderReport.ts"
      issue: "timeline JSON.stringify(raw) fallback embeds unbounded raw streaming deltas"
  missing:
    - "Render only meaningful timeline lines: read raw.assistantMessageEvent, keep text deltas, drop toolcall_delta streaming noise; never JSON.stringify(raw)."
    - "Add a renderReport test asserting a many-message_update run produces a bounded (<~1 MB) report."
  reverify: "Regenerate from the stored run (no paid call): report command for run-20260703173100-f26ce5, assert size is small."

- id: G3
  truth: "the dashboard composite/pixelmatch score reflects real visual fidelity"
  status: failed
  reason: "scenarios/dashboard/expected.png is a 1x1 placeholder (68 bytes) → pixelmatch/composite meaningless"
  severity: minor
  test: 1
  root_cause: "Scenario asset, not Phase-5 orchestration. The dashboard scenario shipped a 1x1 placeholder reference screenshot."
  artifacts:
    - path: "scenarios/dashboard/expected.png"
      issue: "1x1 placeholder reference image"
  missing:
    - "Replace expected.png with a real reference render of the dashboard mockup (owner decision — out of Phase-5 orchestration scope)."
