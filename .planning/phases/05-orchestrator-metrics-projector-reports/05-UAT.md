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
awaiting: user response

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
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
