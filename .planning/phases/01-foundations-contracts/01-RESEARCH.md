# Phase 1: Foundations & Contracts - Research

**Researched:** 2026-07-01
**Domain:** Agnostic core substrate — zod-validated spec loaders, canonical event union, run manifest + input fingerprint, SQLite (WAL/single-writer) schema, on-disk artifact store. Node 24 / TypeScript 6 greenfield.
**Confidence:** HIGH

## Summary

This phase builds infrastructure, not AI systems: config loading, a provenance manifest, a SQLite results DB, and an artifact store. The libraries are **already locked** in `.claude/CLAUDE.md` and re-verified against the live npm registry this session (all versions match: zod 4.4.3, better-sqlite3 12.11.1, yaml 2.9.0, playwright 1.61.1, `@earendil-works/pi-*` 0.80.3, pixelmatch 7.2.0, pngjs 7.0.0; Node 24.13.1). Project-level research (`.planning/research/SUMMARY.md`, `PITFALLS.md`) already established the architecture (ports-and-adapters, append-only-log→projections) and the pitfalls this phase's contracts pre-empt (reproducibility illusion, cost drift). This research does **not** duplicate that — it fills the concrete-API gaps the planner needs to write good tasks, and it flags where Zod 4 differs from training-era Zod 3.

The single most important implementation gap: **Zod 4 changed the strict-object API.** The CONTEXT.md decision D-08 says "zod loaders are `.strict()`" — but in Zod 4 `.strict()` on `z.object()` is **deprecated** in favor of the top-level `z.strictObject()`. And the clear-error requirement (Success Criterion #1) has a first-class Zod 4 answer: `z.prettifyError(result.error)` renders a multi-line human-readable error. Everything else (better-sqlite3 WAL/transactions/`user_version`, yaml parse-then-validate, sha256 fingerprinting via stdlib `node:crypto`) is standard, stable, and needs no new dependency.

**Primary recommendation:** Build the core as pure functions + plain-interface ports (D-23): `loadSpec` (yaml.parse → `z.strictObject().safeParse` → `z.prettifyError` on failure), a `Db` module (better-sqlite3, `journal_mode=WAL`, idempotent `CREATE TABLE IF NOT EXISTS` guarded by `user_version`), a `fingerprint` function (stdlib sha256 over canonicalized spec values + raw asset bytes), and a `manifest` builder. No ORM, no migration framework, no custom event store — the `events` table *is* the log.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Spec loading + validation (SPEC-01/02/03) | Core / Node process | — | Pure I/O + zod parse; no browser, no agent, no DB |
| Run manifest + input fingerprint (SPEC-04, STORE-02, TEL-01) | Core / Node process | Storage | Built at run start from resolved specs + asset bytes; persisted to `runs` row |
| Canonical `AgentEvent` union (TEL-01) | Core / contracts module | — | Plain TS types; imported by every phase, imports nothing concrete (D-23) |
| Append-only event log (TEL-01) | Storage (SQLite) | — | The `events` table IS the log (D-16); single-writer, WAL |
| SQLite schema + init (STORE-01) | Storage (SQLite) | — | 9 tables, rep-keyed, idempotent init guarded by `user_version` |
| Artifact store + DB link (STORE-01/03) | Filesystem + Storage | — | Bytes on disk under `results/<run_id>/`; DB stores relative path only (D-15) |
| Ports (`AgentPort`, `StoragePort`, …) | Core / contracts module | — | Interfaces only; concrete deps depend inward (D-23) |

## Standard Stack

All versions **locked in `.claude/CLAUDE.md` and re-verified against npm registry 2026-07-01**. Do not re-decide.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.13.1 | Runtime | Project constraint; native `fetch`, `node:crypto`, ESM. `node:sqlite` exists but stays experimental → not used. [VERIFIED: `node --version`] |
| TypeScript | 6.x | Language | `module: nodenext`, strict. [CITED: CLAUDE.md] |
| `zod` | 4.4.3 | Spec + manifest schema validation | TypeScript-first, `z.infer` gives typed spec objects (SPEC-02); `z.prettifyError` gives clear errors (SC#1). [VERIFIED: npm registry] |
| `yaml` | 2.9.0 | Parse `stack.yaml` / `scenario.yaml` | eemeli/yaml, best spec compliance; parse to plain object then hand to zod. [VERIFIED: npm registry] |
| `better-sqlite3` | 12.11.1 | Results DB | Synchronous API ideal for a CLI orchestrator; WAL; the DB is the product's canonical output. [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` (stdlib) | — | sha256 for input fingerprint (D-10/11) | Always — no dependency needed. `crypto.createHash('sha256')`. [VERIFIED: Node 24 stdlib] |
| `node:fs` / `node:path` (stdlib) | — | Read asset bytes, write artifacts, build `results/<run_id>/` layout | Always. [VERIFIED: stdlib] |

Model config is a **`.json` file** (D-07: `models/<name>.json`) — parse with `JSON.parse`, validate with zod. No YAML for models.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `better-sqlite3` | `node:sqlite` (built-in) | Near-identical sync API, but emits `ExperimentalWarning` on Node 24 — the results DB is the canonical output, don't build it on an experimental API. Migrate later if it stabilizes. [CITED: CLAUDE.md] |
| stdlib sha256 canonical-JSON | `json-stable-stringify` / `canonical-json` dep | A stable-key stringify is ~10 lines; no dependency needed for v1 (D-fingerprint is Claude's discretion). Add a lib only if canonicalization edge cases bite. |
| migration framework (drizzle/knex) | — | D-17 explicitly says **no migration framework in v1**; idempotent `CREATE TABLE IF NOT EXISTS` + `user_version` bump. |

**Installation:**
```bash
npm install zod@4.4.3 yaml@2.9.0 better-sqlite3@12.11.1
npm install -D typescript@6 tsx@4 vitest@4 @types/better-sqlite3 @types/node
```
(Pi SDK, Playwright, evaluators install in their own phases — not needed to satisfy Phase 1's success criteria. Manifest version-stamping *reads* their versions but does not import them at runtime; see Open Questions.)

## Package Legitimacy Audit

> Seam `package-legitimacy` was unavailable this session; audit performed inline from npm registry (`npm view <pkg> version`) + known reputation. All packages are the locked stack from CLAUDE.md, all long-established, all verified present at the pinned version.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `zod` | npm | 6+ yrs | ~30M/wk | github.com/colinhacks/zod | OK | Approved |
| `yaml` | npm | 9+ yrs | ~50M/wk | github.com/eemeli/yaml | OK | Approved |
| `better-sqlite3` | npm | 7+ yrs | ~2M/wk | github.com/WiseLibs/better-sqlite3 | OK | Approved (native addon — see note) |

**Native-addon note:** `better-sqlite3` has an install script `prebuild-install || node-gyp rebuild --release` [VERIFIED: `npm view`]. This is **normal** for a native addon (fetches a prebuilt binary, falls back to compiling). It is *not* a suspicious postinstall exfil vector. Requires a C++ toolchain only if no prebuilt binary matches the platform. Planner: no `checkpoint:human-verify` needed.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
  stacks/<n>.yaml ──┐    │  loadSpec()                              │
  scenarios/<n>/    ├──▶ │  yaml.parse / JSON.parse                 │
    *.yaml + assets │    │      │                                   │
  models/<n>.json ──┘    │      ▼                                   │
                         │  z.strictObject().safeParse              │
                         │      │ fail → z.prettifyError → throw    │  ◀── SC#1
                         │      ▼ ok                                │
                         │  typed Spec objects (z.infer)            │  ◀── SC#2
                         └──────┬──────────────────────────────────┘
                                │ resolved spec values
                                ▼
        asset bytes ───▶ ┌──────────────────────┐
   (prompt, mockup,      │  fingerprint()        │  sha256 over canonical
    expected png,        │  top-level + per-     │  values + raw bytes (D-10/11)
    skill files)         │  component hashes     │
                         └──────────┬────────────┘
                                    ▼
   env probes ───────▶   ┌──────────────────────┐
   (node ver, dep vers,  │  buildManifest()      │  spec snapshot + versions
    playwright/chromium, │  (D-12)               │  (separate from fingerprint)
    model id+params)     └──────────┬────────────┘
                                    │
                                    ▼
                         ┌───────────────────────────────────────────┐
                         │  SQLite (better-sqlite3, WAL, 1 writer)    │
                         │  runs (manifest snapshot + fingerprint)    │  ◀── SC#3
                         │  events (seq, type, ts, payload JSON) ◀────┼─── append-only log (TEL-01)
                         │  stacks/models/scenarios registry (D-18)   │
                         │  artifacts (kind, path, run_id, sha) ──────┼──┐
                         │  screenshots(spec. of artifacts) evaluations│  │
                         │  metrics tool_calls iterations (projections)│  │
                         └───────────────────────────────────────────┘  │ relative path only
                                    ▲                                    ▼
                                    │ link (path)          results/<run_id>/…  (bytes on disk)  ◀── SC#5
                                    └──────────────────────────────  D-15
```

Data flows one way: files → validated typed specs → fingerprint+manifest → DB rows + on-disk artifacts. No agent, no build, no browser render executes in this phase — those tiers plug into the ports later.

### Recommended Project Structure

Direction is locked by D-23 (ports import nothing concrete); exact folder names are Claude's discretion. A conventional shape:

```
src/
├── core/
│   ├── ports.ts          # AgentPort, StoragePort, EvaluatorPort — interfaces only (D-23)
│   ├── events.ts         # AgentEvent discriminated union + UnknownEvent (D-01/02)
│   └── ids.ts            # run_id generator: run-<ts>-<short> (D-22)
├── specs/
│   ├── schema.ts         # z.strictObject schemas for stack/scenario/model (D-08)
│   ├── load.ts           # loadSpec: yaml/json parse → safeParse → prettifyError
│   └── types.ts          # z.infer typed exports (SPEC-02)
├── manifest/
│   ├── fingerprint.ts    # sha256 over canonical values + asset bytes (D-10/11)
│   └── manifest.ts       # version stamps + spec snapshot (D-12)
└── storage/
    ├── db.ts             # better-sqlite3 open, WAL, init (D-16/17)
    ├── schema.sql.ts     # CREATE TABLE IF NOT EXISTS × 9 (D-13/14)
    └── artifacts.ts      # write to results/<run_id>/, return relative path (D-15/25)
```

### Pattern 1: Strict spec loading with a clear error (SPEC-01, SC#1, D-08)
**What:** Parse raw text → validate with a strict schema → on failure produce a human-readable multi-line error *before any run starts*.
**When to use:** Every spec loader (stack/scenario/model).
**Zod 4 note:** `.strict()` on `z.object()` is **deprecated in Zod 4** — use the top-level `z.strictObject()`. Unknown keys then produce an `unrecognized_keys` issue.
```typescript
// Source: https://zod.dev/v4/changelog (strict) + https://zod.dev/v4 (prettifyError) [CITED]
import { z } from "zod";
import YAML from "yaml";
import { readFileSync } from "node:fs";

const StackSchema = z.strictObject({          // rejects unknown keys (D-08)
  template: z.string(),
  install: z.string(),
  build: z.string(),
  start: z.string(),
  port: z.number().int().positive(),
  viewport: z.strictObject({ width: z.number().int(), height: z.number().int() }),
});
export type Stack = z.infer<typeof StackSchema>;   // typed spec object (SPEC-02, SC#2)

export function loadStack(path: string): Stack {
  const raw = YAML.parse(readFileSync(path, "utf8"));
  const result = StackSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid stack spec ${path}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

### Pattern 2: WAL + idempotent schema init guarded by user_version (STORE-01, SC#4, D-16/17)
**What:** Open the DB, enable WAL, create all 9 tables idempotently, gate future evolution on `user_version`.
```typescript
// Source: https://github.com/wiselibs/better-sqlite3/blob/master/docs/{performance,api}.md [CITED]
import Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");     // single-writer + concurrent readers (D-16)
  db.pragma("foreign_keys = ON");
  const v = db.pragma("user_version", { simple: true }) as number;
  if (v < SCHEMA_VERSION) {
    db.exec(SCHEMA_SQL);               // CREATE TABLE IF NOT EXISTS × 9
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  return db;
}
```

### Pattern 3: Append event, read back identically (TEL-01, SC#4, D-13)
**What:** Generic `events(run_id, seq, type, ts, payload JSON)` + promoted `tool_name`. Append and re-read yield an identical event.
```typescript
// Source: better-sqlite3 prepared statements + transaction [CITED]
const insertEvent = db.prepare(
  `INSERT INTO events (run_id, seq, type, ts, tool_name, payload)
   VALUES (@run_id, @seq, @type, @ts, @tool_name, @payload)`
);
// payload is JSON.stringify(event); read back → JSON.parse → deep-equal original.
```

### Pattern 4: Input fingerprint over bytes, stdlib only (SPEC-04, D-10/11)
```typescript
// Source: Node 24 node:crypto stdlib [VERIFIED]
import { createHash } from "node:crypto";
const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
// per-component: sha256(canonicalJSON(resolvedStack)), sha256(mockupBytes), …
// top-level: sha256 of the concatenated sorted per-component hashes (D-11)
```
`canonicalJSON` = `JSON.stringify` with recursively sorted keys (~10 lines; no dep).

### Anti-Patterns to Avoid
- **Using `.strict()` (Zod 3 idiom):** deprecated in Zod 4 → use `z.strictObject()`. [CITED: zod.dev/v4/changelog]
- **Hardcoding Angular/DeepSeek/dashboard in core:** violates declarative-first (D-07, PROJECT.md constraint). Fixtures shaped to the v1 row are fine; core logic must stay generic.
- **Storing artifact blobs in SQLite:** D-15 — store relative paths only.
- **A JSONL log synced to the DB:** D-16 — the `events` table *is* the canonical log; no second store to reconcile.
- **A migration framework in v1:** D-17 — `CREATE TABLE IF NOT EXISTS` + `user_version`.
- **Path-only fingerprint:** D-10 — hash the actual asset *bytes* or a swapped mockup goes undetected.
- **Importing Pi SDK / Playwright outside their adapter:** D-23 / AGENT-01 — ports are interfaces only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | custom parser | `yaml` 2.9.0 | Spec compliance, anchors, edge cases |
| Schema validation + typed output | manual type guards | `zod` 4 `z.infer` | One source for runtime check + static type (SPEC-02) |
| Human-readable validation error | manual `error.issues` walk | `z.prettifyError()` | First-class Zod 4 formatter (SC#1) |
| SQLite access / transactions | raw C bindings / async wrapper | `better-sqlite3` sync API + `db.transaction()` | Auto commit/rollback, prepared statements |
| Content hashing | custom hash | `node:crypto` sha256 | stdlib, deterministic |
| DB migrations | migration framework | `user_version` pragma + idempotent DDL | D-17; v1 has one version |

**Key insight:** Phase 1 is glue over four mature, boring libraries plus stdlib. The only genuinely new *code* is the contracts (event union, port interfaces, schema shapes) and the fingerprint/manifest logic — everything else is a thin call into an existing library.

## Common Pitfalls

(Full catalogue in `.planning/research/PITFALLS.md`. Phase-1-relevant subset below — the contracts here pre-empt the reproducibility & cost pitfalls.)

### Pitfall 1: Zod 3 → Zod 4 API drift
**What goes wrong:** Training-era code uses `.strict()`, `.passthrough()`, `errorMap`, `error.format()` — several changed in Zod 4.
**How to avoid:** `z.strictObject()` / `z.looseObject()`; `error:` function replaces `errorMap`; `z.prettifyError()` / `z.treeifyError()` for formatting. [CITED: zod.dev/v4/changelog]
**Warning signs:** deprecation warnings; unknown keys silently accepted (means you used plain `z.object()` not `z.strictObject()`).

### Pitfall 2: The reproducibility illusion (→ D-10/11/12)
**What goes wrong:** "same inputs → same score" quietly breaks because inputs weren't pinned/fingerprinted.
**How to avoid:** fingerprint the *bytes* the agent sees (D-10); stamp versions **separately** from the fingerprint (D-12) so an env change vs an input change is distinguishable.

### Pitfall 3: Cost/unit drift baked into the schema (→ D-26)
**What goes wrong:** mixed time units, storing computed dollars instead of raw usage.
**How to avoid (Phase 1 owns the schema shape):** timestamps = integer epoch ms UTC; durations = integer ms; cost = decimal USD verbatim from Pi. Store raw usage columns; cost is a derived view (D-26; the `events`/`evaluations` schema must allow it).

### Pitfall 4: SQLite write contention (v2 trigger, seam built now)
**What goes wrong:** parallel runs → `SQLITE_BUSY`.
**How to avoid:** WAL now (D-16); v1 is serial so it's fine, but funnel writes through a single connection/writer so v2's matrix needs no change. Set `busy_timeout` defensively.

## Code Examples

See Patterns 1–4 above (all with cited sources). Additional canonical snippet:

### run_id generation (D-22, sortable, reused as DB PK + dir names)
```typescript
// timestamp-prefixed sortable id; reused verbatim for tmp/<id>, results/<id>, DB PK
import { randomBytes } from "node:crypto";
export const newRunId = () =>
  `run-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
// e.g. run-20260701173500-a1b2c3  (lexical sort == chronological)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `z.object({...}).strict()` | `z.strictObject({...})` | Zod 4 (2025) | D-08 must use the new form or it silently deprecates |
| `error.format()` / `errorMap` | `z.treeifyError()` / `z.prettifyError()` / `error:` fn | Zod 4 | Clearer errors for SC#1 |
| `node-sqlite3` (async) | `better-sqlite3` (sync) | mature | Sync fits a CLI orchestrator; no async ceremony |
| store computed cost | store raw usage, derive cost | eval-harness practice | Re-priceable history (D-26) |

**Deprecated/outdated:**
- `@mariozechner/pi-coding-agent` → use `@earendil-works/pi-coding-agent` (not needed until Phase 4). [CITED: CLAUDE.md]
- Zod `.strict()` / `.passthrough()` / `errorMap` — deprecated in Zod 4.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 9 tables map to D-13/14/18/19/20/21/25 as: `runs` (manifest snapshot + fingerprint + status/failed_stage), `stacks`/`models`/`scenarios` registries, `events` (generic log), `artifacts` (generic), `screenshots` (specializes artifacts), `evaluations` (per evaluator), `metrics`/`tool_calls`/`iterations` (projections). Exact columns are Claude's discretion. | Standard Stack / Schema | Low — CONTEXT.md decisions fix the shape; only column names float |
| A2 | Model version/params for the manifest (D-12) come from the model config JSON (SPEC-03) at run start, not from a live Pi call in Phase 1. | Open Questions | Low — Phase 1 has no agent; live model metadata is a Phase 4 concern |
| A3 | Playwright/Chromium version for the manifest can be read from installed package metadata; actual capture may defer to when Playwright is wired (Phase 2). | Open Questions | Medium — if the planner assumes a live `browser.version()` here, Phase 1 would need Playwright as a dep it otherwise doesn't |
| A4 | Node 24's stdlib sha256 + a hand-rolled canonical-JSON is sufficient for the fingerprint; no canonical-json dependency needed. | Don't Hand-Roll | Low — canonicalization is ~10 lines; add a lib only if edge cases appear |

**If this table is empty:** it is not — 4 assumptions flagged for planner/discuss confirmation.

## Open Questions (RESOLVED)

*All three were resolved at planning and adopted by the plans — retained here for provenance.*

1. **How does the manifest capture Playwright/Chromium + model versions in a phase with no browser and no agent? (D-12)**
   - What we know: D-12 requires stamping node version, dep versions (or lockfile hash), Playwright+Chromium revision, model id+params.
   - What's unclear: whether Phase 1 *reads* these from installed package.json / lockfile / model config (static), or whether stamping is a function whose Playwright/Pi inputs are injected by later phases.
   - Recommendation: make `buildManifest()` accept the version data as parameters (a `VersionStamp` object) so Phase 1 defines the *shape* and captures what's statically available (node, dep versions, model config), and Phases 2/4 fill browser/live-model fields via the same function. Keeps Phase 1 free of Playwright/Pi imports (D-23).
   - **RESOLVED:** Adopted in plan **01-05 Task 2** — `buildManifest()` takes an injected `VersionStamp`; browser/live-model fields are `null` in Phase 1 (filled by later phases), no Playwright/Pi import.

2. **Canonical serialization algorithm for the fingerprint (Claude's discretion, D-10).**
   - Recommendation: recursive sorted-key `JSON.stringify` for spec values; raw `Buffer` for asset files. Hash each component, then hash the sorted list of component hashes for the top-level (D-11). Document the algorithm in the manifest so a future change is a methodology version bump.
   - **RESOLVED:** Adopted in plan **01-05 Task 1** — sorted-key canonical JSON + raw asset bytes hashed with stdlib `node:crypto` sha256.

3. **Promoted indexed columns on `events` beyond `tool_name` (Claude's discretion, D-13).**
   - Recommendation: index `(run_id, seq)` (primary ordering) and `(run_id, type)` (metric folds); add `tool_name` as promoted+indexed. Keep everything else in the JSON payload.
   - **RESOLVED:** Adopted in plan **01-03 Task 1** — `events` promotes/indexes `(run_id, seq)`, `(run_id, type)`, and `tool_name`; remaining fields stay in the JSON payload.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | 24.13.1 | — |
| npm | package install | ✓ | (bundled with Node 24) | — |
| C++ toolchain | `better-sqlite3` native build *if no prebuilt* | likely ✓ | — | prebuilt binary via `prebuild-install` (default path) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `better-sqlite3` compiles from source only if a prebuilt binary is missing for the platform; Node 24 on common Linux/macOS has prebuilts, so the C++ toolchain is a fallback path, not a requirement.

## Validation Architecture

> nyquist_validation is ENABLED for this phase.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` 4.x (per CLAUDE.md dev tools; native `node:test` is the zero-dep alternative) |
| Config file | none yet — Wave 0 creates `vitest.config.ts` (or use `node:test` with zero config) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPEC-01 | Malformed stack/scenario/model rejected with a clear zod error before any run | unit | `npx vitest run tests/specs.test.ts` (feed a fixture with an unknown/typo key → expect throw whose message contains the bad key via `z.prettifyError`) | ❌ Wave 0 |
| SPEC-02 | Valid specs load into typed objects consumed downstream | unit | `npx vitest run tests/specs.test.ts` (parse the v1 fixtures → assert typed fields; tsc `--noEmit` proves the `z.infer` types) | ❌ Wave 0 |
| SPEC-03 | Model config loads declaratively (no model hardcoded in core) | unit | `npx vitest run tests/specs.test.ts` (load `models/deepseek4pro.json` fixture) | ❌ Wave 0 |
| SPEC-04 / STORE-02 | Run start produces a stamped manifest (snapshot + versions + fingerprint) persisted to `runs` | unit | `npx vitest run tests/manifest.test.ts` (build manifest → assert fingerprint stable across two identical builds, differs when a mockup byte changes; read `runs` row back) | ❌ Wave 0 |
| TEL-01 / STORE-01 | 9-table schema inits in WAL; event appended reads back identically | unit | `npx vitest run tests/db.test.ts` (open in-memory/tmp db → assert `journal_mode=wal`, all 9 tables exist, insert event → `JSON.parse` read == original) | ❌ Wave 0 |
| STORE-03 | Artifact written to disk retrievable via DB link | unit | `npx vitest run tests/artifacts.test.ts` (write bytes to `results/<run_id>/x.png`, store relative path in `artifacts`, read path from DB → file bytes match) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <the-file-for-that-task>` (each < 5s; SQLite tmp/in-memory, no network).
- **Per wave merge:** `npx vitest run` (full suite) + `npx tsc --noEmit` (type gate proves SPEC-02 typed-object contract).
- **Phase gate:** full suite green + tsc clean before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `vitest.config.ts` (or decide on `node:test`) + `package.json`/`tsconfig.json` skeleton — nothing exists yet (greenfield).
- [ ] `tests/fixtures/` — a valid v1 row (`stacks/angular.yaml`, `scenarios/dashboard/*.yaml`+assets, `models/deepseek4pro.json`) **and** a deliberately malformed variant (unknown key) for SPEC-01.
- [ ] `tests/{specs,manifest,db,artifacts}.test.ts`.
- Framework install: `npm i -D vitest@4 typescript@6 tsx@4 @types/node @types/better-sqlite3`.

## Security Domain

> `security_enforcement: true`, ASVS level 1. Phase 1 is config-loading + local SQLite + local file writes — no auth, no session, no network, no secrets handling. The high-severity untrusted-code-execution pitfall belongs to **Phase 2** (when generated code runs), not here.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no users/auth in this platform) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | zod `z.strictObject` on every spec (D-08) — malformed/extra keys rejected before use |
| V6 Cryptography | partial | sha256 via `node:crypto` for fingerprint integrity (non-secret hashing; not password/crypto-secret storage — never hand-roll a hash) |
| V12 Files & Resources | **yes** | Artifact store writes under `results/<run_id>/` — see threat below |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `run_id` / artifact filename into `results/<...>` | Tampering | `run_id` is generated (D-22, `run-<ts>-<hex>`), not user input — safe; still, join+normalize artifact paths and assert they stay within `results/<run_id>/` before write. |
| SQL injection into the event log / rows | Tampering | Always use better-sqlite3 **prepared statements with bound params** (never string-concat SQL) — the schema-init `db.exec(SCHEMA_SQL)` is static DDL only. |
| Malicious/typo'd spec silently accepted | Tampering | `z.strictObject` rejects unknown keys (D-08); `safeParse` + throw before any downstream use. |
| YAML parsing of untrusted spec (billion-laughs / code exec) | DoS / Tampering | `yaml` (eemeli) does **not** execute arbitrary tags by default; parse to plain data then zod-validate. Specs are author-controlled in v1, low risk. |

No secrets are read or stored in Phase 1 (Pi/model API keys enter only in Phase 4). No `checkpoint:human-verify` security gates required for this phase.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view <pkg> version`), 2026-07-01 — all pinned versions confirmed (zod 4.4.3, better-sqlite3 12.11.1, yaml 2.9.0, playwright 1.61.1, pi-* 0.80.3, pixelmatch 7.2.0, pngjs 7.0.0).
- `node --version` → 24.13.1 (local).
- Context7 `/websites/zod_dev_v4` — `z.strictObject` replacing `.strict()`, `z.prettifyError`, `error:` replacing `errorMap`.
- Context7 `/wiselibs/better-sqlite3` — `pragma('journal_mode = WAL')`, `db.transaction()`, prepared statements, `pragma('user_version')`.
- `.claude/CLAUDE.md` — locked stack + Pi SDK reality-check (authoritative per project instructions).
- `.planning/research/{SUMMARY,PITFALLS}.md` — project-level architecture + pitfalls (reused, not duplicated).

### Secondary (MEDIUM confidence)
- `.planning/phases/01-foundations-contracts/01-CONTEXT.md` — 26 locked decisions (authoritative for contract shape).

### Tertiary (LOW confidence)
- Manifest browser/model version capture strategy (Open Question 1) — inferred; confirm during planning.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against live npm registry; libraries locked in CLAUDE.md.
- Architecture: HIGH — follows directly from 26 locked CONTEXT.md decisions + project research.
- API idioms (zod 4, better-sqlite3): HIGH — fetched from Context7 official-doc sources this session.
- Pitfalls: HIGH — established practice + project PITFALLS.md.
- Manifest version-capture mechanics: MEDIUM — see Open Question 1.

**Research date:** 2026-07-01
**Valid until:** ~2026-08-01 (stable libs; zod 4 / better-sqlite3 12 / Pi 0.80.x — re-verify Pi before Phase 4)
</content>
</invoke>
