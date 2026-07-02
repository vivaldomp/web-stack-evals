# Phase 4: Agent Runtime (Pi SDK adapter) - Research

**Researched:** 2026-07-02
**Domain:** Embedding the Pi coding-agent SDK behind a single `AgentPort`, normalizing its event/usage stream into the canonical `AgentEvent` log, and bounding a non-deterministic paid run.
**Confidence:** HIGH — every Pi SDK fact below is verified against the actual published `@earendil-works/pi-coding-agent@0.80.3` and `@earendil-works/pi-agent-core@0.80.3` type declarations (npm-packed and read from `dist/*.d.ts`), plus the installed `@earendil-works/pi-ai@0.80.3`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D4-01:** Session bounded by **three ceilings — wall-clock, cumulative USD, turn count — first-to-trip aborts.** All map to existing `timeout` status (no new enum value).
- **D4-02:** On ceiling hit, **abort but keep partial work**; emit terminal `benchmark_finished` with `status: "timeout"`.
- **D4-03:** The three ceiling values declared in `scenario.yaml` (budget is a property of the task; every model/stack facing the scenario gets identical caps).
- **D4-04:** Scenario **prompt text + mockup image go in verbatim**; platform adds only a **thin environmental preamble**.
- **D4-05:** Preamble is **stack-authored, a field on `stack.yaml`**.
- **D4-06:** Agent sees the **mockup only — never the expected screenshot.**
- **D4-07:** Mockup passed as **base64 PNG verbatim** (`image/png`), no resize/re-encode.
- **D4-08:** **Single prompt, run to natural completion (`agent_end`)**, bounded only by D4-01. **No platform mid-course steering.**
- **D4-09:** **Minimal new typed variants** — add `session_started` (t0 anchor) + per-turn `usage` event only. Everything else rides `UnknownEvent` passthrough.
- **D4-10:** **TTFT via a lightweight `first_token` event**, emitted once on first streamed assistant text. `TTFT = firstToken.ts − session_started.ts`, folded at projection time.
- **D4-11:** **One iteration = one Pi agent turn** = one per-turn `usage` event. Iteration count folds as count of `usage` events.
- **D4-12:** **Assistant narration/reasoning persisted verbatim** (in `UnknownEvent` raw payload).
- **D4-13:** **Events stream live** — adapter yields each `AgentEvent` the moment it occurs (`AsyncIterable<AgentEvent>`).
- **D4-14:** **Transient failures (429/5xx) retry with exponential backoff**, emitting attributable events (TEL-03); after bounded retries → `agent_error`. **Non-transient (auth, invalid request) fail fast.**
- **D4-15:** **Per-turn usage captured even on aborted/errored turns** — no paid tokens go unrecorded.
- **D4-16:** Skills are **scenario-declared paths in `scenario.yaml`** pointing at committed `skills/<name>/` dirs, loaded via Pi resource loader.
- **D4-17:** **All model config from `models/*.json`** via the existing zod loader.
- **D4-18:** **Agent sampling temperature is a model-spec field, defaulting to 0**, overridable.
- **D4-19:** **Provider API key from an env var**, read in the orchestrator process only; never in the run-subprocess env, specs, manifest, or fingerprint.
- **D4-20:** **Provider selection uses Pi's own model lookup** from the model spec — no platform-side provider abstraction.
- **D4-21:** **Agent may run `npm build`/`lint` via its bash tool to self-correct**; Phase 2's `runStack` remains authoritative build/serve/screenshot.
- **D4-22:** **Orchestrator hands the adapter one fully-resolved typed `AgentInput`** (workspace path, prompt, image bytes, skill paths, model, budget); adapter just drives Pi and streams events.
- **D4-23:** **Agent cwd-locked to `tmp/<run_id>/angular/` AND path-contained.**
- **D4-24:** **Teardown = abort the Pi session + process-tree-kill** any children, reusing Phase 2's execa teardown.
- **D4-25:** **No custom per-tool-call timeout in v1** — rely on Pi's built-in tool timeouts + wall-clock ceiling.
- **D4-26:** **Seq ownership moves into `StoragePort.appendEvent()`** — stamps the next per-run monotonic `seq` atomically. Revisits the Phase-1 contract; migrate `runStack` off `let seq = 0`.

### Claude's Discretion (resolved by this research)
- Exact `AgentInput` / `usage` / `first_token` / `session_started` TS shapes → **§ Proposed shapes**.
- Retry count / backoff curve / transient classification → **§ Retry policy** (Pi's built-in retry is used, not hand-rolled).
- Exact `createAgentSession` / `prompt` / `subscribe` wiring + event→variant mapping → **§ Event mapping table** and **§ Code Examples**.
- Default ceiling values for `scenario.yaml` → **§ Default ceilings**.
- Env-var name for the provider key → **`DEEPSEEK_API_KEY`** for the v1 DeepSeek row (verified).

### Deferred Ideas (OUT OF SCOPE)
- MCP injection (`scenario.yaml mcps:`) — v2 via `pi-mcp-adapter`.
- Custom per-tool-call timeout (D4-25).
- Platform steering / follow-up prompts (D4-08 — permanent design stance, not a future feature).
- Matrix breadth, Docker isolation, concurrent-row `get-port` — v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGENT-01 | Pi SDK fully encapsulated behind `AgentPort`; no other module imports it | Only `src/agent/*` imports `@earendil-works/pi-coding-agent`. `AgentPort.runSession` already exists in `src/core/ports.ts`; implement it. Structurally enforced by ports-and-adapters (D-23). |
| AGENT-02 | Start a session injecting prompt + skills + mockup image | `createAgentSession({ cwd, authStorage, modelRegistry, sessionManager, model, resourceLoader })` + `session.prompt(preamble+prompt, { images: [{ type:"image", data: base64, mimeType:"image/png" }] })`. Skills via `DefaultResourceLoader({ additionalSkillPaths })`. All verified. |
| AGENT-03 | Agent builds in workspace using Pi native tools (no MCP for v1) | Default built-in tools (`read`, `bash`, `edit`, `write`, plus `grep`/`find`/`ls`) enabled by default. Pi has no native MCP — nothing to wire. `tools`/`noTools` allowlist available if we ever restrict. |
| AGENT-04 | Pi events normalized into canonical `AgentEvent` stream | Full core event union enumerated (§ Event mapping table). `session.subscribe(listener)` → push into an async queue → yield as `AgentEvent`. |
| AGENT-05 | Capture raw per-turn usage (input/output/cache-read/cache-write + cost), derive TTFT | `turn_end.message.usage` is a pi-ai `Usage` with `{input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost:{input,output,cacheRead,cacheWrite,total}}`. `session.getSessionStats().cost` gives cumulative USD. TTFT from `first_token` marker. |

*Downstream (Phase 5): TEL-03 folds backoff time from `auto_retry_start/end` events; TEL-05 folds iteration count from `usage` events + correction density from repeated `file_mutation`s; TEL-06 folds tool-call counts by type from `tool_call` events.*
</phase_requirements>

## Summary

The Pi coding-agent SDK is real, current (published 2026-06-30), and its actual API is close to — but not identical to — the surface claimed in `CLAUDE.md`. The adapter is a thin bridge: create one in-memory session cwd-locked to the run workspace, fire a single `prompt()` with the mockup image attached, subscribe to the event stream, and translate each Pi event into the canonical `AgentEvent` union. Two new typed variants (`session_started`, `usage`) plus a `first_token` marker cover every metric Phase 5 needs; everything else rides the existing `UnknownEvent` passthrough verbatim.

The single biggest de-risking finding: **Pi already implements transient-error retry with exponential backoff internally** and emits `auto_retry_start` / `auto_retry_end` events carrying `attempt`, `maxAttempts`, `delayMs`, and `errorMessage`. D4-14 is therefore a *configure-and-observe* job, not a hand-rolled retry loop — we set `RetrySettings` and map those two events onto the `UnknownEvent` passthrough so Phase 5 can attribute backoff time. Non-transient errors (auth, invalid request, context overflow) are not retried and surface via the terminal `agent_end` / assistant `stopReason: "error"`.

The three-ceiling budget loop (D4-01) is enforced *around* the session, not inside Pi: a wall-clock timer, a running turn count (one `turn_end` = one turn), and `getSessionStats().cost` polled after each turn — first to trip calls `session.abort()`, and the workspace files survive for Phase 2 to build. Usage is honest on aborted turns because pi-ai attaches `usage` to every `AssistantMessage` including `stopReason: "aborted"`, and `getSessionStats()` aggregates cost across all messages.

**Primary recommendation:** Implement `src/agent/piAgentAdapter.ts` as an async generator that bridges `session.subscribe` → an internal push-queue, drives a single `session.prompt(..., { images })`, and races a ceiling monitor that calls `session.abort()`. Use Pi's built-in retry (configured via `RetrySettings`), map its events onto `session_started` / `first_token` / `usage` / existing `tool_call` / `file_mutation` / `UnknownEvent`, and reconcile final cost from `getSessionStats()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Drive the LLM agent (prompt, tools, turns) | Pi SDK (in-process, orchestrator) | — | AGENT-01: only this module talks to Pi; the SDK owns the model loop. |
| Inject mockup image | Adapter → Pi `PromptOptions.images` | — | Multimodal is a pi-ai `ImageContent` on the prompt. |
| Load skills | Pi `DefaultResourceLoader` (`additionalSkillPaths`) | Repo `skills/<name>/` dirs | D4-16: declarative committed skill dirs; Pi discovers `SKILL.md` roots. |
| Event normalization | Adapter (pure mapping fn) | `src/core/events.ts` union | AGENT-04: SDK events in, canonical `AgentEvent` out. |
| Usage / cost accounting | pi-ai `Usage` on each `AssistantMessage` | `getSessionStats()` for cumulative | AGENT-05, D4-15: honest even on abort. |
| Budget enforcement (3 ceilings) | Adapter (monitor + `abort()`) | Wall-clock timer + turn counter + `getSessionStats().cost` | D4-01: first-to-trip; Pi has no combined budget primitive. |
| Transient-error retry/backoff | Pi built-in (`RetrySettings` + `auto_retry_*` events) | Adapter maps events for TEL-03 | D4-14: do not hand-roll. |
| Provider key / auth | Orchestrator env → `AuthStorage.setRuntimeApiKey` (in-memory) | `ModelRegistry` | D4-19: secret stays in-process, never persisted. |
| Workspace isolation / teardown | `copyWorkspace` cwd + `session.abort()` + execa `killProcessTree` | Phase 2 teardown | D4-23/D4-24. |
| Seq assignment | `StoragePort.appendEvent` (storage-owned) | — | D4-26: atomic per-run monotonic seq. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@earendil-works/pi-coding-agent` | 0.80.3 | Agent runtime — the only new dep this phase adds | [VERIFIED: npm registry] `dist-tags.latest = 0.80.3`, published 2026-06-30, repo `github.com/earendil-works/pi`. The only path to the agent (AGENT-01). |
| `@earendil-works/pi-ai` | 0.80.3 | LLM layer (already installed; supplies `Usage`/`cost`, `ImageContent`) | [VERIFIED: node_modules] Same monorepo, lockstep version, already a dependency (judge uses it). |
| `@earendil-works/pi-agent-core` | 0.80.3 | Core `AgentEvent` union + `Agent` loop (transitive via coding-agent) | [VERIFIED: npm-packed dist] Declared dep `^0.80.3` of coding-agent; where the event `type` strings live. Type-only import if needed. |

### Supporting
Nothing new. The async-queue event bridge, the ceiling monitor, and the event-mapping function are all first-party code (~1 file, no new dependency — see § Don't Hand-Roll).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Embedded SDK (`createAgentSession`) | Pi RPC mode (`pi --mode rpc` over stdin/stdout, `RpcClient`) | RPC isolates Pi in a subprocess (better crash containment) but adds IPC serialization and loses direct `getSessionStats()`/`abort()` calls. For a single in-process v1 row, the SDK is simpler and gives synchronous cost/abort access. Revisit RPC only if Pi crashes must not take the orchestrator down. [CITED: package/docs/rpc.md] |
| Hand-rolled retry | Pi built-in `RetrySettings` | Hand-rolling duplicates logic Pi already has and would fight its internal retry. Use Pi's. |

**Installation:**
```bash
npm install @earendil-works/pi-coding-agent@0.80.3
```
(`pi-ai@0.80.3` already present; `pi-agent-core@0.80.3` arrives transitively.)

**Version verification (performed this session):**
```
npm view @earendil-works/pi-coding-agent version        → 0.80.3
npm view @earendil-works/pi-coding-agent dist-tags.latest → 0.80.3
npm view @earendil-works/pi-coding-agent@0.80.3 time.modified → 2026-06-30T20:34:24Z
npm view @earendil-works/pi-coding-agent@0.80.3 scripts.postinstall → (none)
```

## Package Legitimacy Audit

| Package | Registry | Age | Source Repo | Postinstall | Verdict | Disposition |
|---------|----------|-----|-------------|-------------|---------|-------------|
| `@earendil-works/pi-coding-agent` | npm | published 2026-06-30, is current `latest` | `github.com/earendil-works/pi` | none | OK | Approved |
| `@earendil-works/pi-ai` | npm | already installed & in production use (judge) | same monorepo | none | OK | Approved (no action) |
| `@earendil-works/pi-agent-core` | npm | transitive dep, same scope/version | same monorepo | none | OK | Approved (transitive) |

- **No `postinstall`/`preinstall` script** on the coding-agent package — its `scripts` are build/test/copy-assets only, run at publish time not install time (verified via `npm view … scripts`). No supply-chain execution on `npm install`.
- All three packages share the `@earendil-works` scope, the same `0.80.3` version, and one monorepo (`github.com/earendil-works/pi`). This is the maintained successor to the deprecated `@mariozechner/pi-coding-agent` (CLAUDE.md-confirmed migration).

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                         AgentInput (D4-22, fully resolved by orchestrator)
                              │
                              ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │ src/agent/piAgentAdapter.ts  (ONLY importer of pi-coding-agent)     │
  │                                                                     │
  │  env DEEPSEEK_API_KEY ─► AuthStorage.setRuntimeApiKey (in-memory)   │
  │  models/*.json ────────► ModelRegistry.find(provider, modelId)      │
  │  skill paths ──────────► DefaultResourceLoader({additionalSkillPaths})│
  │  workspace path ───────► createAgentSession({ cwd, … })             │
  │                                                                     │
  │   ┌── session.subscribe(listener) ──┐                               │
  │   │   Pi AgentEvent ──► mapEvent() ──┼──► push-queue ──► (async gen) │──► yield AgentEvent
  │   └──────────────────────────────────┘         ▲                    │        (D4-13 live)
  │                                                 │                    │
  │   session.prompt(preamble+prompt,{images}) ─────┘                    │
  │                                                                     │
  │   ceiling monitor:  wall-clock timer ┐                              │
  │                     turn counter     ├─ first-to-trip ─► session.abort()
  │                     getSessionStats().cost ┘                        │
  │                                                                     │
  │   teardown: session.abort() + session.dispose() + killProcessTree  │
  └───────────────────────────────────────────────────────────────────┘
                              │  AsyncIterable<AgentEvent>
                              ▼
        orchestrator (Phase 5) ─► StoragePort.appendEvent (stamps seq, D4-26)
                              │
                              ▼   (agent mutated tmp/<run_id>/angular/)
                    runStack(...) — authoritative build/serve/screenshot (D4-21)
```

### Recommended Project Structure
```
src/agent/
├── piAgentAdapter.ts    # implements AgentPort.runSession; the ONLY pi-coding-agent import
├── mapEvent.ts          # pure: (piEvent, ctx) => AgentEvent | AgentEvent[] | null  (unit-testable)
├── ceilings.ts          # pure: ceiling monitor (wall/usd/turns) → which tripped
└── types.ts             # AgentInput + the three new event variants (re-exported into core/events.ts)
```

### Verified Pi SDK call surface (corrections to CLAUDE.md in **bold**)

```ts
// Session creation — canonical example from package README + sdk.d.ts
import { AuthStorage, ModelRegistry, SessionManager, createAgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const authStorage = AuthStorage.create();               // in-memory-capable; see D4-19 note
authStorage.setRuntimeApiKey("deepseek", process.env.DEEPSEEK_API_KEY!); // never persisted
const modelRegistry = ModelRegistry.create(authStorage);
const model = modelRegistry.find(modelSpec.provider, modelSpec.modelId); // D4-20; Model<Api> | undefined

const loader = new DefaultResourceLoader({
  cwd: workspacePath,
  agentDir: <tmp agent dir>,          // required field
  additionalSkillPaths: input.skillPaths, // ◄ D4-16: NOT `skillsOverride` (see corrections)
  noContextFiles: true,               // benchmark fairness: no ambient AGENTS.md leakage
});
await loader.reload();

const { session } = await createAgentSession({
  cwd: workspacePath,                 // ◄ D4-23 cwd-lock; tools resolve relative to this
  authStorage,
  modelRegistry,
  model,                              // ◄ pass the resolved Model object (not getModel(provider,id) inline)
  thinkingLevel: modelSpec.params.thinkingLevel, // optional; from models/*.json
  sessionManager: SessionManager.inMemory(workspacePath),
  resourceLoader: loader,
  // default tools (read, bash, edit, write, grep, find, ls) are enabled — AGENT-03
});
```

**Prompt with the mockup (D4-07):**
```ts
await session.prompt(preamble + "\n\n" + scenarioPrompt, {
  images: [{ type: "image", data: mockupPng.toString("base64"), mimeType: "image/png" }],
});
// ◄ CLAUDE.md claimed { source: { type:"base64", mediaType, data } } — WRONG.
//   Real pi-ai ImageContent is FLAT: { type:"image", data: <base64>, mimeType: "image/png" }.
//   Confirmed twice: pi-ai types.d.ts:236 AND the existing judgeEvaluator.ts usage.
```

`session.prompt()` returns `Promise<void>` that resolves when the run *settles* (`agent_end` + listener settlement). Events arrive via `subscribe`, not a returned stream.

**Event subscription (D4-13):**
```ts
const unsubscribe = session.subscribe((event) => {
  // event: AgentSessionEvent — see mapping table below
});
// ... later: unsubscribe(); session.dispose();
```

### Event mapping table (AGENT-04, D4-09/10/11)

Core `AgentEvent` union (from `pi-agent-core` `types.d.ts:360`) + session-level extensions (`agent-session.d.ts:40`):

| Pi event `type` | Payload fields | → Canonical `AgentEvent` | Notes |
|-----------------|----------------|--------------------------|-------|
| `agent_start` | — | **`session_started`** (new) | First occurrence = t0 anchor (D4-10). Emit once. |
| `message_update` | `message`, `assistantMessageEvent` | **`first_token`** (new) *once*, then `UnknownEvent` | Emit `first_token` on the **first** `message_update` whose `assistantMessageEvent.type === "text_start"` (or first `text_delta`). Guard with a boolean. Subsequent updates → `UnknownEvent` (D4-12 narration verbatim). |
| `turn_end` | `message: AssistantMessage`, `toolResults` | **`usage`** (new) | One `turn_end` = one turn = one iteration (D4-11). `message.usage` is the per-turn `Usage`. |
| `tool_execution_end` | `toolCallId`, `toolName`, `result`, `isError` | **`tool_call`** (existing) | `argsSummary` — summarize from the matching `tool_execution_start.args` (cache by `toolCallId`). `isError` maps directly. Emit on `_end` so `isError` is known. |
| `tool_execution_end` (write/edit/…) | `result` with diff details | **`file_mutation`** (existing) *in addition* | When `toolName` ∈ {`write`,`edit`}: derive `op` (write→create/edit, edit→edit), `path`, and `linesAdded`/`linesRemoved` from the tool result details. See § Pitfall 4 — treat counts as best-effort; 0/0 if unavailable. |
| `auto_retry_start` | `attempt`, `maxAttempts`, `delayMs`, `errorMessage` | **`UnknownEvent`** (verbatim) | TEL-03: backoff time = Σ `delayMs` (or `auto_retry_end.ts − auto_retry_start.ts`). Preserves attribution without a new typed variant (D4-09). |
| `auto_retry_end` | `success`, `attempt`, `finalError?` | **`UnknownEvent`** (verbatim) | On `success:false` with a `finalError`, the run will terminate as `agent_error`. |
| `agent_end` | `messages`, `willRetry` | **(terminal handling)** | Signals the single prompt finished. Adapter then reconciles final cost via `getSessionStats()` and emits terminal `benchmark_finished`. |
| `turn_start`, `message_start`, `message_end`, `tool_execution_update`, `compaction_start/end`, `queue_update`, `thinking_level_changed`, `session_info_changed` | various | **`UnknownEvent`** (verbatim) | D4-09/D4-12: never dropped, promoted to typed only if a future metric needs it. |

**`argsSummary` for `tool_call`:** keep a `Map<toolCallId, args>` populated on `tool_execution_start`; on `tool_execution_end` build a one-line summary (e.g. the command for `bash`, the path for `read`/`write`/`edit`). Delete the map entry after use.

### Proposed new event shapes (extend `src/core/events.ts`)

Plain TS interfaces (events.ts uses no zod — it is a discriminated union keyed by `type`). Reuse branded units from `src/core/units.ts`.

```ts
// src/core/events.ts additions
import type { EpochMs, UsdCost } from "./units.js";

/** t0 anchor for the agent run (D4-10). Emitted once on the first Pi `agent_start`. */
export interface SessionStartedEvent extends BaseEvent {
  type: "session_started";
  provider: string;   // e.g. "deepseek"
  modelId: string;    // e.g. "deepseek-chat" (from models/*.json)
}

/** First streamed assistant text (D4-10). Emitted once. TTFT = ts − session_started.ts, folded in Phase 5. */
export interface FirstTokenEvent extends BaseEvent {
  type: "first_token";
}

/** Verbatim per-turn usage from pi-ai (D4-09/D4-15). One per Pi `turn_end`; also emitted for aborted turns. */
export interface UsageEvent extends BaseEvent {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** pi-ai reports these; kept verbatim, may be undefined depending on provider. */
  reasoningTokens?: number;
  totalTokens: number;
  /** Verbatim USD, never pre-rounded (D-26). Mirrors pi-ai Usage.cost.total. */
  costUsd: UsdCost;
  /** True when this usage came from an aborted/errored turn (D4-15). */
  aborted: boolean;
}
```
Add all three to the `AgentEvent` union. (`ts: EpochMs` and `runId`/`seq` come from `BaseEvent`; with D4-26, `seq` is stamped by storage, not the adapter.)

### AgentInput shape (D4-22)

Internal typed object the orchestrator builds — not a spec file, so plain TS (no zod). The *sources* of each field are zod-validated upstream (stack/scenario/model schemas + `copyWorkspace`).

```ts
// src/agent/types.ts
export interface AgentBudget {
  maxWallClockMs: DurationMs;  // from scenario.yaml budget.maxMinutes * 60_000
  maxCostUsd: UsdCost;         // from scenario.yaml budget.maxUsd
  maxTurns: number;            // from scenario.yaml budget.maxTurns
}

export interface AgentModelSpec {
  provider: string;            // models/*.json .provider  (D4-20)
  modelId: string;             // models/*.json .modelId
  thinkingLevel?: "off" | "low" | "medium" | "high"; // optional, from params
  temperature: number;         // D4-18 default 0 — see Open Question 1 re: SDK settability
}

export interface AgentInput {
  runId: string;
  workspacePath: string;       // copyWorkspace(...) → tmp/<runId>/angular/  (D4-23 cwd)
  promptText: string;          // scenario prompt verbatim (D4-04)
  preamble: string;            // stack.yaml grounding preamble (D4-05)
  mockupPng: Buffer;           // raw PNG bytes (D4-07)
  skillPaths: string[];        // committed skills/<name>/ dirs (D4-16)
  model: AgentModelSpec;
  budget: AgentBudget;
}
```

### Three-ceiling budget loop (D4-01/D4-02)

```ts
// Pseudocode inside runSession (async generator)
let turns = 0, tripped: "wall" | "usd" | "turns" | null = null;
const t0 = Date.now();
const wallTimer = setTimeout(() => { tripped ??= "wall"; void session.abort(); }, budget.maxWallClockMs);

// in the subscribe listener, after mapping a `turn_end`:
turns++;
const cost = session.getSessionStats().cost;         // cumulative USD, verified field
if (turns >= budget.maxTurns)      { tripped ??= "turns"; void session.abort(); }
else if (cost >= budget.maxCostUsd){ tripped ??= "usd";   void session.abort(); }

// after prompt() settles (or abort resolves):
clearTimeout(wallTimer);
const status = tripped ? "timeout" : (sawFatalError ? "agent_error" : "completed");
// emit terminal benchmark_finished; workspace files kept (D4-02); do NOT delete tmp/<runId>.
```
`session.abort()` returns a `Promise<void>` that resolves when the agent goes idle; the partial files the agent already wrote remain in `tmp/<runId>/angular/` for `runStack` (D4-21). All three ceilings map to `status: "timeout"` (D4-01, no new enum value).

### Retry policy (D4-14) — configure Pi, do not hand-roll

Pi's `AgentSession` has **built-in** auto-retry (`agent-session.d.ts`): `_isRetryableError` retries "overloaded, rate limit, server errors" and explicitly **excludes context-overflow** (handled by compaction) and, by omission, auth/invalid-request errors. It emits:
- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Configuration lives in `SettingsManager` `RetrySettings { enabled?, maxRetries?, baseDelayMs?, provider?: { maxRetries?, maxRetryDelayMs? } }` (verified in `settings-manager.d.ts`).

**Recommendation:**
- `enabled: true`, `maxRetries: 4`, `baseDelayMs: 1000` (exponential → ~1s, 2s, 4s, 8s; `maxRetryDelayMs` caps it). [ASSUMED — sensible default; tune after first live run.]
- Map `auto_retry_start/end` onto `UnknownEvent` (verbatim) so Phase 5 folds backoff time separately (TEL-03).
- After `maxRetries` transient failures, or on any non-transient error, Pi settles the run; the adapter detects the failing terminal (`auto_retry_end.success === false`, or a final assistant `stopReason: "error"`) and emits `benchmark_finished { status: "agent_error" }`.
- Non-transient (auth/invalid-request) → not retried → fast `agent_error`.

### D4-26 seq-ownership migration (concrete)

**Today:** `StoragePort.appendEvent(e: AgentEvent): void`; caller sets `e.seq`; `runStack` keeps `let seq = 0` and passes `seq: seq++` on every event (12 call sites). The test double (`tests/runStack.test.ts` `fakeStorage`) just pushes `e`.

**Change:**
1. `src/core/ports.ts`: `appendEvent(e: Omit<AgentEvent, "seq">): void;` (`Omit` distributes over the union — each variant loses `seq`). Optionally return the stamped event if a caller wants it back; `void` is enough.
2. Storage adapter (better-sqlite3): keep a per-run monotonic counter. Simplest correct approach for the single-writer/WAL DB: an in-process `Map<runId, number>` incremented on each append; or `INSERT … seq = (SELECT COALESCE(MAX(seq),-1)+1 FROM events WHERE run_id=?)`. Either keeps `seq` per-run monotonic (D-04) and collision-free when the agent adapter and `runStack` both append to one run's log.
   - **ponytail:** in-process `Map<runId,number>` counter — single-writer holds, upgrade to the SQL `MAX(seq)+1` only if a second writer process ever appears.
3. `src/pipeline/runStack.ts`: delete `let seq = 0`; remove every `seq: seq++` from the 12 event literals (they become `Omit<…,"seq">`). No other logic changes — append order is preserved (storage assigns in call order).
4. `tests/runStack.test.ts` `fakeStorage`: assign seq inside `appendEvent` (`e.seq = counter.get(e.runId) ...`) so `readEvents` still returns fully-formed events; add a monotonicity assertion (see Validation Architecture).

**Blast radius:** `ports.ts`, the SQLite storage adapter, `runStack.ts`, `fakeStorage` in tests. `events.ts` `BaseEvent.seq` stays `number` (it is present on *read*); only the *append* boundary drops it. Update the `BaseEvent.seq` doc comment to "storage-assigned, monotonic per run."

### Anti-Patterns to Avoid
- **Hand-rolling a retry/backoff loop** around `prompt()` — fights Pi's built-in retry and double-counts. Configure `RetrySettings` instead.
- **Awaiting `prompt()` before yielding events** — would buffer the whole run and violate D4-13 (live streaming). Bridge `subscribe` → queue and yield concurrently while `prompt()` runs.
- **Reading usage only from `agent_end`** — misses per-turn granularity (D4-11) and per-turn honesty on abort (D4-15). Emit `usage` on every `turn_end`.
- **Passing `DEEPSEEK_API_KEY` through `buildAllowlistedEnv`/the run subprocess** — D4-19 violation. The key lives only in the orchestrator's `AuthStorage`; the Phase-2 env allowlist already default-denies it (D2-04).
- **Trusting `cwd` alone for isolation** — Pi tools are cwd-*scoped* but not path-*jailed* (see Pitfall 1 + Security Domain).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transient-error retry + exp. backoff | Custom retry wrapper | Pi `RetrySettings` + `auto_retry_*` events | Pi already classifies retryable errors and backs off; a wrapper double-retries. |
| Cumulative cost tracking | Manual token→USD math | `session.getSessionStats().cost` + `Usage.cost.total` | Pi computes USD from each model's pricing metadata, verbatim (D-26). |
| Model→provider resolution & auth | Platform provider abstraction | `ModelRegistry.find()` + `AuthStorage` | D4-20; Pi resolves keys/headers per provider. |
| Skill discovery/parsing | Custom SKILL.md reader | `DefaultResourceLoader({ additionalSkillPaths })` / `loadSkillsFromDir` | Pi implements the Agent Skills standard (SKILL.md roots). |
| Process-tree teardown | New kill logic | `killProcessTree` from `src/runtime/stage.ts` (D4-24) | Already battle-tested in Phase 2. |
| Callback→async-iterator bridge | A library | ~20 lines: a push-queue + resolver (stdlib Promises) | Trivial; no dep warranted. **ponytail: this exists** as one small helper. |

**Key insight:** The adapter's entire value is *faithful translation*, not new machinery. Almost every hard problem (retry, cost, auth, skills, teardown) is already solved by Pi or Phase 2 — the phase is mostly a mapping function plus a ceiling monitor.

## Common Pitfalls

### Pitfall 1: cwd-scoping is not a jail (D4-23)
**What goes wrong:** `createAgentSession({ cwd })` scopes tool *relative* paths to the workspace, but the agent's `bash` tool can `cd ..`, use absolute paths, or write outside `tmp/<runId>/angular/`.
**Why it happens:** D4-23 assumes an "existing path-containment guard (D2-06)" — but Phase 2's isolation is *by construction* (`copyWorkspace` derives the path from fixed roots); there is **no runtime tool-path guard in `src/`** to reuse (verified: grep found none). Phase 2 never ran agent tools, so it never needed one.
**How to avoid:** For v1, layer the mitigations that *do* exist: disposable per-run workspace (WORK-01/02), Phase-2 env-strip on the eventual build subprocess (D2-04), and the wall-clock ceiling. For real containment, wrap the write/edit/bash tool operations (Pi exposes `createBashToolDefinition(cwd, { operations })`, `createEditToolDefinition`, etc. with injectable `BashOperations`/`EditOperations`) to reject any resolved path outside the workspace root — a small guard: `resolve(cwd, p).startsWith(cwd + sep)`. See Security Domain + Open Question 2.
**Warning signs:** files appearing under the repo root or `tmp/<runId>/` outside `angular/` after a run.

### Pitfall 2: Image content shape mismatch
**What goes wrong:** Using `{ source: { type:"base64", mediaType, data } }` (the Anthropic-native / CLAUDE.md shape) — Pi rejects/ignores it.
**Why it happens:** CLAUDE.md documents the wrong shape.
**How to avoid:** Use the flat pi-ai `ImageContent`: `{ type:"image", data: <base64>, mimeType:"image/png" }`. Confirmed in `pi-ai/dist/types.d.ts:236` and in the working `judgeEvaluator.ts`.
**Warning signs:** the agent behaves as if it never saw the mockup.

### Pitfall 3: Agent sampling temperature may not be SDK-settable (D4-18)
**What goes wrong:** You expect `temperature: 0` to flow through and it doesn't — `createAgentSession`/`prompt` expose no temperature knob.
**Why it happens:** `temperature` is a pi-ai `StreamOptions` field (`types.d.ts:45`), consumed inside the agent loop's stream call, but **not surfaced** through the coding-agent SDK's public options (verified: no `temperature` in any coding-agent `dist/*.d.ts`).
**How to avoid:** See Open Question 1. Options: (a) accept the provider/model default and document it; (b) register a custom model/provider via `ModelRegistry.registerProvider` with a `stream`/`streamSimple` wrapper that injects `temperature: 0`. For a max-reproducibility benchmark, flag this to the user before locking D4-18 as achievable.
**Warning signs:** non-deterministic agent output across identical runs.

### Pitfall 4: `file_mutation` line counts are best-effort
**What goes wrong:** Expecting exact `linesAdded`/`linesRemoved` on every mutation.
**Why it happens:** Counts come from the write/edit tool result *details* (`EditToolDetails`, diff-derived), whose exact fields we did not fully enumerate; `write` (whole-file create) has no diff.
**How to avoid:** Derive counts when present (edit diffs), else `0/0`; treat the `file_mutation` *event existence* + `path` as the load-bearing signal (correction density = repeated mutations on one path, D-05/D4-11). Phase 5 (TEL-04) owns precise line accounting.
**Warning signs:** correction-density metric always zero.

### Pitfall 5: Usage on abort must be reconciled
**What goes wrong:** Aborting mid-turn may skip the `turn_end` that would have carried that turn's `usage`, undercounting cost.
**Why it happens:** `abort()` interrupts the loop; whether a final `turn_end`/`message_end` fires for the interrupted turn is not guaranteed by the types.
**How to avoid:** Belt-and-suspenders — emit `usage` per `turn_end` *and*, at teardown, read `session.getSessionStats()` (cumulative `tokens` + `cost`) as the authoritative total; if it exceeds the sum of emitted `usage` events, emit one final reconciling `usage` event with `aborted: true` for the delta (D4-15: no paid tokens unrecorded).
**Warning signs:** `Σ usage.costUsd` < `getSessionStats().cost` after a capped run.

## Code Examples

### The callback→async-iterator bridge (D4-13)
```ts
// Source pattern: standard push-queue over Promises (no dep). // ponytail: this exists
function eventBridge() {
  const queue: AgentEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  return {
    push(e: AgentEvent) { queue.push(e); resolveNext?.(); resolveNext = null; },
    finish() { done = true; resolveNext?.(); resolveNext = null; },
    async *stream(): AsyncIterable<AgentEvent> {
      while (!done || queue.length) {
        if (!queue.length) { await new Promise<void>((r) => (resolveNext = r)); continue; }
        yield queue.shift()!;
      }
    },
  };
}
```

### Skills (D4-16) — verified loader path
```ts
// Source: package/dist/core/resource-loader.d.ts (DefaultResourceLoaderOptions.additionalSkillPaths)
//         + package/dist/core/skills.d.ts (loadSkillsFromDir discovery: dir with SKILL.md = root)
const loader = new DefaultResourceLoader({
  cwd: input.workspacePath,
  agentDir,
  additionalSkillPaths: input.skillPaths, // ["skills/angular-helper", ...] committed dirs
  noContextFiles: true,
});
await loader.reload();
const { skills, diagnostics } = loader.getSkills(); // assert diagnostics has no errors
```

## State of the Art — CLAUDE.md corrections

| CLAUDE.md claim | Reality (verified) | Impact |
|-----------------|--------------------|--------|
| `session.prompt(text, { images: [{ type, source: { type:"base64", mediaType, data } }] })` | Flat `ImageContent`: `{ type:"image", data:<base64>, mimeType:"image/png" }` | **Correction** — wrong image shape would break AGENT-02. |
| Skills via `new DefaultResourceLoader({ skillsOverride })` | Skill *paths* go in `additionalSkillPaths: string[]`; `skillsOverride` is a `(base)=>{skills,diagnostics}` transform fn, not a path list. Loader also requires `cwd` + `agentDir`. | **Correction** — D4-16 uses `additionalSkillPaths`. |
| `createAgentSession({ sessionManager, authStorage, modelRegistry })` (3 fields) | All optional; real useful set adds `cwd` (isolation), `model`, `resourceLoader`, `thinkingLevel`. Canonical README example uses `{ sessionManager, authStorage, modelRegistry }` but omits `cwd`/`model`. | **Extension** — must pass `cwd` for D4-23 and `model` for D4-20. |
| `getModel(provider, id)` + `session.setModel()` | `ModelRegistry.find(provider, modelId): Model<Api>` for the coding-agent; pass as `createAgentSession({ model })`. pi-ai's `getModel`/`Models.getModel` is the separate judge path. `session.setModel(model)` exists for mid-session switch (not needed — single prompt). | **Clarification.** |
| `AssistantMessage.usage.{input,output,cacheRead,cacheWrite,cost.total}` present on aborted turns | ✅ Verified exactly, plus `cacheWrite1h?`, `reasoning?`, `totalTokens`. `stopReason: "aborted"` still carries `usage`. | **Confirmed.** |
| Event names `tool_execution_start/end`, `message_update text_delta`, `agent_end` | ✅ All present. Full union also has `agent_start`, `turn_start/end`, `message_start/end`, `tool_execution_update`, plus session-level `auto_retry_start/end`, `compaction_*`, `queue_update`. | **Confirmed + enumerated.** |
| Retry is our job (D4-14) | Pi has **built-in** retry (`RetrySettings`, `auto_retry_*` events). | **Major simplification.** |
| Provider key env var | `DEEPSEEK_API_KEY` (verified in pi-ai `env-api-keys.js`). | **Resolved (D4-19).** |

**Deprecated/outdated:** `@mariozechner/pi-coding-agent` (use `@earendil-works/*`) — CLAUDE.md already correct.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Retry defaults `maxRetries: 4`, `baseDelayMs: 1000` (exp backoff) | Retry policy | Too few retries → spurious `agent_error` on transient 429s; too many → longer/pricier capped runs. Tune after first live run. |
| A2 | Default ceilings `maxMinutes: 20`, `maxUsd: 5.00`, `maxTurns: 50` | Default ceilings | Too tight → most runs cap (still a scored point, but less signal); too loose → expensive runaway before wall-clock. |
| A3 | `first_token` best detected on first `message_update` with `assistantMessageEvent.type === "text_start"` | Event mapping | If DeepSeek streams thinking before text, TTFT measures first *visible* text, not first thinking token — acceptable per D4-10 ("streams assistant text"). |
| A4 | Agent `temperature` is not settable via the public SDK in 0.80.3 | Pitfall 3 / OQ1 | If wrong (a hidden knob exists), D4-18 is trivially satisfied; if right, needs the custom-stream workaround or user sign-off. |
| A5 | DeepSeek 4 Pro's provider id is `"deepseek"` and it is vision-capable | multiple | If the model can't accept images, AGENT-02's mockup injection fails — verify the exact `models/deepseek4pro.json` provider/modelId + `input: [...,"image"]` before the live row. |
| A6 | `file_mutation` line counts derivable from edit tool details | Pitfall 4 | Only correction-density precision affected (Phase 5); event/path signal still holds. |

## Open Questions

1. **Agent sampling temperature (D4-18).**
   - What we know: `temperature` is a pi-ai `StreamOptions` field but is not exposed by `createAgentSession`/`prompt` in 0.80.3.
   - What's unclear: whether a model-config/compat field or a `registerProvider` stream wrapper can pin it cleanly.
   - Recommendation: plan a small spike task — try `ModelRegistry.registerProvider({ ..., streamSimple })` wrapping the DeepSeek stream to inject `temperature: 0`; if that's heavy, accept the provider default for v1 and get user sign-off (flag: reproducibility slightly weaker than the judge's hard temp=0).

2. **True path-containment (D4-23).**
   - What we know: no runtime guard exists in `src/`; cwd only scopes relative paths.
   - What's unclear: whether v1 accepts cwd-scoping + disposable-workspace as "contained enough," or wants the tool-operation wrappers now.
   - Recommendation: implement a minimal `resolve(cwd,p).startsWith(cwd+sep)` guard by injecting custom `BashOperations`/`EditOperations`/`WriteOperations` into the tool definitions; if that proves large, ship the by-construction mitigation for v1 and file the wrapper as a hardening task (matches D2-06's "verified, not trusted" intent).

3. **DeepSeek model spec exactness (A5).**
   - Recommendation: confirm `models/deepseek4pro.json` `{ provider, modelId }` resolves via `ModelRegistry.find` and that the model advertises image input, before the first paid row.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@earendil-works/pi-coding-agent` | AGENT-01..05 | ✗ (install task) | 0.80.3 (target) | none — blocking; `npm install` is a Phase-4 task |
| `@earendil-works/pi-ai` | usage/cost, image type | ✓ | 0.80.3 | — |
| `DEEPSEEK_API_KEY` env var | live agent run (AGENT-02) | ✗ (user-supplied at run time) | — | Tests use `fauxProvider()` — no key needed for CI (see Validation Architecture) |
| Node.js | runtime | ✓ | ≥24 (project engine) | — |

**Missing with no fallback (blocking):** `@earendil-works/pi-coding-agent` — resolved by the install task. A live paid run additionally needs `DEEPSEEK_API_KEY`, but **no phase-4 test requires it** (all validatable via test doubles).

## Validation Architecture

The core validation risk this phase introduces is **non-determinism + paid I/O**: the agent's behavior varies run-to-run and every real turn costs money. Every phase-4 behavior below is made validatable **without a live paid run**, using a fake Pi session / `fauxProvider()` (the pattern already established in `tests/registry.test.ts`) and a fake `StoragePort` (`tests/runStack.test.ts`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 (installed) |
| Config file | `vitest.config.ts` (excludes `*.integration`, `*.selftest`, `*.live` from the default run) |
| Quick run command | `npx vitest run tests/agentAdapter.test.ts` |
| Full suite command | `npm test` (`vitest run`) |
| Typecheck gate | `npm run typecheck` (`tsc --noEmit`) |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | File |
|-----|----------|-----------|-------------------|------|
| AGENT-04 | `mapEvent` translates each Pi event `type` to the right `AgentEvent` (table-driven over the full union) | unit | `npx vitest run tests/mapEvent.test.ts` | ❌ Wave 0 |
| AGENT-04/D4-09 | Unrecognized Pi events → `UnknownEvent` with `piType` + raw payload preserved | unit | same | ❌ Wave 0 |
| AGENT-04/D4-10 | `first_token` emitted exactly once, on first `text_start`; TTFT derivable = `first_token.ts − session_started.ts` | unit | same | ❌ Wave 0 |
| AGENT-05/D4-11 | One `usage` event per `turn_end`; iteration count = count of `usage` events | unit | same | ❌ Wave 0 |
| AGENT-05/D4-15 | Usage captured on an **aborted** turn: feed a fake session whose final message has `stopReason:"aborted"` + `usage`; assert a `usage{aborted:true}` event and `Σcost == getSessionStats().cost` | unit (fake session, **no network**) | `npx vitest run tests/agentAbortUsage.test.ts` | ❌ Wave 0 |
| AGENT-01/D4-01 | First-to-trip ceiling: three deterministic fake sessions (fast turns exceeding maxTurns; a stats.cost over maxUsd; a hung turn vs a short wall-clock) each abort with `status:"timeout"` and keep workspace | unit (fake session + fake timers) | `npx vitest run tests/agentCeilings.test.ts` | ❌ Wave 0 |
| D4-14 | `auto_retry_start/end` → `UnknownEvent` verbatim (delayMs preserved for TEL-03) | unit | `tests/mapEvent.test.ts` | ❌ Wave 0 |
| D4-23 | Path-containment self-test: a tool op resolving outside `cwd` is rejected (if the guard is implemented per OQ2) | selftest | `npx vitest run tests/agentContainment.selftest.test.ts` | ❌ Wave 0 (conditional on OQ2) |
| D4-26 | `StoragePort.appendEvent` stamps monotonic, gap-free, collision-free per-run `seq` when two writers append interleaved | unit | `npx vitest run tests/seqOwnership.test.ts` | ❌ Wave 0 |
| AGENT-02 | Prompt assembled as `preamble + prompt` with one `image/png` `ImageContent` (flat shape); mockup bytes unmodified | unit (spy on fake `session.prompt`) | `npx vitest run tests/agentPrompt.test.ts` | ❌ Wave 0 |
| AGENT-01 | Only `src/agent/**` imports `@earendil-works/pi-coding-agent` (grep guard) | unit/lint | `npx vitest run tests/importBoundary.test.ts` | ❌ Wave 0 |

**Fake Pi session design (the key enabler):** since `AgentSession` is a class, tests inject a hand-rolled `FakeSession` implementing the *subset the adapter calls* — `subscribe(listener)`, `prompt()`, `abort()`, `getSessionStats()`, `dispose()`. The test drives it by invoking the captured listener with scripted `AgentSessionEvent`s (including `stopReason:"aborted"` messages and `auto_retry_*`), so every non-deterministic/paid path is exercised deterministically with **zero network and zero cost** (SC-parallel to the judge's `fauxProvider()` "no agent, no network" checkpoint). The adapter must therefore depend on Pi via a narrow internal factory function (e.g. `createSession(input) => SessionLike`) that tests can substitute — keep the concrete `createAgentSession` call behind that seam.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/<the-touched>.test.ts` (< 5s, no network).
- **Per wave merge:** `npm test` (full unit suite; integration/live excluded by config).
- **Phase gate:** `npm test` green + `npm run typecheck` clean before `/gsd-verify-work`. A single opt-in `tests/agentLive.live.test.ts` (needs `DEEPSEEK_API_KEY`, excluded by default) can smoke one real turn manually — never in CI.

### Wave 0 Gaps
- [ ] `tests/_fakes/fakeSession.ts` — scriptable `SessionLike` test double (shared fixture)
- [ ] `tests/mapEvent.test.ts` — table-driven event mapping incl. `UnknownEvent` + `auto_retry_*`
- [ ] `tests/agentAbortUsage.test.ts` — D4-15 aborted-turn usage honesty
- [ ] `tests/agentCeilings.test.ts` — D4-01 first-to-trip (uses `vi.useFakeTimers()`)
- [ ] `tests/seqOwnership.test.ts` — D4-26 monotonic/no-collision under interleaved writers
- [ ] `tests/agentPrompt.test.ts` — AGENT-02 prompt+image assembly (flat `ImageContent`)
- [ ] `tests/importBoundary.test.ts` — AGENT-01 single-importer guard
- [ ] (conditional) `tests/agentContainment.selftest.test.ts` — D4-23 path guard, if OQ2 implemented
- [ ] Adapter seam: narrow `createSession` factory so the fake substitutes cleanly

## Security Domain

`security_enforcement: true`, ASVS level 1. This phase runs LLM-driven, semi-untrusted tool calls (`bash`, `write`, `edit`) with a real provider secret in process memory.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V5 Input Validation (path handling) | **yes** | Path-containment guard on tool file ops: `resolve(cwd,p).startsWith(cwd+sep)` (OQ2 / Pitfall 1). The agent's own output is untrusted input to the filesystem. |
| V6 Cryptography | no | No crypto in this phase. |
| V7 Error handling / logging | yes | Never log `DEEPSEEK_API_KEY`; `usage`/error events carry no secret. Assistant narration is persisted verbatim (D4-12) — ensure the key can't appear in it (it never enters the prompt/context). |
| V8 Data protection | **yes** | Secret lifecycle: env → `AuthStorage.setRuntimeApiKey` (in-memory) → never written to specs/manifest/fingerprint/artifacts (D4-19). Use `InMemoryAuthStorageBackend`, not the file backend, to guarantee no `auth.json` on disk. |
| V12 Files & resources | **yes** | Disposable per-run workspace (WORK-01/02); teardown kills spawned children (D4-24). Agent-spawned dev servers/npm must not orphan. |
| V14 Config | yes | Provider key comes only from env at run time; not in committed config. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent writes/reads outside the workspace (path traversal via `bash`/`write`/`edit`) | Tampering / Info-disclosure | Path-containment guard on tool ops (OQ2); disposable workspace; env-strip on downstream build (D2-04). |
| Provider API key leaks into artifacts/logs/subprocess env | Info-disclosure | In-memory `AuthStorage`; key never joins `buildAllowlistedEnv`; never in manifest/fingerprint (D4-19). Add a test asserting the persisted event log + manifest contain no `DEEPSEEK_API_KEY`. |
| Orphaned dev-server process / held port after a capped run | Denial-of-service (next run) | `session.abort()` + `killProcessTree` on every exit path (D4-24), mirroring `runStack`'s guaranteed-once teardown `finally`. |
| Runaway paid loop (cost/time) | Resource exhaustion | Three-ceiling first-to-trip abort (D4-01); Pi bounded retry (D4-14). |
| Malicious/compromised skill content executing code | Tampering / Elevation | D4-16 skills are committed repo dirs, in the input fingerprint (auditable, reviewed) — not fetched at run time. |

## Sources

### Primary (HIGH confidence — read directly this session)
- `@earendil-works/pi-coding-agent@0.80.3` npm tarball `dist/*.d.ts` — `core/sdk.d.ts` (`CreateAgentSessionOptions`, `createAgentSession`), `core/agent-session.d.ts` (`AgentSession`, `PromptOptions`, `AgentSessionEvent`, `subscribe`, `abort`, `getSessionStats`, `setModel`), `core/model-registry.d.ts` (`ModelRegistry.find/create`), `core/resource-loader.d.ts` (`DefaultResourceLoader`, `additionalSkillPaths`), `core/skills.d.ts` (`Skill`, `loadSkillsFromDir`), `core/settings-manager.d.ts` (`RetrySettings`), `core/session-manager.d.ts` (`SessionManager.inMemory`), `core/auth-storage.d.ts` (`AuthStorage`, `setRuntimeApiKey`), `README.md` SDK example.
- `@earendil-works/pi-agent-core@0.80.3` tarball `dist/types.d.ts:360` — the core `AgentEvent` union (full enumeration).
- `@earendil-works/pi-ai@0.80.3` (installed) `dist/types.d.ts` — `ImageContent:236`, `Usage:248` (`cost.total`), `AssistantMessage:276`, `AssistantMessageEvent` subtypes (`text_start`/`text_delta`/…), `StreamOptions.temperature:45`; `dist/env-api-keys.js:73` (`deepseek → DEEPSEEK_API_KEY`).
- npm registry: `version`, `dist-tags.latest`, `time.modified`, `scripts` (no postinstall), `repository.url`.
- Repo code read: `src/core/{ports,events,units}.ts`, `src/pipeline/runStack.ts`, `src/workspace/{copy,teardown}.ts`, `src/specs/schema.ts`, `src/eval/judgeEvaluator.ts`, `tests/{runStack,registry}.test.ts`, `vitest.config.ts`.

### Secondary (MEDIUM confidence)
- `package/docs/rpc.md`, `docs/skills.md` (skim) — RPC alternative + skill discovery rules.

### Tertiary (LOW / ASSUMED)
- Default ceiling values, retry tuning, temperature-workaround feasibility — see Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions and API read from the actual published packages.
- Architecture / event mapping: HIGH — full event union enumerated from source; mapping is a direct translation.
- Retry / usage / auth: HIGH — verified fields (`RetrySettings`, `Usage.cost`, `getSessionStats`, `DEEPSEEK_API_KEY`).
- Temperature (D4-18) + path-containment (D4-23): MEDIUM/LOW — genuine gaps flagged as Open Questions.
- Default ceilings / retry tuning: LOW (ASSUMED) — need one live run to calibrate.

**Research date:** 2026-07-02
**Valid until:** 2026-07-16 (Pi is fast-moving; re-verify the SDK surface if the pinned version changes).
