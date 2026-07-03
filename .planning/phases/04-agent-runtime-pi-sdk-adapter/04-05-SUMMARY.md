---
phase: 04
plan: 05
subsystem: agent-runtime
tags: [pi-sdk, adapter, agent-port, ports-and-adapters, event-stream, security]
requires:
  - "src/agent/types.ts (AgentInput contract, 04-03)"
  - "src/agent/mapEvent.ts (createEventMapper, 04-04)"
  - "src/core/ports.ts (AgentPort seam)"
  - "src/core/events.ts (AgentEventDraft union, 04-01/04-02)"
provides:
  - "src/agent/piAgentAdapter.ts (runSession AgentPort impl; sole Pi-SDK importer)"
  - "SessionLike / SessionFactory / RunSessionDeps injection seam"
  - "createPiSession real factory; assertAgentInput; isFatalTerminal; eventBridge"
  - "tests/_fakes/fakeSession.ts (scriptable SessionLike double)"
affects:
  - "Plan 04-06 (fills the three 04-06 SEAMs: ceilings/AbortController, timeout terminal, teardown, path-containment)"
  - "Phase 5 orchestrator (consumes AgentPort.runSession + StoragePort.appendEvent stamps seq)"
tech-stack:
  added: []
  patterns:
    - "Ports-and-adapters: Pi encapsulated behind AgentPort; import-boundary test enforces single importer"
    - "Callback → async-iterator push-queue bridge (stdlib Promises, no dep) for live event streaming"
    - "Injectable SessionFactory seam so paid SDK is substituted by a scripted fake (zero network/cost)"
key-files:
  created:
    - "src/agent/piAgentAdapter.ts"
    - "tests/_fakes/fakeSession.ts"
    - "tests/agentAdapter.test.ts"
    - "tests/importBoundary.test.ts"
  modified: []
decisions:
  - "assertAgentInput is a hand-written structural narrow (not zod) — AgentInput is an internal type, not a spec file (D4-22)"
  - "Retry configured via SettingsManager.inMemory({retry}) since CreateAgentSessionOptions exposes no retry field; passed to both createAgentSession and DefaultResourceLoader"
  - "setRuntimeApiKey uses input.model.provider (v1=deepseek) with env var fixed to DEEPSEEK_API_KEY; AuthStorage.inMemory() guarantees no auth.json"
  - "importBoundary comment-strip uses one combined regex (line-comment matched before block) so 'src/**' inside a // header line does not open a spurious block comment"
metrics:
  duration: 14min
  completed: 2026-07-02
status: complete
---

# Phase 4 Plan 05: Driving Pi Adapter (piAgentAdapter) Summary

`runSession` realises `AgentPort` as a live `AsyncIterable<AgentEventDraft>`: it narrows the orchestrator's untyped input, creates one cwd-locked in-memory-auth Pi session with the resolved model + skills + configured built-in retry, fires exactly one verbatim mockup-only prompt, and bridges Pi's `subscribe` stream through the 04-04 `createEventMapper` into live-yielded canonical drafts — with `piAgentAdapter.ts` structurally proven to be the only `src/**` module that imports the Pi coding-agent SDK (AGENT-01).

## What was built

- **`createPiSession`** (the sole `@earendil-works/pi-coding-agent` importer): `AuthStorage.inMemory()` + `setRuntimeApiKey` (no `auth.json`, D4-19), `ModelRegistry.create(...).find(provider, modelId)` (D4-20), `DefaultResourceLoader({ additionalSkillPaths, noContextFiles, agentDir })` + `reload()` with a load-error guard (D4-16), `createAgentSession({ cwd, model, ... })` with default native tools (AGENT-03/D4-21) and `SettingsManager.inMemory({ retry })` (D4-14). Temperature deliberately not passed — v1 accepts the provider default (D4-18).
- **`SessionLike` seam** (`subscribe`/`prompt`/`abort`/`getSessionStats`/`dispose`) + `SessionFactory`/`RunSessionDeps` injection so the whole run is drivable from a fake.
- **`runSession` generator**: `assertAgentInput` trust-boundary narrow (D4-22), ~20-line `eventBridge` push-queue (D4-13), single flat-`ImageContent` mockup prompt fired without awaiting before draining (D4-04/06/07/08), live drain, and `isFatalTerminal` → `benchmark_finished{agent_error}` on a fatal turn_end / retry-exhausted / rejected prompt (D4-14). Natural completion yields no terminal (runStack owns it, D4-21). Drafts are seqless (D4-26).
- **`tests/_fakes/fakeSession.ts`**: scriptable double replaying `PiEvent[]` with a gate to prove live (incremental) streaming.
- **`tests/importBoundary.test.ts`**: AGENT-01 guard (single importer + sole `createAgentSession` reference).

## Three 04-06 SEAMs left in place (unimplemented, as specified)

1. `piAgentAdapter.ts:245` — AbortController + three-ceiling monitor (wall/usd/turns).
2. `piAgentAdapter.ts:298` — `else if (tripped) yield benchmark_finished{timeout}`.
3. `piAgentAdapter.ts:301` — teardown → `abort()` + `dispose()` + `killProcessTree()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] importBoundary comment-stripping swallowed the SDK import**
- **Found during:** Task 3 (first run failed: `expected [] to deeply equal [piAgentAdapter.ts]`).
- **Issue:** The two-pass strip (`block` then `line`) treated `src/**` inside the `//` file-header as an opening `/**`, greedily removing everything through the next `*/` — including the real import line.
- **Fix:** One combined regex `/\/\/.*$|\/\*[\s\S]*?\*\//gm` so a line comment is matched before a block at each index.
- **Files modified:** tests/importBoundary.test.ts
- **Commit:** 60aae9e

No functional deviations in `piAgentAdapter.ts` — Tasks 1 and 2 executed as written. Minor API-surface confirmations against the installed `dist/*.d.ts` (all matched RESEARCH): `AuthStorage.inMemory()`, `ModelRegistry.create`/`find`, `SettingsManager.inMemory({retry})`, `ResourceDiagnostic.type === "error"`, flat `ImageContent { type, data, mimeType }`, `SessionStats.cost`.

## Authentication Gates

None. Every Phase-4 test drives the fake session — zero network, zero paid tokens. The live `DEEPSEEK_API_KEY` path is exercised only by Plan 04-06's live run (out of scope here).

## Known Stubs

None. The three 04-06 SEAMs are documented deferrals to the next plan (not stubs feeding the UI); `runSession`'s validated behaviour is complete for the fake-driven contract.

## Self-Check: PASSED

- Files created (verified on disk): `src/agent/piAgentAdapter.ts`, `tests/_fakes/fakeSession.ts`, `tests/agentAdapter.test.ts`, `tests/importBoundary.test.ts`.
- Commits verified in `git log`: 8d7d044, 4bdf4b9, f8a3503, 60aae9e.
- `npm run typecheck`: clean.
- `npm test` (full suite): **21 files, 115 tests passed** (10 new: 8 adapter + 2 import-boundary), zero regressions, no live/paid test run (`*.live` excluded).
- Three `04-06 SEAM` markers present at lines 245 / 298 / 301.
