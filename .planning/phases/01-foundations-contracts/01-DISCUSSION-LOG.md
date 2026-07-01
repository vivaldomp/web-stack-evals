# Phase 1: Foundations & Contracts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 1-Foundations & Contracts
**Areas discussed:** Event union shape, Spec layout & strictness, Manifest & fingerprint, Schema & artifact store, Event-type taxonomy, Run outcome model, Evaluations table shape, AgentPort boundary, Run ID scheme, Event-log home, Schema creation, stacks table role, Projections, Screenshots, Time/units

---

## Event Union Shape — Unknown events

| Option | Description | Selected |
|--------|-------------|----------|
| Passthrough as 'unknown' | Preserve raw event under a generic `UnknownEvent` variant tagged with the original Pi type; never drop | ✓ |
| Map-or-drop | Only mapped events enter the stream; unrecognized silently dropped | |
| Strict / error | Unrecognized event aborts the run | |

**User's choice:** Passthrough as 'unknown'
**Notes:** Keeps the append-only log a faithful record against a fast-moving Pi SDK (CLAUDE.md).

## Event Union Shape — Tool-call granularity

| Option | Description | Selected |
|--------|-------------|----------|
| One event per tool call | Each read/write/edit/bash/grep emits its own event w/ name + args + isError | ✓ |
| Aggregated per turn | One summary event per turn with tool tallies | |

**User's choice:** One event per tool call
**Notes:** Required to fold TEL-05 correction density and TEL-06 tool counts from the raw log.

## Event Union Shape — Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Monotonic seq + timestamp | Per-run seq (append order authoritative) + wall-clock timestamp | ✓ |
| Timestamp only | Order by wall-clock only | |
| You decide | Defer to planning | |

**User's choice:** Monotonic seq + timestamp

## Spec Layout & Strictness — Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level per-type dirs | `stacks/`, `models/`, `scenarios/<name>/`, `assets/` (matches vision doc) | ✓ |
| Single specs/ dir | One folder for all types | |
| You decide | Defer to planning | |

**User's choice:** Top-level per-type dirs

## Spec Layout & Strictness — zod strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Strict — reject unknowns | `.strict()`; typo'd/unexpected key fails loudly before any run | ✓ |
| Lenient — ignore extras | Unknown keys pass through / stripped | |

**User's choice:** Strict — reject unknowns
**Notes:** Directly serves Success Criterion #1 (malformed config rejected with a clear error).

## Spec Layout & Strictness — Expected-screenshot provenance

| Option | Description | Selected |
|--------|-------------|----------|
| Path + provenance block | Image path + structured source/tool+version/date block | ✓ |
| Path only | Just the image path | |
| You decide | Defer to planning | |

**User's choice:** Path + provenance block

## Manifest & Fingerprint — Composition

| Option | Description | Selected |
|--------|-------------|----------|
| Everything the agent sees | Hash of resolved specs + asset bytes (prompt, mockup, expected screenshot, skills) | ✓ |
| Spec files only | Hash yaml/json text; assets by path, unhashed | |
| You decide | Defer to planning | |

**User's choice:** Everything the agent sees
**Notes:** Catches a swapped mockup a path-only hash would miss; mitigates reproducibility-illusion pitfall.

## Manifest & Fingerprint — Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level + per-component | Top-level fingerprint + per-component hashes (stack/scenario/model/each asset) | ✓ |
| Single combined hash | One opaque fingerprint | |

**User's choice:** Top-level + per-component

## Manifest & Fingerprint — Version stamps

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit resolved stamps | node, deps/lockfile, Playwright+Chromium revision, model id+params | ✓ |
| Minimal (lockfile + browser) | Lockfile hash + browser revision only | |
| You decide | Defer to planning | |

**User's choice:** Explicit resolved stamps

## Schema & Artifact Store — Events table

| Option | Description | Selected |
|--------|-------------|----------|
| Generic JSON payload col | `(run_id, seq, type, ts, payload JSON)` + promoted indexed cols | ✓ |
| Typed columns per type | Wide/table-per-type columns; migration per new event | |

**User's choice:** Generic JSON payload col
**Notes:** Matches passthrough-unknown decision — any event appends without a migration.

## Schema & Artifact Store — Rep-keying

| Option | Description | Selected |
|--------|-------------|----------|
| rep_index now, =0 in v1 | `(stack, model, scenario, rep_index)`; children FK to run_id | ✓ |
| Add rep columns in v2 | Key by run_id only for now | |

**User's choice:** rep_index now, =0 in v1

## Schema & Artifact Store — Artifacts

| Option | Description | Selected |
|--------|-------------|----------|
| Paths in DB, files under results/ | `results/<run_id>/…`; DB stores paths, never blobs | ✓ |
| Small blobs in DB | Store small artifacts as SQLite BLOBs | |
| You decide | Defer to planning | |

**User's choice:** Paths in DB, files under results/

## Event-type Taxonomy — File events

| Option | Description | Selected |
|--------|-------------|----------|
| One FileMutation, op field | Single event w/ `op: create|edit|delete` + path + lines± | ✓ |
| Separate create/edit/delete | Distinct variants | |
| Single FileWritten | One event, no op distinction | |

**User's choice:** One FileMutation, op field
**Notes:** Correction density = repeated edits to same path, folded from the log.

## Event-type Taxonomy — Build events

| Option | Description | Selected |
|--------|-------------|----------|
| Per-stage lifecycle | install/build/start each Started + Completed|Failed w/ duration + exit | ✓ |
| Single build result | One aggregate BuildCompleted | |

**User's choice:** Per-stage lifecycle
**Notes:** Feeds TEL-03 (build vs startup time separately).

## Run Outcome Model

| Option | Description | Selected |
|--------|-------------|----------|
| Status enum + failed_stage | `status ∈ {completed, build_failed, start_failed, agent_error, eval_error, timeout}` + failed_stage + terminal BenchmarkFinished | ✓ |
| ok/failed boolean | Success flag + error message | |
| You decide | Defer to planning | |

**User's choice:** Status enum + failed_stage
**Notes:** Every exit is a queryable row — "failures as scored outcomes, not crashes".

## Evaluations Table Shape — Sub-scores

| Option | Description | Selected |
|--------|-------------|----------|
| Row per (run, evaluator) | `(run_id, rep_index, evaluator_name)` + raw score + detail JSON | ✓ |
| Wide row per run | One column per evaluator | |

**User's choice:** Row per (run, evaluator)
**Notes:** New evaluator = new rows, no migration; supports EVAL-05 registry.

## Evaluations Table Shape — Composite

| Option | Description | Selected |
|--------|-------------|----------|
| Composite + weights stored | Composite + the weighting/normalization used, re-derivable from raw | ✓ |
| Composite value only | Just the final number | |
| You decide | Defer to planning | |

**User's choice:** Composite + weights stored

## AgentPort Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Ports in a core contracts module | Plain TS interfaces importing nothing concrete; adapters depend inward | ✓ |
| Ports beside implementations | Co-located with implementing module | |
| You decide | Defer to planning | |

**User's choice:** Ports in a core contracts module
**Notes:** Structurally enforces AGENT-01 (only the adapter imports Pi SDK).

## Run ID Scheme

| Option | Description | Selected |
|--------|-------------|----------|
| One id, shared everywhere | Sortable `run-<ts>-<short>` = DB PK + `tmp/<run_id>` + `results/<run_id>` | ✓ |
| Numeric autoincrement | DB integer PK; dirs derive from it | |
| You decide | Defer to planning | |

**User's choice:** One id, shared everywhere

## Event-log Home

| Option | Description | Selected |
|--------|-------------|----------|
| SQLite events table is truth | The events table IS the append-only log (single-writer, WAL, seq) | ✓ |
| JSONL file is truth, DB mirrors | events.jsonl source of truth, projected into SQLite | |
| You decide | Defer to planning | |

**User's choice:** SQLite events table is truth
**Notes:** No two-writes sync path to reconcile.

## Schema Creation

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotent init + schema_version | `CREATE ... IF NOT EXISTS` under a user_version/schema_version pragma | ✓ |
| Migration framework | Adopt a migration library now | |

**User's choice:** Idempotent init + schema_version
**Notes:** Zero-dep; clean seam for v2 migrations.

## stacks Table Role

| Option | Description | Selected |
|--------|-------------|----------|
| stacks = registry, run snapshots | Catalog row + immutable manifest snapshot on run + FK | ✓ |
| Snapshot only, no registry | Everything inline in the run manifest | |
| You decide | Defer to planning | |

**User's choice:** stacks = registry, run snapshots
**Notes:** Editing a stack never rewrites history; same pattern for models/scenarios.

## Projections (metrics / tool_calls / iterations tables)

| Option | Description | Selected |
|--------|-------------|----------|
| Materialized after run | Projector folds the event log into the tables once after the run | ✓ |
| Computed-on-read views | SQL views folded live per read | |
| You decide | Defer to planning | |

**User's choice:** Materialized after run
**Notes:** Cheap reads + "never inline" (TEL-02); always re-derivable by replay.

## Screenshots

| Option | Description | Selected |
|--------|-------------|----------|
| screenshots specializes artifacts | Generic artifacts store + typed screenshots (role/viewport/dpr) + FK | ✓ |
| One artifacts table, kind field | Fold into artifacts with kind + JSON metadata | |
| You decide | Defer to planning | |

**User's choice:** screenshots specializes artifacts

## Time/units

| Option | Description | Selected |
|--------|-------------|----------|
| Epoch ms UTC + durations in ms | Integer epoch-ms UTC timestamps; durations int ms; cost decimal USD verbatim | ✓ |
| You decide | Defer to planning | |

**User's choice:** Epoch ms UTC + durations in ms

---

## Claude's Discretion

- Exact zod field names/shapes within each spec schema.
- SQLite index choices beyond the promoted `events` columns.
- Concrete file/module directory layout under `src/` (port-isolation *direction* is locked; folder names are not).
- Hashing algorithm and canonical serialization for the fingerprint.
- The exact promoted-column set on the `events` table beyond `tool_name`.

## Deferred Ideas

None — discussion stayed within the Phase 1 contract scope. Matrix breadth, Docker isolation, Markdown/CSV reports, and comparison axes remain v2 (already tracked in REQUIREMENTS.md).
