---
status: testing
phase: 04-agent-runtime-pi-sdk-adapter
source: [04-VERIFICATION.md]
started: 2026-07-03T01:30:31Z
updated: 2026-07-03T01:30:31Z
---

## Current Test

number: 1
name: Live agent build smoke run (AGENT-03 runtime clause — "the agent builds the app")
expected: |
  With a real provider key set (e.g. DEEPSEEK_API_KEY), the Pi adapter's
  runSession drives one live session against a scenario: injects the
  prompt + skills + mockup image, the agent actually builds the app, and the
  adapter yields a live AgentEventDraft stream ending in a benchmark_finished
  event — with usage/TTFT captured (non-zero cost, first_token latency recorded).
awaiting: user response

## Tests

### 1. Live agent build smoke run (AGENT-03 runtime clause)
expected: |
  With a real provider key set (e.g. DEEPSEEK_API_KEY), the Pi adapter's
  runSession drives one live session: injects prompt + skills + mockup image,
  the agent builds the app, and the adapter yields a live AgentEventDraft stream
  ending in benchmark_finished, with usage/TTFT captured.
note: |
  All Phase-4 automated tests use scripted fake Pi sessions by design (zero paid
  tokens). Implementation is type-clean (tsc passes), fully wired, and has no
  remaining SEAM markers — only live behavioral proof is pending. The plans
  explicitly deferred this live run to Phase 5 (orchestrator wires the single row
  end-to-end), so this item may be verified now via a manual smoke run OR left
  to be exercised naturally in Phase 5.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
