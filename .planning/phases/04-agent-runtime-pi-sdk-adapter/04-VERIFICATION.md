---
phase: 04-agent-runtime-pi-sdk-adapter
verified: 2026-07-02T22:30:00Z
status: passed
score: 14/15 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:

  - truth: "The agent actually builds the app in the disposable workspace using Pi native tools (no MCP) — ROADMAP SC2 runtime clause / AGENT-03."
    test: "Set DEEPSEEK_API_KEY and drive one live run of the REAL createPiSession path (not the fake): construct an AgentInput pointing at tmp/<runId>/angular, call runSession, and confirm the agent produces build output and the event stream carries real session_started/first_token/usage drafts."
    expected: "A live Pi session starts against DeepSeek, the agent runs npm run build via its own bash tool, files land in tmp/<runId>/angular, and no error terminal is emitted for a healthy run."
    why_human: "Every Phase-4 test drives a scripted fake session (zero paid tokens by design). The concrete Pi SDK wiring in createPiSession (AuthStorage.inMemory/setRuntimeApiKey, ModelRegistry.find, DefaultResourceLoader.additionalSkillPaths, createAgentSession) is type-clean (tsc --noEmit passes) but is never executed at runtime without a paid external provider. 'Builds the app' is a live-agent behavior that presence + type checks cannot prove."
human_verification:

  - test: "Live smoke run of the real createPiSession path against DeepSeek (see behavior_unverified_items #1)."
    expected: "Session starts, agent builds the Angular skeleton in the disposable workspace, real usage/TTFT signals stream through."
    why_human: "External paid-service integration; no automated test exercises the real Pi SDK calls (fakes only)."
---

# Phase 4: Agent Runtime (Pi SDK adapter) Verification Report

**Phase Goal:** Pi SDK behind a single AgentPort: inject prompt+skills+image, build the app, normalize events, capture usage/TTFT.
**Verified:** 2026-07-02T22:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 — only the agent-runtime module imports the Pi SDK; all others depend on `AgentPort` | ✓ VERIFIED | `grep -r earendil-works/pi-coding-agent src/` → sole real import at `piAgentAdapter.ts:19`. `tests/importBoundary.test.ts` walks the comment-stripped src tree and asserts `[SOLE_IMPORTER]` for both `from "…"` and `createAgentSession`. `ports.ts` / `types.ts` are Pi-free (type-only). |
| 2 | `runSession` is a LIVE `AsyncIterable<AgentEventDraft>` — drafts yielded as pushed, never buffered until run end (D4-13) | ✓ VERIFIED | `eventBridge()` push-queue (piAgentAdapter.ts:150-180); `for await (draft of bridge.stream()) yield draft` before `await settled`. `agentAdapter.test.ts` "streams drafts live" gates prompt open and asserts first draft arrives before settle. |
| 3 | Session injects verbatim prompt (preamble+`\n\n`+promptText), skills via `additionalSkillPaths`, mockup as flat verbatim-base64 image — exactly ONE prompt | ✓ VERIFIED | Single `session.prompt` (piAgentAdapter.ts:306-315); `DefaultResourceLoader({ additionalSkillPaths })` (88-94). `agentAdapter.test.ts` asserts one prompt, exact text, byte-exact mockup round-trip, single flat image. |
| 4 | Model resolved through Pi `ModelRegistry.find(provider, modelId)`; in-memory auth; cwd-locked to `input.workspacePath` | ✓ VERIFIED | `createPiSession` (piAgentAdapter.ts:53-130): `ModelRegistry.create(authStorage).find(...)`, `AuthStorage.inMemory()`, `createAgentSession({ cwd: input.workspacePath })`. Type-clean (tsc passes). |
| 5 | SC2 runtime — the agent actually BUILDS the app in the disposable workspace using Pi native tools (no MCP) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Enabling code present + type-clean: no `tools`/`noTools` allowlist (default native tools incl. bash → D4-21 self-correct), no MCP, cwd-locked disposable workspace. But no test drives the real Pi session — see Human Verification. |
| 6 | SC3 — Pi events normalized into the canonical `AgentEvent` union via `createEventMapper` | ✓ VERIFIED | `mapEvent.ts` pure translator: `agent_start`→session_started (latched), first text_delta→first_token (latched), `turn_end`→usage, tool start/end→tool_call(+file_mutation), default→UnknownEvent passthrough. Adapter bridges each Pi event through it. `tests/mapEvent.test.ts` table-driven. |
| 7 | Events appended to the log; `seq` is owned by `StoragePort.appendEvent`, stamped atomically per-run (D4-26) | ✓ VERIFIED | `db.appendEvent` stamps `MAX(seq)+1` in a transaction (db.ts:46-60); `ports.ts` `appendEvent(e: AgentEventDraft)`. `tests/seqOwnership.test.ts` interleaves two writers on one run → gap-free, collision-free, strictly-increasing, per-run-independent seq read back from real SQLite. |
| 8 | `runStack` has NO local seq counter (draft-only appends) | ✓ VERIFIED | `grep 'let seq\|seq++\|seq: seq' src/pipeline/runStack.ts` → none. All `storage.appendEvent({...})` calls are seqless drafts. |
| 9 | SC4 — raw per-turn usage captured VERBATIM (input/output/cache-read/cache-write tokens + unrounded cost) | ✓ VERIFIED | `mapEvent.ts turn_end` arm passes `usage.*` and `cost.total` through verbatim (never pre-rounded, D-26). `UsageEvent` type carries all fields + `aborted`. |
| 10 | TTFT signals present in the stream: `session_started` (t0) once + `first_token` once (idempotent latch); arithmetic fold is Phase 5 | ✓ VERIFIED | `createEventMapper` latches both once (mapEvent.ts:45-60). `events.ts` documents TTFT = first_token.ts − session_started.ts folded in Phase 5. mapEvent test asserts single-emit. |
| 11 | Three-ceiling budget monitor (wall / cumulative-USD / turns); FIRST to trip calls `session.abort()` → `benchmark_finished{timeout}`; partial work kept | ✓ VERIFIED | piAgentAdapter.ts:258-299 (`wallTimer`, turn count, `getSessionStats().cost` check, `tripped ??=`). `tests/agentCeilings.test.ts` proves all three independently (fake timers for wall), one terminal, and no `rmSync`/`cleanupWorkspace` in adapter. |
| 12 | Honest usage-on-abort reconciliation: Σ emitted `usage.costUsd` vs `getSessionStats().cost` → one delta `usage{aborted:true}` | ✓ VERIFIED | piAgentAdapter.ts:337-351. `tests/agentAbortUsage.test.ts` proves delta when unbalanced, no extra draft when balanced. |
| 13 | Guaranteed-once teardown in `finally`: `clearTimeout` → `abort()` (swallow) → `dispose()` on natural / trip / fatal / early-break | ✓ VERIFIED | piAgentAdapter.ts:372-382. `agentAbortUsage.test.ts` asserts `disposeCount === 1` and `abortCount ≥ 1` on natural, ceiling-trip, and fatal exits. |
| 14 | Spec schemas carry `budget` (3 ceilings + per-field + object defaults) and required non-empty `preamble`; `AgentInput` is Pi-free | ✓ VERIFIED | `schema.ts`: `StackSchema.preamble: z.string()` (required), `ScenarioSchema.budget` strictObject with defaults 20/5/50. `stacks/angular.yaml` authored non-editorializing preamble. `types.ts` imports only units (no Pi). |
| 15 | Provider key never leaks into events / subprocess / disk (D4-19) | ✓ VERIFIED | In-memory `AuthStorage`, `setRuntimeApiKey` only (piAgentAdapter.ts:57-62). `agentAdapter.test.ts` sentinel-key test asserts key absent from serialized drafts. |

**Score:** 14/15 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/agent/piAgentAdapter.ts` | Sole Pi importer; `runSession` generator; ceilings/reconcile/teardown | ✓ VERIFIED | 387 lines, substantive, wired (consumed as `AgentPort`), no SEAM markers left. |
| `src/agent/mapEvent.ts` | Pure `createEventMapper` Pi→canonical translator | ✓ VERIFIED | 173 lines, imported+used by adapter and tests. |
| `src/agent/types.ts` | `AgentInput`/`AgentBudget`/`AgentModelSpec`, Pi-free | ✓ VERIFIED | Type-only import of units; no Pi. |
| `src/core/events.ts` | +SessionStarted/FirstToken/Usage in union; `AgentEventDraft` | ✓ VERIFIED | All three in `AgentEvent`; DistributiveOmit draft alias. |
| `src/core/ports.ts` | `AgentPort.runSession`; `appendEvent(AgentEventDraft)` | ✓ VERIFIED | Seqless-draft append boundary declared. |
| `src/storage/db.ts` | Seq-stamping `appendEvent` (MAX+1 in txn) | ✓ VERIFIED | Atomic per-run seq. |
| `src/pipeline/runStack.ts` | Local `let seq` removed; draft appends | ✓ VERIFIED | No seq counter. |
| `src/specs/schema.ts` | `preamble` (req) + `budget` (3 ceilings) | ✓ VERIFIED | strictObject preserved, defaults present. |
| `stacks/angular.yaml` | Authored non-empty preamble | ✓ VERIFIED | Grounds env, no task editorializing. |
| test suite (7 files) | Behavioral proofs | ✓ VERIFIED | importBoundary, agentAdapter, agentCeilings, agentAbortUsage, seqOwnership, mapEvent, agentInput all present; full suite 125/125 (orchestrator-run). |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `session.subscribe` listener | `createEventMapper` | mapped drafts pushed to bridge, live-yielded | ✓ WIRED (piAgentAdapter.ts:285-302) |
| adapter drafts | `StoragePort.appendEvent` | seqless drafts; storage stamps seq | ✓ WIRED (ports.ts + db.ts + seqOwnership test) |
| `process.env.DEEPSEEK_API_KEY` | `authStorage.setRuntimeApiKey` (in-memory) | never persisted/logged/emitted | ✓ WIRED (type-clean; sentinel test) |
| `ScenarioSchema.budget` | `AgentInput.budget` → ceiling monitor | orchestrator resolves (Phase 5) | ⚠️ downstream consumer is Phase 5 (adapter side complete) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AGENT-01 | 04-01, 04-05 | Pi SDK encapsulated behind `AgentPort`; no other importer | ✓ SATISFIED | import-boundary test + grep |
| AGENT-02 | 04-03, 04-05 | Start session injecting prompt + skills + mockup image | ✓ SATISFIED | single-prompt/image/skills tests + createPiSession |
| AGENT-03 | 04-05 | Agent builds app via Pi native tools (no MCP) | ⚠️ NEEDS HUMAN | default native tools, no MCP, cwd-locked (structural); live build needs paid run |
| AGENT-04 | 04-01, 04-02, 04-04, 04-05 | Pi events normalized into canonical `AgentEvent` stream | ✓ SATISFIED | mapEvent + adapter bridge + seq append |
| AGENT-05 | 04-01, 04-03, 04-06 | Capture raw per-turn usage + derive TTFT | ✓ SATISFIED | verbatim UsageEvent; session_started+first_token signals (fold Phase 5) |

All 5 phase requirement IDs accounted for. No orphaned requirements (REQUIREMENTS.md maps AGENT-01..05 exactly to Phase 4).

### Behavioral Spot-Checks

Full vitest suite 125/125 and `tsc --noEmit` clean (run independently by orchestrator). Not re-run. The behavior-dependent invariants (three-ceiling first-to-trip, abort reconciliation delta, guaranteed-once teardown, interleaved-writer seq monotonicity, live non-buffered streaming) each have a dedicated deterministic test that drives the real `runSession` generator through a scripted fake session — verified by reading the test bodies, not the SUMMARY.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| src/agent/* | `ponytail:` comments (retry constants, temperature, line counts) | ℹ️ Info | Deliberate, ceiling-named simplifications with upgrade paths — not debt. No `TBD`/`FIXME`/`XXX` markers anywhere in phase source. |

No blocker or warning anti-patterns. No stubs (empty returns are the correct D-02 passthrough / balanced-cost no-delta paths). No leftover `04-06 SEAM` markers.

### Human Verification Required

**1. Live smoke run of the real Pi wiring**

- **Test:** With `DEEPSEEK_API_KEY` set, drive one live `runSession` through the real `createPiSession` (not the fake): build an `AgentInput` for `tmp/<runId>/angular`, consume the stream.
- **Expected:** Pi session starts against DeepSeek, the agent runs `npm run build` via its bash tool and mutates the workspace, and real `session_started`/`first_token`/`usage` drafts stream through with no spurious error terminal.
- **Why human:** External paid-service integration. Every Phase-4 test uses a scripted fake (zero cost by design), so the concrete Pi SDK calls — while type-clean (tsc passes) — are never runtime-exercised. "Builds the app" is a live-agent behavior presence checks cannot prove.

### Gaps Summary

No gaps. Nothing is missing, stubbed, or unwired. The adapter, event mapper, storage-owned seq boundary, budget ceilings, honest usage-on-abort, guaranteed teardown, and Pi-free spec/input contracts are all implemented and proven by deterministic tests that exercise the actual invariants. The single non-green item is inherent to an adapter over a paid external SDK: the real `createPiSession` path and the "agent builds the app" runtime clause (AGENT-03 / SC2) cannot be verified without a live DeepSeek run, which the plans explicitly scoped out of Phase-4 testing and deferred to Phase-5 orchestration. This routes the phase to `human_needed` (one external-service smoke check), not `gaps_found`.

---

_Verified: 2026-07-02T22:30:00Z_
_Verifier: Claude (gsd-verifier)_
