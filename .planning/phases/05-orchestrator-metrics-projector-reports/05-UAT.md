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
awaiting: user re-run (blocker fixed — see gap G1)
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
result: [pending]

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
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

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
