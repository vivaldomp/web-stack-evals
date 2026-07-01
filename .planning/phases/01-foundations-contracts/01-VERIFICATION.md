---
phase: 01-foundations-contracts
verified: 2026-07-01T22:05:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: Foundations & Contracts Verification Report

**Phase Goal:** The agnostic core substrate exists — specs load and validate, every run gets a stamped manifest, and events/artifacts/results have a canonical home to write to. Everything downstream depends on these contracts.
**Verified:** 2026-07-01T22:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A malformed stack.yaml/scenario.yaml/model config is rejected with a clear zod validation error before any run starts | ✓ VERIFIED | `src/specs/schema.ts` uses `z.strictObject` (6 occurrences) for `StackSchema`/`ScenarioSchema`/`ModelSchema`/`ProvenanceSchema`. `src/specs/load.ts:parseAndValidate` runs `safeParse` and throws `Invalid spec ${path}:\n${z.prettifyError(...)}` on failure. `tests/specs.test.ts` loads `tests/fixtures/stacks/angular.bad.yaml` (which adds one typo'd key `viewport.widht`) and asserts the thrown message contains both the file path and the offending key `widht`. Test passes (`npm test` — 23/23 green). |
| 2 | Loading a valid stack.yaml + scenario.yaml + model config yields typed spec objects the rest of the system consumes (no stack/model/scenario hardcoded in core) | ✓ VERIFIED | `src/specs/types.ts` exports `Stack`/`Scenario`/`ModelConfig` via `z.infer`. `loadStack`/`loadScenario`/`loadModel` in `src/specs/load.ts` return these typed objects. Downstream `src/manifest/manifest.ts` imports `Stack`/`Scenario`/`ModelConfig` from `../specs/types.js` and consumes them in `BuildManifestInput` — no hardcoded stack/model/scenario values anywhere in `src/core` or `src/manifest`. `grep` confirms no stack/model literal values baked into core modules. |
| 3 | Starting a run produces a stamped run manifest (spec snapshot + dependency/model/browser versions + input fingerprint) persisted to the runs row | ✓ VERIFIED | `src/manifest/manifest.ts:buildManifest` assembles `{ runId, specSnapshot, fingerprint, versionStamp, createdAt }`; `persistManifest` INSERTs `manifest` (JSON), `fingerprint`, `fingerprint_components`, `version_stamp`, `started_at` into the `runs` row via a prepared statement. `tests/manifest.test.ts` persists a manifest into a tmp SQLite DB and asserts the read-back row's `fingerprint` equals `manifest.fingerprint.top` and `JSON.parse(row.manifest)` deep-equals the built manifest. Test passes. |
| 4 | The SQLite DB initializes with the full rep-keyed schema (runs, stacks, artifacts, events, metrics, screenshots, tool_calls, iterations, evaluations) in WAL/single-writer mode, and an event appended to the log reads back identically | ✓ VERIFIED | `src/storage/schema.sql.ts` contains 11 `CREATE TABLE IF NOT EXISTS` statements covering all 9 SC#4 tables plus `models`/`scenarios` registries. `src/storage/db.ts:openDb` sets `journal_mode = WAL`, `busy_timeout`, and idempotently execs `SCHEMA_SQL` guarded by `user_version`. `appendEvent`/`readEvents` use prepared statements (`prepare(...)`) with bound params — no string-concatenated SQL. `tests/db.test.ts` asserts WAL mode, all 11 tables present, idempotent re-open (no throw/duplication), and appends all 7 `AgentEvent` variants out-of-seq-order then asserts `readEvents` returns them seq-ordered and deep-equal (`toEqual`) to the originals, plus a duplicate-`(run_id,seq)` insert throws. All pass. |
| 5 | An artifact written to the on-disk store is retrievable via a link stored in the DB | ✓ VERIFIED | `src/storage/artifacts.ts:writeArtifact` writes bytes to `results/<runId>/<filename>`, computes sha256, and INSERTs a relative-path row (never the bytes) via a prepared statement; path-containment check throws before any mkdir/write for a traversing filename. `tests/artifacts.test.ts` round-trips write→`getArtifactPath`→`readFileSync` and asserts byte-identical recovery, asserts the DB stores a path string not bytes, and asserts a `../../evil.png` filename throws with zero filesystem/DB side effects. All pass. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/events.ts` | AgentEvent union w/ UnknownEvent passthrough | ✓ VERIFIED | Exports `AgentEvent` (7-variant discriminated union incl. `UnknownEvent`), `BaseEvent`, `RunStatus`. |
| `src/core/ports.ts` | AgentPort/StoragePort/EvaluatorPort, D-23 seam | ✓ VERIFIED | Interfaces only; `import type { AgentEvent } from "./events.js"` is the sole import — no runtime import of any concrete dep. |
| `src/core/ids.ts` | newRunId() sortable id | ✓ VERIFIED | `run-<14digit>-<6hex>` via `node:crypto randomBytes`; format/distinctness/sort tested. |
| `src/core/units.ts` | EpochMs/DurationMs/UsdCost aliases | ✓ VERIFIED | All three type aliases exported. |
| `src/specs/schema.ts` | Strict zod schemas | ✓ VERIFIED | `z.strictObject` x6 (Stack/Scenario/Model/Provenance/Viewport/expected). |
| `src/specs/types.ts` | z.infer typed exports | ✓ VERIFIED | `Stack`, `Scenario`, `ModelConfig`. |
| `src/specs/load.ts` | loadStack/loadScenario/loadModel | ✓ VERIFIED | parse→safeParse→prettifyError-throw shape confirmed. |
| `src/storage/schema.sql.ts` | SCHEMA_SQL + SCHEMA_VERSION | ✓ VERIFIED | 11 tables, 2 indexes. |
| `src/storage/db.ts` | openDb/appendEvent/readEvents | ✓ VERIFIED | WAL + user_version-guarded idempotent init; prepared statements only. |
| `src/storage/artifacts.ts` | writeArtifact/getArtifactPath | ✓ VERIFIED | Path-containment + sha256 + prepared statements. |
| `src/manifest/fingerprint.ts` | sha256/canonicalJSON/fingerprint | ✓ VERIFIED | Top-level + per-component hash, byte-change detection tested. |
| `src/manifest/manifest.ts` | VersionStamp/buildManifest/persistManifest | ✓ VERIFIED | No playwright/@earendil-works import (grep confirms 0 matches). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/core/ports.ts` | concrete deps | MUST NOT import runtime lib | ✓ WIRED (negative) | `grep -nE "from ['\"](better-sqlite3\|@earendil-works\|playwright\|yaml)" src/core/ports.ts` → no matches (exit 1). D-23 isolation seam holds. |
| `src/specs/load.ts` | `src/specs/schema.ts` | safeParse + z.prettifyError | ✓ WIRED | Confirmed in source; test proves throw path. |
| `src/storage/db.ts` | `src/storage/schema.sql.ts` | exec SCHEMA_SQL guarded by user_version | ✓ WIRED | Confirmed in source + idempotent-reopen test. |
| `src/storage/artifacts.ts` | `artifacts` table + disk | INSERT + writeFileSync | ✓ WIRED | Confirmed round-trip test. |
| `src/manifest/manifest.ts buildManifest` | `src/manifest/fingerprint.ts` | `fingerprint(...)` call | ✓ WIRED | Confirmed in source. |
| `src/manifest/manifest.ts persistManifest` | `runs` table | prepared INSERT | ✓ WIRED | Confirmed persist+read-back test. |
| `src/manifest/manifest.ts` | playwright / @earendil-works | MUST NOT import | ✓ WIRED (negative) | `grep -cE "from ['\"](playwright\|@earendil-works)" src/manifest/manifest.ts` → 0. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| SPEC-01 | 01-02 | Zod-validated stack.yaml | ✓ SATISFIED | StackSchema + loadStack + malformed-rejection test |
| SPEC-02 | 01-02 | Zod-validated scenario.yaml | ✓ SATISFIED | ScenarioSchema + loadScenario, provenance block present |
| SPEC-03 | 01-02 | Declarative model config, no hardcoded model | ✓ SATISFIED | ModelSchema + loadModel + deepseek4pro.json fixture |
| SPEC-04 | 01-05 | Stamped run manifest (spec+versions+fingerprint) | ✓ SATISFIED | buildManifest + persistManifest + tests |
| TEL-01 | 01-01, 01-03 | Append-only event log is source of truth | ✓ SATISFIED | AgentEvent union + events table + appendEvent/readEvents |
| STORE-01 | 01-03 | 9-table rep-keyed SQLite schema, WAL/single-writer | ✓ SATISFIED | schema.sql.ts (11 tables incl. registries) + openDb WAL |
| STORE-02 | 01-05 | Manifest/spec snapshot/version stamps on runs row | ✓ SATISFIED | persistManifest columns: manifest, fingerprint, fingerprint_components, version_stamp |
| STORE-03 | 01-04 | On-disk artifact store linked from DB | ✓ SATISFIED | writeArtifact/getArtifactPath + path-containment |

No orphaned requirements — all 8 IDs declared in plan frontmatter (TEL-01 appears in both 01-01 and 01-03, which is coherent: 01-01 defines the AgentEvent contract, 01-03 implements the persistence layer) exactly match REQUIREMENTS.md's Phase 1 traceability table (SPEC-01..04, TEL-01, STORE-01..03).

### Anti-Patterns Found

None. Scanned all `src/` and `tests/*.ts` files for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER`, `return null|{}|[]`, and `=> {}` — zero matches. No stub implementations detected.

### Behavioral Spot-Checks / Full Verification Run

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Type-check | `npx tsc --noEmit` | "No errors found" | ✓ PASS |
| Full test suite | `npm test` | 5 test files, 23/23 tests pass | ✓ PASS |
| D-23 seam (ports.ts) | `grep -nE "from ['\"](better-sqlite3\|@earendil-works\|playwright\|yaml)" src/core/ports.ts` | no match, exit 1 | ✓ PASS |
| D-23 seam (manifest.ts) | `grep -cE "from ['\"](playwright\|@earendil-works)" src/manifest/manifest.ts` | 0 | ✓ PASS |
| strictObject count | `grep -c strictObject src/specs/schema.ts` | 6 (≥4 required) | ✓ PASS |
| CREATE TABLE count | `grep -c "CREATE TABLE IF NOT EXISTS" src/storage/schema.sql.ts` | 11 (≥11 required) | ✓ PASS |
| Git commit history | `git log --oneline` | All 21 commits referenced in the 5 SUMMARY.md files present | ✓ PASS |

Full workspace test command was run once (`npm test`), not repeated per must-have.

### Human Verification Required

None. All 5 success criteria and all requirement IDs are verifiable via static inspection, type-checking, and the existing automated test suite — no visual, real-time, or external-service behavior is in scope for this phase.

### Gaps Summary

No gaps found. All 5 ROADMAP success criteria are observably true in the codebase (not just claimed in SUMMARY.md): zod-strict spec rejection with clear errors, typed spec consumption with nothing hardcoded in core, stamped manifests persisted to the runs row, the full 11-table rep-keyed WAL schema with lossless event round-trip, and artifact write/link/retrieve with path-traversal rejection. The D-23 isolation seam holds in both `src/core/ports.ts` (no concrete runtime import) and `src/manifest/manifest.ts` (no Playwright/Pi SDK import). All 8 requirement IDs (SPEC-01..04, TEL-01, STORE-01..03) are implemented, tested, and match REQUIREMENTS.md's traceability table with no orphans. `npx tsc --noEmit` and `npm test` (23/23) are green on the actual tree, independently re-run by this verifier (not taken from SUMMARY claims).

---

_Verified: 2026-07-01T22:05:00Z_
_Verifier: Claude (gsd-verifier)_
