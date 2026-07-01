# Architecture Research

**Domain:** Automated benchmark/eval harness for AI coding agents (headless pipeline, not a user-facing app)
**Researched:** 2026-07-01
**Confidence:** HIGH (architectural patterns are foundational and reasoned directly from the vision + requirements) · MEDIUM (Pi SDK event shapes and exact SQLite columns firm up during their own phases)

## Verdict on the Proposed 5-Domain Split

The proposed split is **sound — keep it**, with three refinements:

1. **Split "Workspace Runtime" from "Build/Serve Runtime."** The vision diagram folds them, but the vision's own folder layout already separates `src/sandbox/` (dir lifecycle) from `src/runtime/` (npm/docker/playwright process execution). They are different concerns: one owns *a disposable directory*, the other owns *processes that run inside it*. Keep them as sibling modules behind separate interfaces.
2. **Treat telemetry as a cross-cutting spine, not a downstream box.** Events are emitted by *every* runtime (agent, build, eval), not produced at the end. The collector is a bus everything writes to; the metrics tables are *projections* derived from the event log. This is the load-bearing insight of the whole design (see Pattern 3).
3. **Add an explicit contracts/ports module.** Give the interfaces (`AgentPort`, `BuildRuntime`, `Evaluator`, `Store`) a home so the dependency direction is visible and enforceable. This is what makes "swap any component without touching the core" true rather than aspirational.

Net result: the core (Orchestrator + Metrics) depends only on abstract ports. Stacks and scenarios are **pure data** (no code). Evaluators are **code behind one interface**. Models are **config behind one adapter**. That is the entire extensibility story.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLI / API              (src/cli)  — thin: parse args, call core       │
├──────────────────────────────────────────────────────────────────────┤
│  Evaluation Orchestrator  (src/orchestrator)                           │
│  owns the run state machine · coordinates domains · knows NO stack,    │
│  model, or evaluator specifics — only ports + declarative specs        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Agent        │  │ Workspace    │  │ Build/Serve  │  │ Evaluation│  │
│  │ Runtime      │  │ Runtime      │  │ Runtime      │  │ Runtime   │  │
│  │ (Pi SDK      │  │ (temp dir    │  │ (npm/serve/  │  │ (pixel/dom│  │
│  │  adapter)    │  │  lifecycle)  │  │  playwright) │  │ /a11y/judge)│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                 │                │        │
│         └───────── all emit events ─────────┴────────────────┘        │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Telemetry Collector  (src/telemetry) — append-only event bus     │ │  ← cross-cutting spine
│  └─────────────────────────────────────────────────────────────────┘ │
│                              │                                         │
│                    ┌─────────┴──────────┐                             │
│                    ▼                    ▼                             │
│         Metrics Projector        (derived read-models)               │
│         folds events → metrics / tool_calls / iterations             │
├──────────────────────────────────────────────────────────────────────┤
│  Storage (src/storage)                                                 │
│  ┌────────────────────┐   ┌───────────────────────────────────────┐  │
│  │ SQLite (structured)│   │ Artifact Store (disk: results/, tmp/) │  │
│  │ runs · events ·    │   │ screenshots · logs · generated code · │  │
│  │ metrics · ...      │   │ build output                          │  │
│  └────────────────────┘   └───────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  Reports (src/reports) — read SQLite → CLI summary + HTML             │
└──────────────────────────────────────────────────────────────────────┘

Declarative inputs (data, not code):  stacks/*/stack.yaml · assets/datasets/*scenario.yaml · models/*.json
```

### Component Responsibilities

| Component | Owns | Must NOT know about |
|-----------|------|---------------------|
| CLI/API | Arg parsing, invoking the orchestrator, printing summary | How anything actually runs |
| Orchestrator | Run lifecycle state machine; sequencing domains for a row; matrix expansion (v2) | Pi SDK types, concrete stack commands, concrete evaluators |
| Agent Runtime | Encapsulating Pi SDK: session, prompt/skills/MCP/image loading, model selection; **normalizing SDK events** into canonical events | Anything about builds, screenshots, or scoring |
| Workspace Runtime | Create/seed/teardown the disposable `tmp/run-XXX/` dir; guarantee isolation | What runs inside; how the app is built |
| Build/Serve Runtime | `install → build → start → wait-ready → screenshot`; capture build/lint/test results | Which stack it is (reads commands from the resolved spec) |
| Evaluation Runtime | Run the evaluator pipeline (pixelmatch, dom, a11y, judge) + composite scorer | How screenshots were produced; how the agent ran |
| Telemetry Collector | Append-only event log; single durable sink for all domains | Business meaning of any metric |
| Metrics Projector | Fold events → metrics / tool_calls / iterations tables | How events were produced |
| Storage | SQLite persistence + disk artifact indexing | Everything above; it is a leaf |
| Reports | Read SQLite → CLI text + HTML | How data got there |

## Recommended Project Structure

Endorses the vision layout with the `core/` (ports) addition and the workspace/build split made explicit.

```
web-stack-evals/
├── stacks/                     # DATA: one dir per stack (yaml + template/) — add a stack = add a dir
│   └── angular/{stack.yaml, template/}
├── models/                     # DATA: model configs (deepseek4pro.json) — swap model = config
├── assets/                     # DATA: prompts/, images/, skills/, mcp/, datasets/*scenario.yaml
├── evals/                      # CODE: evaluators implementing the Evaluator interface
│   ├── visual/{pixelmatch.ts, screenshot.ts}
│   ├── structural/dom.ts
│   ├── llm/judge.ts
│   └── metrics/scorer.ts       # composite aggregation
├── src/
│   ├── core/                   # ← ADDED: the contracts. AgentPort, BuildRuntime, Evaluator, Store,
│   │   ports.ts                #   canonical event union, spec types. Nothing concrete imports here.
│   ├── orchestrator/           # benchmark.ts (run one row) · matrix.ts + scheduler.ts (v2)
│   ├── agent/                  # pi-session.ts (adapter) · resource-loader.ts · prompt-builder.ts
│   ├── sandbox/                # workspace.ts · lifecycle.ts  (Workspace Runtime)
│   ├── runtime/                # npm.ts · playwright.ts · docker.ts(v2)  (Build/Serve Runtime)
│   ├── evaluation/             # registry.ts + pipeline.ts — wires evals/* by name from scenario.yaml
│   ├── telemetry/              # collector.ts · events.ts · projector.ts (metrics.ts)
│   ├── storage/                # sqlite.ts (schema + queries) · filesystem.ts (artifact store)
│   ├── reports/                # html.ts · (markdown.ts/csv.ts deferred)
│   └── cli/                    # run.ts · report.ts · compare.ts(v2)
├── results/                    # persisted run outputs + SQLite db
└── tmp/                        # disposable workspaces (gitignored) — run-XXX/
```

### Structure Rationale

- **`src/core/` holds only interfaces + types.** The dependency rule: `orchestrator`, `telemetry/projector`, and `reports` import from `core` and from concrete modules only via those ports. Concrete modules (`agent`, `runtime`, `evals`) implement ports but are never imported *by name* into the core. This one rule is what keeps the core agnostic.
- **`stacks/`, `models/`, `assets/` are data, deliberately outside `src/`.** Adding a stack or scenario is a filesystem operation, not a code change — the strongest form of extensibility.
- **`evals/` is code but isolated behind a registry** (`src/evaluation/registry.ts`). Adding an evaluator = implement `Evaluator` + register a name. Neither the orchestrator nor the scorer changes.
- **`sandbox/` vs `runtime/` split** keeps "manage a directory" separate from "run processes in it," so the Docker isolation adapter (v2) drops into `runtime/` without touching workspace logic.

## Architectural Patterns

### Pattern 1: Ports & Adapters (Hexagonal)

**What:** The core defines abstract ports; concrete tech implements them.
**When to use:** Any component the requirements say must be swappable — here: the agent SDK, the isolation mechanism, and each evaluator.
**Trade-offs:** One interface per seam (small upfront cost) buys full swappability and trivial test doubles. Do NOT add interfaces for things that will never have a second implementation (e.g., no `IStorage` abstraction over SQLite unless a second backend is real).

```typescript
// src/core/ports.ts — the whole system's contracts
interface AgentPort {
  run(input: {
    workspaceDir: string;
    model: ModelConfig;          // from models/*.json
    prompt: string;              // built from assets/prompts + scenario
    image?: Buffer;              // the mockup
    skills: SkillRef[];
    mcps: McpConfig[];
  }): { events: AsyncIterable<AgentEvent>; result: Promise<AgentResult> };
}

interface BuildRuntime {         // local (npm) now; docker later — same port
  install(dir: string): Promise<CmdResult>;
  build(dir: string): Promise<CmdResult>;
  serve(dir: string, port: number): Promise<ServerHandle>;
  screenshot(url: string, viewport: Viewport): Promise<Buffer>;
}

interface Evaluator {            // pixelmatch, dom, a11y, judge all implement this
  readonly name: string;
  evaluate(ctx: EvalContext): Promise<EvalResult>; // { score: 0..1, details }
}
```

### Pattern 2: Declarative Registry (data-driven where possible, code-behind-interface where necessary)

**What:** Three tiers of pluggability, each the least powerful mechanism that works:
- **Stacks / Scenarios → pure data.** A generic Build Runtime interprets `stack.yaml` (template, commands, port, viewport). A generic loader interprets `scenario.yaml`. No registry code, no `switch`. Adding one = adding a file.
- **Models → config + one adapter.** `deepseek4pro.json` is passed into the Pi SDK adapter. Same SDK, new model = config only. A *different* SDK = a new adapter behind `AgentPort`.
- **Evaluators → code + registry.** Each implements `Evaluator`; a registry maps name → instance; `scenario.yaml`'s `evaluators:` list selects which run.

**When to use:** This tiering is the core's agnosticism made concrete. Reach for data before code every time.
**Trade-offs:** Declarative YAML needs schema validation at load (fail fast on a malformed stack.yaml) — cheap and worth it.

```typescript
// src/evaluation/registry.ts
const registry = new Map<string, Evaluator>();
export const register = (e: Evaluator) => registry.set(e.name, e);
export const resolve = (names: string[]) => names.map(n => {
  const e = registry.get(n);
  if (!e) throw new Error(`Unknown evaluator: ${n}`); // fail fast, not silent skip
  return e;
});
// evals/visual/pixelmatch.ts → register({ name: 'pixelmatch', evaluate })
```

### Pattern 3: Event Log as Source of Truth + Projections (lightweight event sourcing)

**What:** Every domain emits typed events to an append-only collector, persisted immediately to the `events` table. Metrics are **not computed inline** — they are *projections* folded from the event log into read-model tables (`metrics`, `tool_calls`, `iterations`) after (or streaming during) the run.
**When to use:** Exactly this project. It decouples *capture* (many emitters, must be durable even on crash) from *compute* (metric formulas evolve). You can recompute all metrics from stored events without re-running an expensive benchmark — the entire value proposition of reproducibility.
**Trade-offs:** You store more (raw events + derived tables). Worth it: events are the audit trail and the debugger. **Do not build a generic event-store framework** — this is "append rows + fold them," not CQRS with replay-to-rebuild-aggregates.

```typescript
// canonical event union (src/core) — SDK-agnostic, normalized by adapters
type AgentEvent =
  | { type: 'SessionStarted' }        | { type: 'PromptSent' }
  | { type: 'IterationStarted'; index: number }
  | { type: 'ToolExecuted'; tool: 'read'|'write'|'edit'|'bash'|'grep'|'find'|'mcp'; target?: string; durationMs: number }
  | { type: 'FileWritten'; path: string; added: number; removed: number }
  | { type: 'TokensReported'; input: number; output: number; cacheRead: number; cacheWrite: number; ttftMs?: number };
type RunEvent = AgentEvent
  | { type: 'BuildStarted' | 'BuildFinished'; ok?: boolean }
  | { type: 'ScreenshotTaken'; kind: 'generated' }
  | { type: 'EvaluatorCompleted'; evaluator: string; score: number } // generalized from PixelMatchCompleted
  | { type: 'BenchmarkFinished'; composite: number };

// metrics are pure functions over the log:
const iterationCount = (events) => events.filter(e => e.type === 'IterationStarted').length;
const correctionDensity = (events) => corrections(events) / filesGenerated(events);
```

### Pattern 4: Evaluator Pipeline (chain of independent scorers → composite)

**What:** Screenshot → [pixelmatch → dom → a11y → judge] → weighted composite. Each evaluator is independent, produces a normalized `0..1` score + structured details; the scorer aggregates with configurable weights.
**When to use:** From day one — the requirements wire all four in v1 precisely so the pipeline shape is proven before more evaluators arrive.
**Trade-offs:** Evaluators should be independently runnable (feed static screenshots) so they're testable without a full run. The LLM Judge introduces non-determinism into scoring — record its raw response as an artifact and treat its numeric score as one weighted input, never the sole score.

## Data Flow

### Primary Flow (one matrix row)

```
stack.yaml + scenario.yaml + model.json   (declarative inputs, validated on load)
        │
        ▼
Orchestrator: create run record (status=running)
        │
        ▼
Workspace Runtime: mkdir tmp/run-XXX/ → seed stack template into app/     ─┐
        │                                                                   │
        ▼                                                                   │
Agent Runtime (Pi SDK adapter): inject prompt+skills+MCP+image → agent      │
   builds & self-corrects in app/;  streams normalized AgentEvents ─────────┤
        │                                                                   │  every step
        ▼                                                                   ├─ emits events →
Build/Serve Runtime: install → build → serve → wait-ready                   │   Collector
   (build/lint/test results captured as events) ──────────────────────────┤   (append-only,
        │                                                                   │    persisted to
        ▼                                                                   │    events table)
Build/Serve Runtime: Playwright screenshot @ viewport → artifact ──────────┤
        │                                                                   │
        ▼                                                                   │
Evaluation Runtime: pixelmatch → dom → a11y → judge → composite ───────────┘
        │
        ▼
Metrics Projector: fold events → metrics / tool_calls / iterations tables
        │
        ▼
Storage: finalize run (status=scored, composite_score); index artifacts on disk
        │
        ▼
Reports: CLI summary + HTML   ·   Workspace Runtime: teardown (kill server, del dir)
```

### Key Data Flows

1. **Event flow (cross-cutting):** All runtimes → Collector (fire-and-forget append) → `events` table (durable). Projector reads `events` → writes derived tables. Reports read derived tables. Events flow *up* into storage; nothing flows back into runtimes.
2. **Artifact flow:** Runtimes write files (screenshots, logs, generated code, build output) to `tmp/run-XXX/`; on success the artifact store copies/moves survivors to `results/` and indexes their paths in the `artifacts`/`screenshots` tables. SQLite holds *pointers*, not blobs.
3. **Config flow:** Specs are loaded and *snapshotted* into the run record (see schema) so a historical run stays reproducible even if `stack.yaml` later changes.

## SQLite Schema (proposed)

Central rule: **one `runs` row per matrix cell; everything else is `run_id`-scoped.** Dimension tables (stacks/models/scenarios) hold catalog identity; the run row snapshots the *resolved spec* used, so reproducibility survives spec edits.

| Table | Key columns | Populated from | Notes |
|-------|-------------|----------------|-------|
| `runs` | id, stack_id→, model_id→, scenario_id→, repetition, status, started_at, finished_at, composite_score, error, **spec_snapshot(JSON)** | Orchestrator | The spine. `status`: pending→running→built→evaluated→scored/failed. |
| `stacks` | id, name, version, template_path | catalog | Dimension. Run snapshots the actual spec used. |
| `events` | id, run_id→, seq (monotonic), ts, type, payload(JSON) | Collector | **Append-only source of truth.** Index on (run_id, seq). |
| `tool_calls` | id, run_id→, seq, tool, target, ts, duration_ms, status | Projector (from ToolExecuted) | Derived; recomputable from `events`. |
| `iterations` | id, run_id→, index, outcome, started_at, finished_at | Projector (from Iteration events) | Derived; drives iteration count & correction density. |
| `metrics` | id, run_id→, key, value_num, value_text, unit | Projector | **Tall/EAV** so a new metric needs no migration — matches the extensibility goal. |
| `evaluations` | id, run_id→, evaluator, score, weight, details(JSON) | Evaluation Runtime | **ADD (implied, not in vision list):** per-evaluator breakdown feeding `composite_score`. |
| `screenshots` | id, run_id→, kind(expected/generated), path, viewport_w, viewport_h, taken_at | Build Runtime | Kept distinct from artifacts because central to eval. |
| `artifacts` | id, run_id→, kind(log/code/build_output), path, mime, bytes | Artifact store | Disk pointers; blobs never in SQLite. |

Design decisions to carry into the schema phase:
- **Tall `metrics` table over wide columns.** The metric set will grow (new perf/agent metrics); EAV avoids a migration per metric. Trade-off: less type-safe queries. Acceptable because reads are analytical, not hot-path. (If a fixed v1 metric set is preferred for ergonomics, a wide row is fine short-term — note the migration cost.)
- **Add an `evaluations` table.** The vision's `metrics` could absorb per-evaluator scores, but a dedicated table makes "pixelmatch vs judge disagreement" and composite recomputation clean.
- **Snapshot specs on the run.** Without it, "which stack.yaml produced run 42?" becomes unanswerable after any edit — fatal for a reproducibility tool.
- **WAL mode + single writer.** Set from day one; it is what lets SQLite survive matrix parallelism (v2) with one writer process and many readers.

## Build Order (v1 thin vertical slice → matrix)

**The governing principle: build the entire *deterministic* pipeline before plugging in the *non-deterministic, expensive, flaky* agent.** Everything except the LLM can be validated with fixtures. If you build the agent first you debug five unproven components through one flaky, paid, slow black box. Build it so that when the agent lands, it is the *only* new variable.

```
0. Foundations (horizontal substrate — everything writes through these)
   · repo skeleton, tsconfig · src/core ports + canonical event types
   · storage/sqlite schema + storage/filesystem artifact store
   · telemetry/collector (append events) · spec loaders + schema validation
   → Test: write & read an event; load & validate a stack.yaml/scenario.yaml.

1. Workspace Runtime (sandbox)
   · create tmp/run-XXX/, seed stack template, teardown (kill procs, rm dir)
   → Test alone: seed angular template → assert files present → teardown frees port.

2. Build/Serve Runtime — run against the RAW stack template (no agent yet)
   · install → build → serve → wait-ready → Playwright screenshot
   → Test: template's default app produces a real screenshot. Proves dir→running→pixels.

3. Evaluation Runtime + Scorer — on static screenshots (no agent yet)
   · pixelmatch → dom → a11y → judge → composite; persist evaluations + composite
   → Test: template-screenshot vs expected yields all 4 scores + composite.
   ── CHECKPOINT: workspace→build→screenshot→eval→score→persist runs end-to-end,
      deterministically, WITHOUT the LLM. ~80% of the system validated on fixtures. ──

4. Agent Runtime (Pi SDK adapter) — the hardest/most variable piece, built last of the runtimes
   · implement AgentPort; inject prompt+skills+MCP+image; normalize Pi events → canonical events
   → Test: run agent in a workspace → assert files written + normalized events emitted.

5. Orchestrator — wire the single row
   · config → workspace → agent → build → screenshot → eval → score → persist, emitting throughout
   → Test: one row (Angular + DeepSeek 4 Pro + dashboard) runs green end-to-end.

6. Metrics Projector + Reports
   · fold events → metrics/tool_calls/iterations · CLI summary · HTML report
   → Test: metrics recomputed purely from stored events; HTML renders scores+screenshots.

7. CLI polish
   · `bench run` wraps the orchestrator (a minimal version exists from step 5).

── v1 COMPLETE: one reproducible row, full pipeline, all 4 evaluators, persisted + reported ──

v2 (matrix expansion — core does NOT change):
   · orchestrator/matrix.ts generates rows from specs · scheduler.ts runs them (serial→parallel)
   · per-run free-port allocation (kills the hardcoded :4200 assumption) · concurrency cap for LLM rate limits/CPU
   · runtime/docker.ts as a BuildRuntime adapter for stronger isolation · reports/compare.ts, markdown/csv
```

Dependency notes:
- Steps 0–3 have **no dependency on the agent** and must precede it. This is the whole point.
- The Orchestrator (5) depends on all four runtimes but only through ports, so 1–4 can be built and tested in isolation and in any internal order (though the sequence above front-loads the cheap/deterministic ones).
- Reports/projector (6) depend on the event log existing (0) and being populated (5), so they come after a run can complete.
- **Nothing in v1 should import `matrix.ts`, `scheduler.ts`, or `docker.ts`.** Building the matrix before one row works is the classic trap (see anti-patterns).

## Scaling Considerations (matrix size / concurrency, not "users")

| Scale | Adjustments |
|-------|-------------|
| 1 row (v1) | Serial, single temp dir, stack's declared port (4200). SQLite single-file. No scheduler. Fine. |
| 10s–100s of rows | Parallelize via scheduler with a concurrency cap (LLM rate limits + CPU-bound builds dominate). **Per-run free-port allocation.** SQLite in WAL mode, single writer process, many readers. |
| 1000s of rows / CI | Container-per-run isolation (Docker adapter), possibly distributed workers, artifacts → object storage. Consider Postgres only if concurrent *writers* become the bottleneck — SQLite+WAL goes surprisingly far with one writer. |

### First bottlenecks (in order)
1. **Orphaned dev servers / port exhaustion** — the earliest real failure once you run more than one row. Fix: robust teardown (process-group kill in `finally`) + per-run port allocation.
2. **LLM rate limits & cost** — caps effective parallelism long before CPU does. Fix: concurrency limiter + retry/backoff in the Agent adapter.
3. **Build CPU/memory** — `npm install`+build per row is heavy. Fix: cap concurrent builds; cache package downloads across runs.

## Anti-Patterns

### Anti-Pattern 1: Leaking Pi SDK types outside the Agent Runtime
**What people do:** Return raw Pi SDK objects/events from the adapter; the orchestrator or metrics code reads `piResponse.usage.foo`.
**Why it's wrong:** Every consumer now depends on the SDK — swapping models/SDKs (the stated #1 goal) means touching the whole codebase.
**Instead:** The adapter is the *only* file that imports Pi SDK. It emits the canonical `AgentEvent` union. Nothing downstream knows Pi exists.

### Anti-Pattern 2: Hardcoding a stack/model/evaluator in the core
**What people do:** `if (stack === 'angular') { ng build }` or a `switch` over model names in the orchestrator.
**Why it's wrong:** Defeats declarative-first; every new stack edits the core.
**Instead:** Build Runtime reads commands from the resolved `stack.yaml`; evaluators resolve by name from the registry; models are config passed to one adapter.

### Anti-Pattern 3: Computing metrics inline during execution
**What people do:** Increment counters and calculate cost/iterations as the run proceeds, storing only the final numbers.
**Why it's wrong:** You can never recompute or fix a metric formula without re-running an expensive benchmark; capture and compute are welded together.
**Instead:** Emit raw events; project metrics from the stored log. Metrics become pure, recomputable functions.

### Anti-Pattern 4: Running the benchmark inside the main project / weak teardown
**What people do:** Build in a subfolder of the repo, or delete the dir without killing the dev server first.
**Why it's wrong:** Mutates the tool's own project; orphaned servers leak ports and hang the next run.
**Instead:** Every run in `tmp/run-XXX/`; teardown in a `finally` block that kills the process group *then* removes the dir. Keep-on-failure flag for debugging.

### Anti-Pattern 5: Building the matrix/scheduler/Docker before one row works
**What people do:** Start with `matrix.ts`, generic schedulers, and container orchestration.
**Why it's wrong:** You scale a pipeline that has never once produced a correct score. Bugs multiply across dimensions you can't yet observe.
**Instead:** One hardcoded row, end-to-end, green. The declarative specs already make v2 a loop over proven code.

### Anti-Pattern 6: Over-engineering the event store
**What people do:** Full CQRS, event replay to rebuild aggregates, a generic event-bus framework.
**Why it's wrong:** This project needs "append rows, fold them into tables" — nothing more.
**Instead:** A collector that appends to the `events` table + a projector that folds. That is the entire "event sourcing" here.

## Integration Points

### External Services / Tooling

| Integration | Pattern | Notes |
|-------------|---------|-------|
| Pi SDK | Behind `AgentPort` adapter only | Sole importer of SDK types; normalizes events. Swap = new adapter. |
| Playwright | Inside Build/Serve Runtime | Headless screenshot at declared viewport; also usable via the playwright MCP for the agent. |
| npm / node toolchains | Build Runtime, per stack | Commands come from `stack.yaml`; runtime is stack-agnostic. |
| LLM Judge API | An evaluator (`evals/llm/judge.ts`) | An LLM call itself — record raw response as artifact; its score is one weighted input, non-deterministic. |
| axe-core | Accessibility evaluator | Runs against the served page in Playwright. |
| pixelmatch + pngjs | Visual evaluator | Deterministic pixel diff; the reproducible anchor of the score. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Orchestrator ↔ runtimes | Synchronous calls through ports (`AgentPort`, `BuildRuntime`, `Evaluator`) | Core never imports concretes by name. |
| All domains → Collector | Fire-and-forget event append | One-directional; durability at the collector. |
| Projector ↔ events | Read-only fold → derived tables | Recomputable; no coupling back to emitters. |
| Reports ↔ SQLite | Read-only queries | Reporting consumes; never writes. |
| Specs (data) → loaders | Parse + validate at load, snapshot onto run | Fail fast on malformed YAML/JSON. |

## Sources

- Established software architecture patterns applied to the stated requirements: Ports & Adapters / Hexagonal Architecture (Cockburn); Registry / plugin-by-data; event log + read-model projections (lightweight event sourcing); disposable sandbox lifecycle with guaranteed teardown.
- Vision document (`PROJECT.md`, repo root) — proposed 5-domain split, directory layout, event vocabulary, metric catalog, and dataflow diagram.
- GSD working context (`.planning/PROJECT.md`) — v1 thin-vertical-slice scope, constraints (TS/Node, Pi SDK, Playwright, SQLite, local temp isolation), and key decisions.

Confidence: **HIGH** on the structural recommendations (they follow directly from the requirements and are foundational patterns). **MEDIUM** on Pi SDK event normalization specifics (the exact SDK event shapes will shape the adapter — resolve in the Agent Runtime phase) and on exact SQLite column typing (design proposal; firm up in the storage phase).

---
*Architecture research for: automated AI-coding-agent benchmark/eval harness*
*Researched: 2026-07-01*
