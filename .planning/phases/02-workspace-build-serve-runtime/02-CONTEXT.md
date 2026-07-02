# Phase 2: Workspace + Build/Serve Runtime - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

A **raw stack template** runs through the full deterministic pipeline —
**copy → install → build → (lint/test) → serve → wait-ready → screenshot** —
inside a **disposable, isolated `tmp/<run_id>/` workspace**, producing a
screenshot saved to the artifact store, with **zero agent involvement**. This
proves the deterministic substrate under real processes before the flaky, paid
agent (Phase 4) ever lands.

**Requirements in scope:** WORK-01, WORK-02, WORK-03, WORK-04, BUILD-01,
BUILD-02, BUILD-03, BUILD-04.

Discussion clarified **HOW** to implement the workspace + build/serve/render
runtime within the fixed phase boundary. Libraries are already locked in
`.claude/CLAUDE.md` (`playwright`, `execa` for process-tree teardown,
`get-port`, `pixelmatch`/`pngjs` for the self-test) and were not re-decided.
Evaluators (Phase 3), the Pi adapter (Phase 4), and the orchestrator +
metric folding (Phase 5) are out of scope.

**Carried forward from Phase 1 (locked contracts — not re-opened):**
- Per-stage `install`/`build`/`start` lifecycle events, each `Started` +
  `Completed | Failed` with duration + exit code (**D-06**).
- `RunStatus` enum incl. `build_failed`/`start_failed`/`timeout` + `failedStage`,
  terminal `BenchmarkFinished` event — every exit is a scored, queryable row (**D-19**).
- `run_id` → `tmp/<run_id>/` workspace **and** `results/<run_id>/` artifact dir,
  same string everywhere (**D-22**).
- Artifacts on disk, DB stores **relative paths only**; `screenshots` specialize
  `artifacts` with `role`/viewport/dpr (**D-15/D-25**).
- Path-containment guard from Phase 1's artifact store is reused for all writes.
</domain>

<decisions>
## Implementation Decisions

### Workspace & Template (WORK-01/02/03)
- **D2-01:** The raw stack template is a **committed directory** at
  `stacks/angular/template/` — a real Angular skeleton with its own
  `package.json` **and committed `package-lock.json`**. The lockfile IS the
  version pin. **Copied fresh** into `tmp/<run_id>/` per run; the source
  template dir is never mutated.
- **D2-02:** Angular version = **latest stable at scaffold time, frozen by the
  committed lockfile** (not a deliberately named major). The manifest already
  stamps resolved dep versions (D-12), so the row stays reproducible until the
  template is deliberately refreshed.
- **D2-03:** Install = **`npm ci --ignore-scripts`** (WORK-03: lifecycle scripts
  disabled) with a **warm shared read-only npm cache** (`npm_config_cache`
  points at a cache dir warmed once). `node_modules` is per-run/isolated; the
  cache only avoids re-downloads and registry-blip flakiness — no isolation loss.
- **D2-04:** **Env-stripped spawn = minimal default-deny allowlist.** Children
  get only a fixed allowlist (e.g. `PATH`, `HOME`, `npm_config_cache`, `CI=1`,
  `NODE_ENV`, `npm_config_ignore_scripts`); everything else from the parent env
  is dropped so secrets/tokens can't leak into a run. (Exact list = planner
  discretion; policy is default-deny.)
- **D2-05:** **Workspace retention: keep `tmp/<run_id>/` on failure, delete on
  success.** Artifacts are already copied to `results/<run_id>/`; a failed run's
  workspace is left for post-mortem. `results/<run_id>/` is always kept.
- **D2-06:** **Isolation upheld by construction** — the runtime only ever writes
  under `tmp/<run_id>/` and `results/<run_id>/` (all paths derived from `run_id`
  + reused path-containment). Verified by a **dedicated self-test that hashes the
  project tree before/after** a run (assertion, not per-run overhead). No
  before/after guard on real runs.

### Serve & Screenshot Target (BUILD-01/03)
- **D2-07:** The runtime runs `build`, then runs whatever **`start` declares**,
  and screenshots that — **core stays stack-agnostic** (declarative-first,
  matches D-07). The stack authors `start` to serve the production build.
- **D2-08:** For the Angular v1 row, `start` = **`sirv dist/<app> --single --port 4200`**
  (`sirv-cli`, a **dev-dependency in the template, not core**). `--single`
  rewrites unknown routes → `index.html` so Angular client routing renders.
- **D2-09:** **Serve port = the port declared in `stack.yaml` (4200), literal.**
  v1 is a single sequential row → no collision risk. Dynamic allocation via
  `get-port` is deferred to v2 concurrency. Teardown uses **execa process-tree
  kill** regardless of port (WORK-04).

### Readiness & Determinism (BUILD-04)
- **D2-10:** **Readiness = a layered gate:** poll the URL until **HTTP 200**
  (server up, bounded by the start timeout) → Playwright **navigate waiting for
  `networkidle`** → **`await document.fonts.ready`** → **short fixed settle**.
  Generic, no per-scenario "ready" selector coupling.
- **D2-11:** **Determinism controls shipped in v1 (all of):**
  - **Viewport-clip at the declared size** (not full-page) → every screenshot has
    identical fixed dimensions, so Phase 3 PixelMatch (which throws on dimension
    mismatch) can compare directly.
  - **Kill motion:** Playwright `reducedMotion: 'reduce'` + injected CSS zeroing
    animations/transitions and hiding the text caret.
  - **Font stability:** `await document.fonts.ready` + **block external font CDNs**
    (or bundle fonts) so a slow/varying webfont load can't shift glyphs/layout.
  - **Freeze time/random:** stub `Date.now()` / `Math.random()` in the page so
    time- or random-seeded UI renders identically each shot.
- **D2-12:** **Browser = Playwright's bundled Chromium, new-headless mode,
  `deviceScaleFactor: 1`.** Chromium revision is pinned by the `playwright`
  package version in the lockfile and **recorded in the manifest** (D-12). No
  system-Chrome channel (would let the browser version float).

### Failure & Error Semantics (BUILD-01/02, D-19)
- **D2-13:** **Fatal stages = install / build / start + any per-stage timeout.**
  A fatal failure → scored outcome (`build_failed`/`start_failed`/`timeout`,
  `failedStage` set), **no screenshot**. Never an uncaught crash.
- **D2-14:** **Lint & test are non-fatal metric stages** — they record pass/fail
  (BUILD-02) but never block the screenshot; the screenshot proceeds whenever
  build + start succeed. Separates "does it run" from "is it clean".
- **D2-15:** **Runtime page errors (JS crash on a 200 page): captured as a
  non-fatal signal, still screenshot.** Playwright **console errors + uncaught
  exceptions + failed requests** are recorded (events/metric + a flag); the
  screenshot is still taken and the visual score reflects the broken page.
  Consistent with lint/test being metric-not-gate.

### Stages, Metrics & Logs (BUILD-01/02)
- **D2-16:** **Optional `lint` and `test` command fields** are added to
  `StackSchema` (`.strict()` per D-08). Angular declares
  `test: ng test --watch=false --browsers=ChromeHeadless` (one-shot headless — no
  Karma watch hang / real-browser dependency) and `lint: ng lint`. **Absent
  field = stage skipped.**
- **D2-17:** **Per-stage timeouts declared in `stack.yaml` with generous
  built-in fallbacks:** install 5m, build 5m, start/ready 90s, screenshot 30s,
  overall run cap ~15m. Roomy enough for a cold Angular build on a warm cache
  without false timeouts; still bounds true hangs.
- **D2-18:** **Phase-2 metrics captured:** per-stage **duration + exit code**
  (from the D-06 stage events), **lint/test pass-fail**, and **`dist/` build
  output size (bytes)**. Cheap, high-signal, no output-parsing. Parsed
  test/lint counts and richer event→metric folding = Phase 5.
- **D2-19:** **Logs:** one **combined `<stage>.log`** per stage (stdout+stderr
  interleaved as a human would see it), **capped at ~5 MB keeping the tail**
  (the end holds the error) so a runaway log can't fill disk.

### Structure & Entrypoint
- **D2-20:** **Phase-2 entrypoint = a pure `runStack(stackSpec, runId, storage)`
  function** returning a structured outcome, exercised **directly by integration
  tests** against the Angular fixture. **No CLI yet** — Phase 5's orchestrator
  (CLI-01) calls this same function unchanged.
- **D2-21:** **Concrete workspace/build/render modules now; add a core port
  interface only where a test-double needs one** (most likely a `RenderPort` so
  tests can stub Playwright). D-23 ports-inward direction holds either way; no
  speculative one-implementation interfaces (YAGNI).

### Claude's Discretion
Left to the planner — grounded in Phase 1 contracts + the decisions above:
- Exact `src/` module/folder layout for the workspace/build/render code.
- The precise env-var allowlist contents (D2-04 policy is default-deny).
- Exact log line formatting and the tail-cap byte value.
- The fixture app used by the determinism self-test and isolation self-test.
- `sirv-cli` version and the exact static-serve invocation details.
- Concrete zod field names for the new optional `lint`/`test` StackSchema fields.
- The short-settle duration and Playwright wait tuning in the readiness gate.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Vision & Scope (source of truth)
- `PRODUCT.md` (repo root) — full framework vision. §"2. Workspace Runtime"
  (the `tmp/run-XXX/{angular,logs,screenshots,artifacts}` layout), §"3.
  Application Runtime" (`npm install → build → start → Playwright → Screenshot`),
  and the proposed `src/{sandbox,runtime}` module names. **All produced
  artifacts are written in English despite this doc being Portuguese.**
- `.planning/ROADMAP.md` §"Phase 2" — phase goal + the **5 success criteria**
  this phase must make TRUE (fresh workspace/byte-identical main tree; ignore-scripts
  + env-strip + per-stage timeouts; failures as scored outcomes; Playwright
  screenshot at declared viewport, dpr=1; determinism self-test + clean teardown).
- `.planning/REQUIREMENTS.md` — WORK-01..04, BUILD-01..04 (the 8 REQ-IDs this
  phase owns) + traceability.
- `.planning/PROJECT.md` — GSD working context: core value, constraints, Key
  Decisions table.

### Phase 1 contracts this phase folds into (MUST honor)
- `.planning/phases/01-foundations-contracts/01-CONTEXT.md` — the 26 locked
  Phase-1 decisions. Especially D-06 (stage events), D-19 (status enum +
  failedStage), D-22 (`run_id` → tmp/ + results/ dirs), D-15/D-25 (artifacts on
  disk, screenshots specialize artifacts), D-12/D-26 (version stamping, ms/USD units).
- `src/core/events.ts` — `Stage = "install" | "build" | "start"`,
  `StageStarted/Completed/Failed`, `RunStatus`, `BenchmarkFinished`. The
  build/serve pipeline **emits these**; add no new event types without cause.
- `src/core/ports.ts` — `StoragePort` (`appendEvent`, `writeArtifact`,
  `getArtifactPath`, `persistManifest`) is how `runStack` persists events +
  screenshots + logs. `RenderPort` (if added, D2-21) lives here.
- `src/specs/schema.ts` — `StackSchema` (`template`, `install`, `build`, `start`,
  `port`, `viewport`, all `.strict()`). D2-16 adds optional `lint`/`test` here.
- `src/storage/artifacts.ts` — the path-containment'd on-disk artifact store;
  reused for screenshots + per-stage logs under `results/<run_id>/` (D2-06/D2-19).
- `src/manifest/manifest.ts` — where the pinned Playwright/Chromium revision +
  resolved dep versions are stamped (D2-12/D2-02).

### Locked tech stack (do NOT re-decide libraries)
- `.claude/CLAUDE.md` — pinned stack + "What NOT to Use". Relevant to Phase 2:
  `playwright@1.61` (library, not `@playwright/test`), `execa@9.6` (**reliable
  process-tree teardown** — critical for WORK-04), `get-port@7.2` (v2 only per
  D2-09), `pixelmatch@7` + `pngjs@7` (determinism self-test), `vitest@4.1`
  (integration + self-tests). Also the "Stack Patterns by Variant" notes:
  per-run `get-port` + execa process-tree kill; WAL SQLite tolerates concurrent
  readers.

No external ADRs exist yet — the decisions above ARE the Phase 2 implementation
record.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/storage/artifacts.ts`** — path-containment'd artifact store. Reuse
  verbatim for writing screenshots, per-stage logs, and copied generated code
  under `results/<run_id>/` (D2-06/D2-19); its containment guard is the same
  mechanism that keeps writes inside the sandbox.
- **`src/core/events.ts`** — the D-06 stage events + `BenchmarkFinished` already
  exist; `runStack` emits them, it does not define new ones.
- **`src/core/ids.ts`** — `run_id` generation (D-22); the single string that
  names the `tmp/` and `results/` dirs.
- **`src/manifest/`** — manifest builder already stamps versions; Phase 2 feeds
  it the Playwright/Chromium revision.
- **`src/specs/schema.ts` + `load.ts`** — extend `StackSchema` with optional
  `lint`/`test` (D2-16); loaders already parse-then-validate `.strict()`.

### Established Patterns
- **Declarative-first / core-agnostic** — the runtime honors `stack.yaml`
  commands (D2-07); no stack behavior is hardcoded in core.
- **Ports-and-adapters (D-23)** — concrete Playwright/execa live behind
  modules; a `RenderPort` is added only if a test-double needs it (D2-21).
- **Append-only event log → projections (D-16/D-24)** — Phase 2 **only writes
  events + raw values**; metric folding is Phase 5 (D2-18).
- **run_id-scoped everything (D-22)** — `tmp/<run_id>/`, `results/<run_id>/`.

### Integration Points
- **`runStack()`** is the seam Phase 5's orchestrator calls unchanged (D2-20).
- Phase 3 (evaluators) consumes the **generated screenshot** this phase writes;
  viewport-clip at declared size (D2-11) is what makes PixelMatch comparison
  dimension-safe.
- Phase 4 (Pi adapter) later populates the same `tmp/<run_id>/` workspace with
  agent-generated code, then this exact build/serve/render pipeline runs on it.
</code_context>

<specifics>
## Specific Ideas

- **v1 row fixed by the vision doc:** Angular template @ port 4200. Phase 2
  proves the pipeline on this raw template (no agent); Phase 4 later swaps the
  raw template contents for agent-generated code and reuses this runtime.
- **Determinism self-test:** a **vitest test on a fixed fixture app** — serve,
  screenshot twice, assert **≤ 0.1 % differing pixels** (PixelMatch, with a small
  per-pixel anti-alias threshold). CI/dev only, **zero per-run overhead**. This
  is how success criterion 5 is proven.
- **`tmp/<run_id>/` internal shape** mirrors PRODUCT.md §2: the copied app dir
  (e.g. `angular/`) alongside build output; logs + screenshots land in
  `results/<run_id>/`.
- **`results/<run_id>/` layout (typed subdirs):** `screenshots/generated.png`
  (role in filename), `logs/<stage>.log` (combined, tail-capped), `code/` (copied
  generated app), `meta.json`. Maps 1:1 to the `screenshots`/`artifacts` tables
  and feeds the Phase 5 HTML report.
</specifics>

<deferred>
## Deferred Ideas

Scope-creep guards held — everything below is already tracked in
REQUIREMENTS.md "v2 Requirements" / "Out of Scope" and needs no core change here:
- **Dynamic per-run port allocation (`get-port`)** — deferred to v2 concurrency
  (matrix/scheduler). v1 uses the declared port literally (D2-09).
- **Fully offline dependency mirror** — v2; v1 uses a warm shared npm cache (D2-03).
- **Per-stack fatal-stage flags** (`lintFatal`, etc.) — v2; v1 has fixed
  fatal/non-fatal semantics (D2-13/D2-14).
- **Per-run determinism gate** (screenshot-twice on every real run) — kept as a
  CI/dev fixture test only; per-run gating is unnecessary overhead (self-test
  placement decision).
- **Parsed lint/test counts + coverage, richer event→metric folding** — Phase 5
  / v2; Phase 2 captures durations + pass-fail + build size (D2-18).
- **Docker-per-run isolation (ISO-01)** — v2; local temp dir + `--ignore-scripts`
  + env-strip + timeouts are sufficient to start (D2-03/D2-04/D2-17).
- **Additional stacks/models/scenarios** — v2 matrix; specs are declarative so
  new rows need no runtime change.
</deferred>

---

*Phase: 2-Workspace + Build/Serve Runtime*
*Context gathered: 2026-07-01*
