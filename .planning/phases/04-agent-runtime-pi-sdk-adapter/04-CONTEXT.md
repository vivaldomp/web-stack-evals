# Phase 4: Agent Runtime (Pi SDK adapter) - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Drive the Pi SDK behind the single `AgentPort.runSession()` seam so a session builds the app from **prompt + skills + mockup image** in the disposable workspace, and every Pi event + usage figure is normalized into the canonical `AgentEvent` stream and appended to the append-only log. The agent is the only new variable atop the already-proven pipeline (Phases 1–3).

**Requirements in scope:** AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05.

This phase clarifies HOW the adapter behaves. It does **not** build/serve/render (that's Phase 2's `runStack`, authoritative) and does **not** wire the row end-to-end or fold metrics (Phase 5). No MCP for the v1 row (AGENT-03) — Pi native tools only.

**Prerequisite (not a decision):** `@earendil-works/pi-coding-agent@0.80.3` is not yet installed (only `pi-ai` is). Adding it is a Phase 4 task.
</domain>

<decisions>
## Implementation Decisions

### Run Budget & Stop Condition (AGENT-05, bounds cost)
- **D4-01:** A session is bounded by **three ceilings — wall-clock, cumulative USD cost, and turn count — first-to-trip aborts.** All three map to the existing D-19 `timeout` status (no new status enum value).
- **D4-02:** On ceiling hit, **abort but keep partial work** — the files the agent already wrote survive so Phase 5 still builds/renders/scores the partial app. A capped run is a scored data point, not a discarded failure. Emits terminal `benchmark_finished` with `status: "timeout"`.
- **D4-03:** The three ceiling values (max minutes / max USD / max turns) are **declared in `scenario.yaml`** — budget is a property of the benchmarked task, so every model/stack facing that scenario gets identical caps (fair comparison). Extends declarative-first (D-07).

### Prompt Assembly (AGENT-02, benchmark fairness)
- **D4-04:** The scenario **prompt text + mockup image go in verbatim** (the benchmarked variable, untouched). The platform adds only a **thin environmental preamble** grounding the agent in the workspace/stack — nothing that editorializes the task.
- **D4-05:** That preamble is **stack-authored, a field on `stack.yaml`** (each stack describes itself: "an Angular skeleton is here, run `npm run build`"). Declarative (D-07); a new stack ships its own grounding.
- **D4-06:** The agent sees the **mockup only — never the expected screenshot.** The expected screenshot is evaluation-only; showing it would leak the answer key into the benchmark.
- **D4-07:** The mockup is passed as **base64 PNG verbatim** (`mediaType: image/png` via Pi `PromptOptions.images`) — no resize/re-encode; the bytes are already in the D-10 fingerprint.
- **D4-08:** **Single prompt, then run to natural completion (`agent_end`)**, bounded only by the D4-01 ceilings. **No platform mid-course steering** (no "the build failed, fix it" follow-ups) — every model faces identical conditions.

### Event Mapping (AGENT-04, TTFT)
- **D4-09:** **Minimal new typed `AgentEvent` variants** — add only what requirements force: a `session_started` (t0 anchor) and a **per-turn `usage` event** (verbatim input/output/cache-read/cache-write tokens + cost). Everything else Pi emits rides the D-02 `UnknownEvent` passthrough, promoted to typed later only if a metric needs it.
- **D4-10:** **TTFT is made foldable via a lightweight first-token event** — emitted once, the first time Pi streams assistant text (`message_update` `text_delta`). `TTFT = firstToken.ts − session_started.ts`, folded at projection time (TEL-02, never inline). One marker, not one-per-delta.
- **D4-11:** **One iteration = one Pi agent turn** (a single LLM invocation + its tool round) = exactly what the per-turn `usage` event marks. TEL-05 iteration count folds as the count of `usage` events; correction density folds from repeated `file_mutation`s on the same path (D-05). One consistent granularity.
- **D4-12:** **Assistant narration/reasoning text is persisted in full, verbatim** (in the `UnknownEvent` raw payload) — feeds the Phase 5 HTML report's agent-narration view and post-mortem debugging. Log size is fine for a single v1 row.
- **D4-13:** **Events stream live** — the adapter yields each `AgentEvent` the moment it occurs; the orchestrator appends immediately. A crash mid-run still leaves a faithful partial log (append-only-as-truth, D-16). Honors the `AsyncIterable<AgentEvent>` contract.

### Failure Handling (AGENT-05, TEL-03)
- **D4-14:** **Transient Pi failures (429 / 5xx) retry with exponential backoff**, emitting events so backoff time is attributable separately (TEL-03). After a **bounded** retry count, give up as `agent_error`. **Non-transient errors** (auth, invalid request) fail fast as `agent_error`.
- **D4-15:** **Per-turn usage is captured even on aborted/errored turns** — emit the `usage` event with whatever tokens/cost Pi attributes to a partial turn (Pi reports usage on aborted turns). No paid tokens go unrecorded; cost accounting stays honest.

### Skills & Model/Auth Config
- **D4-16:** Skills are **scenario-declared as a list of paths in `scenario.yaml`** pointing at a **committed repo `skills/<name>/` dir**, loaded via Pi's `DefaultResourceLoader` `skillsOverride`. Skill files are already part of the D-10 input fingerprint — declarative + reproducible + auditable.
- **D4-17:** **All model config comes from `models/*.json`** (provider, id, `thinkingLevel`, params) via the existing zod model loader. Swapping models is a spec edit, no code change.
- **D4-18:** **Agent sampling temperature is a model-spec field, defaulting to 0** for the v1 row (max reproducibility, matches the Phase-3 judge), overridable per scenario/model. Reproducibility-first, still flexible.
- **D4-19:** The **provider API key comes from an env var**, read (via Pi `authStorage`) **in the orchestrator process only**. It is never passed into the stripped run-subprocess env (D2-04), never written to specs/manifest/fingerprint. Secrets stay out of persisted artifacts.
- **D4-20:** **Provider selection uses Pi's own `getModel(provider, id)`** from the model spec — no platform-side provider abstraction over Pi (zero v1 payoff).

### Build Boundary & Adapter Shape
- **D4-21:** **The agent may run `npm build`/`lint` via its native bash tool to self-correct** its own work (captured as `tool_call` events, D-03). Phase 2's `runStack` remains the **authoritative** build/serve/screenshot on the final workspace. Mirrors how a real dev works → better output; the platform's score still comes from the authoritative build.
- **D4-22:** **The orchestrator hands the adapter one fully-resolved typed `AgentInput`** (workspace path from `copyWorkspace`, prompt text, image bytes, skill paths, model, budget); the adapter just drives Pi and streams events. Keeps the adapter a **pure, swappable `AgentPort`** (D-23) — it does not reach into spec loaders itself.

### Isolation & Teardown
- **D4-23:** **The agent is cwd-locked to `tmp/<run_id>/angular/` AND path-contained** — the adapter reuses the existing path-containment guard (D2-06) to reject any tool path resolving outside the workspace root. Isolation is verified, not trusted; the agent cannot mutate the main project.
- **D4-24:** **Teardown = abort the Pi session (AbortController) + process-tree-kill** any children the agent spawned (dev server, hung npm), reusing Phase 2's execa teardown. No orphaned process or held port survives a run — capped or clean.
- **D4-25:** **No custom per-tool-call timeout in v1** — rely on Pi's built-in tool timeouts plus the overall wall-clock ceiling (D4-01). A hung command still dies when wall-clock trips.

### Contract Change Required (flag for planner)
- **D4-26:** **Seq ownership moves into `StoragePort.appendEvent()`** — it stamps the next per-run monotonic `seq` atomically, so the agent adapter and `runStack` never coordinate or collide when both append to one run's log. **This revisits the Phase-1 contract:** today `BaseEvent.seq` is caller-set and `src/pipeline/runStack.ts` maintains its own `let seq = 0`. The planner must update the `StoragePort` interface (`src/core/ports.ts`), the storage adapter, and migrate `runStack` off its local counter — keeping `seq` per-run monotonic (D-04).

### Claude's Discretion
Left to research/planner — no user preference expressed:
- Exact `AgentInput` / `usage` / `first_token` / `session_started` zod + TS shapes and field names.
- Retry count, backoff curve, and the transient-vs-non-transient error classification for Pi errors.
- Exact `getModel` / `createAgentSession` / `session.prompt` / `subscribe` call wiring and which Pi events map to which typed variant.
- Default ceiling values baked into the `scenario.yaml` schema (and their generous fallbacks).
- The exact env-var name for the provider key.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Vision & Scope (source of truth)
- `PRODUCT.md` (repo root) — full framework vision; the telemetry event list (`SessionStarted → PromptSent → ToolExecuted → FileWritten → Build* → ScreenshotTaken → *Completed → BenchmarkFinished`) and the v1 row (Angular + DeepSeek 4 Pro + dashboard). All artifacts in English despite the Portuguese doc.
- `.planning/PROJECT.md` — core value (reproducible/comparable/measurable), constraints (Pi SDK is the only path to the agent, fully encapsulated), Key Decisions table.
- `.planning/REQUIREMENTS.md` — Phase 4 owns AGENT-01..05; TEL-03/05/06 (Phase 5) consume this phase's event stream, so the log must make them foldable.
- `.planning/ROADMAP.md` §"Phase 4" — phase goal + the success criteria this phase must make TRUE.

### Locked Tech Stack & Pi SDK API (do NOT re-decide)
- `.claude/CLAUDE.md` — pinned stack + the confirmed Pi SDK API surface the adapter needs: `createAgentSession({ sessionManager, authStorage, modelRegistry })`, `session.prompt(text, { images: [{ type, source: { type: "base64", mediaType, data } }] })`, `DefaultResourceLoader({ skillsOverride })` + `loader.reload()`/`getSkills()`, `getModel(provider, id)` + `session.setModel()`, `session.subscribe(event => …)` (`tool_execution_start/end`, `message_update` `text_delta`, `agent_end`), and `AssistantMessage.usage.{input,output,cacheRead,cacheWrite,cost.total}` (present even on aborted turns). Also the **"Pi has no native MCP"** caveat (why AGENT-03 is native-tools-only) and the `@mariozechner/*` deprecation (use `@earendil-works/*`).

### Prior-phase contracts this phase folds into
- `.planning/phases/01-foundations-contracts/01-CONTEXT.md` — D-01/02 (union + `UnknownEvent` passthrough), D-03/04/05 (tool-call / seq+ts / file-mutation events), D-10 (fingerprint over asset bytes incl. skills), D-19 (`status` enum + `failed_stage`), D-22 (`run_id` reuse), D-23 (ports isolate Pi), D-24 (event log → projections), D-26 (units: epoch-ms, ms durations, USD verbatim).
- `.planning/phases/02-workspace-build-serve-runtime/02-CONTEXT.md` — D2-01 (template copied fresh into `tmp/<run_id>/angular/`), D2-04 (env allowlist / default-deny), D2-06 (path-containment isolation self-test), D2-09 (execa process-tree teardown) — reused by D4-23/D4-24.

### Code the adapter integrates with
- `src/core/ports.ts` — `AgentPort` (implement), `StoragePort` (**D4-26 changes `appendEvent` to own `seq`**).
- `src/core/events.ts` — `AgentEvent` union (add `session_started`, `usage`, `first_token` per D4-09/10) + `BaseEvent` (`seq` becomes storage-assigned per D4-26).
- `src/core/units.ts` — `EpochMs` / `DurationMs` / `UsdCost` for the new events.
- `src/pipeline/runStack.ts` — its `let seq = 0` migrates to storage-assigned seq (D4-26); Phase 5 wires agent→runStack ordering.
- `src/workspace/copy.ts` (`copyWorkspace`) + `src/workspace/teardown.ts` — workspace path source (D4-22) + teardown reuse (D4-24).

No external ADRs exist — the decisions above ARE the Phase 4 contract record.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/ports.ts::AgentPort` — the seam to implement; `runSession(input): AsyncIterable<AgentEvent>` already exists (input `unknown` → typed `AgentInput` per D4-22).
- `src/core/events.ts` — the `AgentEvent` union + `UnknownEvent` passthrough already built for exactly this (D-02); extend minimally (D4-09/10).
- `src/workspace/copy.ts` / `teardown.ts` — workspace dir + process-tree kill reused verbatim (D4-22/24).
- `@earendil-works/pi-ai@0.80.3` already installed (used by the judge) — same LLM layer supplies `usage`/`cost`; the coding-agent package is the only new dep.

### Established Patterns
- Ports-and-adapters (D-23): only this module imports the Pi coding-agent SDK — structurally enforces AGENT-01.
- Append-only event log → projections (D-16/D-24): the adapter's job ends at emitting faithful events; metrics are Phase 5's fold.
- Declarative-first (D-07): budget (D4-03), preamble (D4-05), skills (D4-16), model+temp (D4-17/18) are all spec fields — no core change to add a stack/model/scenario.

### Integration Points
- Phase 5 wires `runSession` output → event log → `runStack` build → evaluate → score. The agent runs, mutates `tmp/<run_id>/angular/`, then `runStack` builds that mutated workspace (authoritative, D4-21).
</code_context>

<specifics>
## Specific Ideas

- v1 row fixed: **Angular template @ 4200 + DeepSeek 4 Pro (`models/deepseek4pro.json`) + "dashboard" scenario**, mockup-only to the agent (D4-06), temp 0 (D4-18).
- The `usage` event should carry Pi's figures **verbatim** — never pre-rounded (D-26) — so cost accounting is byte-honest even on capped/aborted runs (D4-15).
</specifics>

<deferred>
## Deferred Ideas

- **MCP injection** — scenario.yaml `mcps:` is out for the v1 row (AGENT-03: native tools only; Pi has no native MCP per CLAUDE.md). Revisit only if a scenario truly needs an external MCP (v2, via `pi-mcp-adapter` spike).
- **Custom per-tool-call timeout** (D4-25) — deferred; wall-clock ceiling suffices for v1.
- **Platform steering / follow-up prompts** (D4-08) — deliberately excluded to keep the benchmark fair; not a future feature, a permanent design stance.
- Matrix breadth, Docker isolation, concurrent-row `get-port` — remain v2 (already Out of Scope in REQUIREMENTS.md).
</deferred>

---

*Phase: 4-Agent Runtime (Pi SDK adapter)*
*Context gathered: 2026-07-02*
