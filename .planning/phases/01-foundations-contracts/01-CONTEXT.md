# Phase 1: Foundations & Contracts - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

The agnostic core substrate — the contracts every later phase folds into, with **no agent, no build, no evaluation** implemented yet, only the shapes they depend on:

- Typed, zod-validated spec loaders: `stack.yaml`, `scenario.yaml`, model config (SPEC-01/02/03)
- The canonical `AgentEvent` discriminated union + append-only event log (TEL-01)
- The stamped run manifest + input fingerprint (SPEC-04, STORE-02)
- The SQLite schema (rep-keyed, WAL/single-writer) + on-disk artifact store (STORE-01/03)
- The port interfaces (`AgentPort`, etc.) that keep Pi SDK / Playwright / evaluators isolated

**Requirements in scope:** SPEC-01, SPEC-02, SPEC-03, SPEC-04, TEL-01, STORE-01, STORE-02, STORE-03.

Discussion clarified the **shape of these contracts** only. Libraries were not up for debate — they are already locked in `.claude/CLAUDE.md` (better-sqlite3 + WAL, zod, yaml, Pi SDK behind a port). Implementing evaluators, workspace, build/render, and the Pi adapter belongs to Phases 2–5.
</domain>

<decisions>
## Implementation Decisions

### Event Union Shape
- **D-01:** `AgentEvent` is a **single discriminated union** of typed variants keyed by `type`.
- **D-02:** **Unknown Pi SDK events are passed through**, not dropped or errored — an unrecognized event becomes a generic `UnknownEvent` variant that preserves the raw payload tagged with the original Pi type. The append-only log stays a faithful, complete record even for unmapped events; frequent ones can be promoted to typed variants later. (Rationale: Pi SDK is a fast-moving external dep per CLAUDE.md; never lose signal.)
- **D-03:** **One event per individual tool call** (read/write/edit/bash/grep/…), carrying tool name + args summary + `isError`. No per-turn aggregation — correction density (TEL-05) and tool counts by type (TEL-06) must be foldable from the raw log.
- **D-04:** Events are keyed/ordered by a **per-run monotonically increasing `seq`** (append order authoritative) **plus a wall-clock timestamp** (for duration/TTFT math). Ordering never depends on clock resolution.
- **D-05:** File mutations are modeled as a **single `FileMutation` event with `op: create | edit | delete`** + path + lines added/removed. Correction density = repeated edits to the same path, folded from the log. (Not three separate variants.)
- **D-06:** Build/serve lifecycle emits **per-stage events**: `install`, `build`, `start` each get `Started` + `Completed | Failed` with duration and exit code. Feeds TEL-03 (build time vs startup time as separate metrics).

### Spec Layout & Strictness
- **D-07:** Specs live in **top-level per-type dirs**: `stacks/<name>.yaml`, `models/<name>.json`, `scenarios/<name>/` (mockup + expected screenshot alongside its yaml), plus `assets/`. Matches the root vision doc's proposed layout; scales cleanly for the v2 matrix with no core change.
- **D-08:** zod loaders are **`.strict()`** — unknown/extra keys are **rejected** with a clear validation error *before any run starts* (satisfies Success Criterion #1). A typo'd key fails loudly rather than silently no-op'ing.
- **D-09:** The expected screenshot in `scenario.yaml` is represented as a **path + a structured provenance block** (source: hand-designed | rendered-from-reference | captured; tool + version; date). Both the bytes and the provenance are fingerprintable, so comparability is always known (SPEC-02).

### Manifest & Fingerprint
- **D-10:** The **input fingerprint is a content-hash of everything the agent sees**: resolved spec values **+ actual asset bytes** (prompt text, mockup image, expected screenshot, skill files). Two runs with an equal fingerprint provably saw identical inputs — catches a swapped mockup that a path-only hash would miss. (Directly mitigates the reproducibility-illusion pitfall.)
- **D-11:** Fingerprint structure = a **top-level fingerprint + per-component hashes** (stack, scenario, model, each asset), so a mismatch tells you *which* input changed.
- **D-12:** The manifest stamps versions **explicitly and separately from the fingerprint**: node version, resolved dependency versions (or lockfile hash), Playwright + Chromium revision, model id + params. Lets a score change be attributed to an env change vs an agent change (cost/screenshot-drift pitfall).

### Schema & Storage
- **D-13:** The `events` table is **generic**: `(run_id, seq, type, ts, payload JSON)` + a few **promoted indexed columns** (e.g. `tool_name`) for hot metric folds. Any event type — including unmapped `UnknownEvent`s — appends with no schema migration (mirrors D-02). Metrics project via queries over the log.
- **D-14:** The schema is **rep-keyed now**: every run row carries `(stack, model, scenario, rep_index)`; **v1 always writes `rep_index = 0`**; child tables FK to `run_id`. v2's matrix/repetitions need zero schema change.
- **D-15:** Artifacts (screenshots, logs, generated code, diff images) live **on disk under `results/<run_id>/…`**; the **DB stores relative paths only, never blobs**. Keeps SQLite small/fast and the artifacts browsable for the HTML report (STORE-03).
- **D-16:** The `events` **SQLite table IS the canonical append-only log** (TEL-01) — single-writer, WAL, `seq`-ordered. One source of truth, queryable directly, no JSONL-to-DB sync to reconcile.
- **D-17:** Schema creation = a **single idempotent init** (`CREATE TABLE IF NOT EXISTS …`) guarded by a `schema_version` / `user_version` pragma. **No migration framework in v1**; bump the version + add a guarded step when v2 evolves the schema.
- **D-18:** **`stacks` is a reusable registry** (name, template, commands, port, viewport); each run row stores an **immutable manifest snapshot** of the resolved spec it actually ran + FK to the stack row. Editing a stack later never rewrites history. Same pattern applies to `models` and `scenarios`.

### Run Outcome & Evaluation Contracts
- **D-19:** The `runs` row represents outcome via a **`status` enum** (`completed`, `build_failed`, `start_failed`, `agent_error`, `eval_error`, `timeout`, …) **+ `failed_stage`**, with a terminal `BenchmarkFinished` event carrying the outcome. Every exit — success or failure — is a persisted, queryable row (Phase 2's "failures are scored outcomes, not crashes").
- **D-20:** Raw sub-scores are stored **one row per `(run_id, rep_index, evaluator_name)`** in an `evaluations` table, with a raw score + a detail JSON (axe violations, DOM-presence breakdown, etc.). A new evaluator = new rows, **no schema change** (supports EVAL-05's registry; mirrors D-13).
- **D-21:** The **normalized composite is stored alongside the weighting/normalization used** to produce it (on the run/scores row), separate from raw sub-scores (SCORE-02). The composite is re-derivable from raw + recorded weights without re-running.

### Cross-Cutting Contracts
- **D-22:** `run_id` is a **single sortable id** (timestamp-prefixed, e.g. `run-<ts>-<short>`) generated at run start and **reused verbatim** as the DB primary key, the `tmp/<run_id>` workspace dir, and the `results/<run_id>` artifact dir. One string traces a run across DB, disk, and logs; sortable = chronological listing for free.
- **D-23:** Ports (`AgentPort`, `EvaluatorPort`, `StoragePort`, …) are **plain TS interfaces in one core/contracts module that imports nothing concrete**; implementations live in their own modules and depend inward on the interfaces. Structurally enforces AGENT-01 ("only the adapter imports the Pi SDK").
- **D-24:** `metrics` / `tool_calls` / `iterations` tables are **materialized projections**: a projector folds the event log into them once after the run completes (or at defined checkpoints). Reports/CLI read pre-computed rows; events remain the source of truth and the projection is always re-derivable by replaying the log (satisfies TEL-02's "never computed inline" while keeping reads cheap).
- **D-25:** `screenshots` **specializes `artifacts`**: `artifacts` is the generic store `(kind, path, run_id, sha)`; `screenshots` adds typed fields (`role: expected | generated | diff`, viewport, dpr) + FK to the artifact row. No double-storing of bytes/paths.
- **D-26:** **Canonical time/units:** timestamps as integer **epoch milliseconds UTC**; all durations (wall/build/startup/render/TTFT) as **integer milliseconds**; costs as **decimal USD verbatim from Pi**. One unit convention everywhere.

### Claude's Discretion
Left to the planner — no user preference expressed, decide from requirements + patterns:
- Exact zod field names/shapes within each spec schema.
- SQLite index choices beyond the promoted `events` columns.
- Concrete file/module directory layout under `src/` (the port-isolation *direction* in D-23 is locked; the exact folder names are not).
- Hashing algorithm for the fingerprint and the canonical serialization used before hashing.
- The exact promoted-column set on the `events` table (beyond `tool_name`).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Vision & Scope (source of truth)
- `PRODUCT.md` (repo root) — the full framework vision; source of truth for the overall architecture, the proposed directory layout (`assets/`, `stacks/`, `models/`, `scenarios/`, `src/{orchestrator,agent,sandbox,runtime,telemetry,storage,reports,cli}`, `results/`), and the example v1 row (Angular + DeepSeek 4 Pro + dashboard). **Note: all produced artifacts are written in English despite this doc being Portuguese.**
- `.planning/PROJECT.md` — GSD working context: core value, requirements (Active/Out-of-Scope), constraints, Key Decisions table.
- `.planning/REQUIREMENTS.md` — the 37 v1 REQ-IDs + traceability. Phase 1 owns SPEC-01/02/03/04, TEL-01, STORE-01/02/03.
- `.planning/ROADMAP.md` §"Phase 1" — phase goal + the 5 success criteria this phase must make TRUE.

### Locked Tech Stack (do NOT re-decide libraries)
- `.claude/CLAUDE.md` — pinned stack + rationale + "What NOT to Use": `@earendil-works/pi-coding-agent@0.80.3` (NOT the deprecated `@mariozechner/*`), `@earendil-works/pi-ai@0.80.3`, `better-sqlite3@12` (WAL, single-writer), `zod@4`, `yaml@2`, Node 24 / TypeScript 6 (`module: nodenext`, strict). Also documents the Pi SDK API surface (`createAgentSession`, `session.prompt({images})`, `AssistantMessage.usage.cost.total`) and the "Pi has no native MCP" caveat relevant to the `AgentPort` contract.

### Pitfalls this phase's contracts must pre-empt
- `.planning/research/SUMMARY.md` (if present) / STATE.md "Blockers/Concerns" — reproducibility illusion (→ D-10/D-11/D-12), cost-accounting drift (→ D-12/D-26), append-only-log-as-truth (→ D-16/D-24).

No external ADRs exist yet — the decisions above ARE the Phase 1 contract record.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None — greenfield.** Repo contains only `.planning/`, `.claude/`, `.git/`, and the root `PRODUCT.md` vision doc. No `src/`, no `package.json`, no specs on disk yet. This phase creates the first code.

### Established Patterns
- **Declarative-first / core-agnostic** (from PROJECT.md constraints): the core never hardcodes a stack, model, or scenario — everything flows through the typed spec loaders. Every schema/contract decision above upholds this.
- **Ports-and-adapters** (D-23): concrete deps (Pi SDK, Playwright, better-sqlite3) sit behind interfaces so any component swaps without touching the others.
- **Append-only event log → projections** (D-16/D-24): the single architectural spine everything downstream reads from.

### Integration Points
- The spec loaders, `AgentEvent` union, run manifest, and SQLite schema written here are imported by **every** subsequent phase (2 workspace/build, 3 evaluation, 4 Pi adapter, 5 orchestrator/reports). Breaking-change cost is highest here — hence the thorough contract lock.
</code_context>

<specifics>
## Specific Ideas

- v1 row is fixed by the vision doc: **Angular template @ port 4200 + DeepSeek 4 Pro (`deepseek4pro.json`) + "dashboard" scenario**. The Phase 1 spec fixtures should be shaped to load exactly this row, even though no run executes until later phases.
- `run_id` naming should read as a human-sortable folder name on disk (D-22) — the `results/<run_id>/` dir is what the HTML report (Phase 5) browses.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within the Phase 1 contract scope. Scope-creep guards held: matrix breadth, Docker isolation, Markdown/CSV reports, and comparison axes remain v2 (already in REQUIREMENTS.md "Out of Scope" / "v2 Requirements"). The schema is rep-keyed (D-14) and specs are declarative (D-07) precisely so those v2 features need no core change.
</deferred>

---

*Phase: 1-Foundations & Contracts*
*Context gathered: 2026-07-01*
