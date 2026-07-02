# Phase 2: Workspace + Build/Serve Runtime - Research

**Researched:** 2026-07-01
**Domain:** Disposable process sandboxing (execa) + deterministic headless rendering (Playwright) for a Node/TS CLI runtime, applied to an Angular build/serve pipeline
**Confidence:** HIGH

## Summary

Phase 2 wires four external moving parts — `execa` process control, `playwright` headless
Chromium, `sirv-cli` static serving, and the Angular CLI build — into one deterministic
`runStack(stackSpec, runId, storage)` pipeline. All four libraries are pinned exact versions in
`package.json` and confirmed installed (`playwright@1.61.1`, `execa@9.6.1`, `get-port@7.2.0`,
`pixelmatch@7.2.0`, `pngjs@7.0.0`, `vitest@4.1.9`); Chromium is already downloaded to the
Playwright browser cache and `ng` (Angular CLI 22.0.5) is on `PATH`. No environment gaps block
implementation.

The single highest-value correction this research surfaces: **the Angular application builder
(the default builder since the esbuild migration) writes its output to
`dist/<project-name>/browser/`, not `dist/<project-name>/`.** D2-08's example command
(`sirv dist/<app> --single --port 4200`) must serve the `browser/` subfolder or `sirv` will 404
everything. Second: **Angular's default unit-test runner as of the stable v21 release is
Vitest, not Karma** — `ng test --watch=false --browsers=ChromeHeadless` (the D2-16 example) is a
Karma-era invocation that no longer matches a freshly scaffolded template; the modern equivalent
needs no `--browsers` flag at all. Third: **`ng lint` requires an explicit `ng add
@angular-eslint/schematics` during template scaffold** — modern `ng new` ships no lint builder by
default, so D2-16's `lint: ng lint` field would fail on an unmodified skeleton.

Playwright's own docs actively **discourage `waitUntil: 'networkidle'`** for anything but
one-off smoke checks, which directly informs the D2-10 layered readiness gate design — it's fine
as one signal in a layered gate (bounded, not the sole gate), but must never be the only wait.

**Primary recommendation:** Build the pipeline as five sequential, timeout-guarded async
functions (`copyWorkspace`, `runStage(install|build|start)`, `waitReady`, `renderScreenshot`,
`teardown`) behind a thin `RenderPort` (Playwright) so Phase 2's vitest suite can stub rendering
while still exercising the real `execa`/npm/Angular pipeline end-to-end against the committed
fixture template.

## Architectural Responsibility Map

This phase has no browser/API/CDN tiers in the usual web-app sense — it is a backend
orchestration pipeline whose "browser tier" is itself a controlled test subject, not a UI the
platform serves to users.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Workspace copy + isolation (WORK-01/02) | Workspace Runtime (`src/workspace/`) | Storage (results/ copy) | Owns `tmp/<run_id>/`; only this module writes there |
| Process spawn + env-strip + timeouts (WORK-03) | Workspace Runtime | — | `execa` calls live here, never in core |
| Process-tree teardown (WORK-04) | Workspace Runtime | — | Must own the subprocess handle to kill it |
| Build/serve stage sequencing (BUILD-01) | Workspace Runtime | Core (`events.ts` emission) | Sequencing is runtime logic; the *shape* of what's emitted is core |
| Served Angular app (`sirv` on :4200) | External Static Serve (the SUT, not the platform) | — | It's the benchmarked artifact being rendered, not part of the platform's own tiers |
| Readiness polling (D2-10) | Workspace Runtime | — | Fetches the SUT's own port; no core dependency |
| Screenshot capture (BUILD-03/04) | Render Runtime (`src/render/`, behind `RenderPort`) | Storage (artifact write) | Only this module imports `playwright` (mirrors D-23) |
| Runtime page-error capture (D2-15) | Render Runtime | Core (events) | Captured during the same Playwright session as the screenshot |
| Log/metric capture (D2-18/19) | Storage (`src/storage/artifacts.ts`) | Workspace Runtime (produces the lines) | Reuses the Phase-1 path-contained artifact writer verbatim |
| Determinism + isolation self-tests (D2-06/BUILD-04) | Test tier (`tests/`) | Render Runtime, Workspace Runtime | Exercises both runtimes but lives outside `src/` |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Workspace & Template (WORK-01/02/03)**
- D2-01: The raw stack template is a committed directory at `stacks/angular/template/` — a real Angular skeleton with its own `package.json` and committed `package-lock.json`. The lockfile IS the version pin. Copied fresh into `tmp/<run_id>/` per run; the source template dir is never mutated.
- D2-02: Angular version = latest stable at scaffold time, frozen by the committed lockfile (not a deliberately named major). The manifest already stamps resolved dep versions (D-12), so the row stays reproducible until the template is deliberately refreshed.
- D2-03: Install = `npm ci --ignore-scripts` (WORK-03: lifecycle scripts disabled) with a warm shared read-only npm cache (`npm_config_cache` points at a cache dir warmed once). `node_modules` is per-run/isolated; the cache only avoids re-downloads and registry-blip flakiness — no isolation loss.
- D2-04: Env-stripped spawn = minimal default-deny allowlist. Children get only a fixed allowlist (e.g. `PATH`, `HOME`, `npm_config_cache`, `CI=1`, `NODE_ENV`, `npm_config_ignore_scripts`); everything else from the parent env is dropped so secrets/tokens can't leak into a run. (Exact list = planner discretion; policy is default-deny.)
- D2-05: Workspace retention: keep `tmp/<run_id>/` on failure, delete on success. Artifacts are already copied to `results/<run_id>/`; a failed run's workspace is left for post-mortem. `results/<run_id>/` is always kept.
- D2-06: Isolation upheld by construction — the runtime only ever writes under `tmp/<run_id>/` and `results/<run_id>/` (all paths derived from `run_id` + reused path-containment). Verified by a dedicated self-test that hashes the project tree before/after a run (assertion, not per-run overhead). No before/after guard on real runs.

**Serve & Screenshot Target (BUILD-01/03)**
- D2-07: The runtime runs `build`, then runs whatever `start` declares, and screenshots that — core stays stack-agnostic (declarative-first, matches D-07). The stack authors `start` to serve the production build.
- D2-08: For the Angular v1 row, `start` = `sirv dist/<app> --single --port 4200` (`sirv-cli`, a dev-dependency in the template, not core). `--single` rewrites unknown routes → `index.html` so Angular client routing renders.
- D2-09: Serve port = the port declared in `stack.yaml` (4200), literal. v1 is a single sequential row → no collision risk. Dynamic allocation via `get-port` is deferred to v2 concurrency. Teardown uses execa process-tree kill regardless of port (WORK-04).

**Readiness & Determinism (BUILD-04)**
- D2-10: Readiness = a layered gate: poll the URL until HTTP 200 (server up, bounded by the start timeout) → Playwright navigate waiting for `networkidle` → `await document.fonts.ready` → short fixed settle. Generic, no per-scenario "ready" selector coupling.
- D2-11: Determinism controls shipped in v1 (all of): viewport-clip at the declared size (not full-page); kill motion (`reducedMotion: 'reduce'` + injected CSS zeroing animations/transitions and hiding the text caret); font stability (`await document.fonts.ready` + block external font CDNs); freeze time/random (stub `Date.now()` / `Math.random()`).
- D2-12: Browser = Playwright's bundled Chromium, new-headless mode, `deviceScaleFactor: 1`. Chromium revision is pinned by the `playwright` package version in the lockfile and recorded in the manifest (D-12). No system-Chrome channel.

**Failure & Error Semantics (BUILD-01/02, D-19)**
- D2-13: Fatal stages = install / build / start + any per-stage timeout. A fatal failure → scored outcome (`build_failed`/`start_failed`/`timeout`, `failedStage` set), no screenshot. Never an uncaught crash.
- D2-14: Lint & test are non-fatal metric stages — they record pass/fail (BUILD-02) but never block the screenshot; the screenshot proceeds whenever build + start succeed.
- D2-15: Runtime page errors (JS crash on a 200 page): captured as a non-fatal signal, still screenshot. Playwright console errors + uncaught exceptions + failed requests are recorded; the screenshot is still taken and the visual score reflects the broken page.

**Stages, Metrics & Logs (BUILD-01/02)**
- D2-16: Optional `lint` and `test` command fields are added to `StackSchema` (`.strict()` per D-08). Angular declares `test: ng test --watch=false --browsers=ChromeHeadless` and `lint: ng lint`. Absent field = stage skipped.
- D2-17: Per-stage timeouts declared in `stack.yaml` with generous built-in fallbacks: install 5m, build 5m, start/ready 90s, screenshot 30s, overall run cap ~15m.
- D2-18: Phase-2 metrics captured: per-stage duration + exit code (from the D-06 stage events), lint/test pass-fail, and `dist/` build output size (bytes).
- D2-19: Logs: one combined `<stage>.log` per stage (stdout+stderr interleaved), capped at ~5 MB keeping the tail.

**Structure & Entrypoint**
- D2-20: Phase-2 entrypoint = a pure `runStack(stackSpec, runId, storage)` function returning a structured outcome, exercised directly by integration tests against the Angular fixture. No CLI yet.
- D2-21: Concrete workspace/build/render modules now; add a core port interface only where a test-double needs one (most likely a `RenderPort`). No speculative one-implementation interfaces (YAGNI).

### Claude's Discretion
- Exact `src/` module/folder layout for the workspace/build/render code.
- The precise env-var allowlist contents (D2-04 policy is default-deny).
- Exact log line formatting and the tail-cap byte value.
- The fixture app used by the determinism self-test and isolation self-test.
- `sirv-cli` version and the exact static-serve invocation details.
- Concrete zod field names for the new optional `lint`/`test` StackSchema fields.
- The short-settle duration and Playwright wait tuning in the readiness gate.

### Deferred Ideas (OUT OF SCOPE)
- Dynamic per-run port allocation (`get-port`) — deferred to v2 concurrency. v1 uses the declared port literally (D2-09).
- Fully offline dependency mirror — v2; v1 uses a warm shared npm cache (D2-03).
- Per-stack fatal-stage flags (`lintFatal`, etc.) — v2; v1 has fixed fatal/non-fatal semantics (D2-13/D2-14).
- Per-run determinism gate (screenshot-twice on every real run) — kept as a CI/dev fixture test only.
- Parsed lint/test counts + coverage, richer event→metric folding — Phase 5 / v2.
- Docker-per-run isolation (ISO-01) — v2; local temp dir + `--ignore-scripts` + env-strip + timeouts are sufficient to start.
- Additional stacks/models/scenarios — v2 matrix; specs are declarative so new rows need no runtime change.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WORK-01 | Create a disposable temp workspace per run (`tmp/run-XXX/`) | "Workspace & Isolation" below — `copyWorkspace` pattern using `run_id` from `src/core/ids.ts`; no new library needed (`node:fs.cpSync`) |
| WORK-02 | A run never mutates the main project | Isolation self-test pattern (hash tree before/after) in "Determinism + Isolation Self-Tests" |
| WORK-03 | Execute generated code with isolation mitigations (`npm ci --ignore-scripts`, env-stripped spawn, per-stage timeouts) | "Install + Isolation" + "execa Process-Tree Teardown" sections — exact `execa` option set |
| WORK-04 | Clean teardown — no orphaned dev-server processes or held ports across runs | "execa Process-Tree Teardown (WORK-04)" — `detached` + process-group kill pattern, confirmed against execa 9.6 docs |
| BUILD-01 | Run install → build → start → wait-ready with per-stage timeouts; failures recorded as scored outcomes, not crashes | "Layered Readiness Gate" + "Failure & Error Semantics" pitfalls — maps to existing `Stage`/`RunStatus` types, no new event shapes |
| BUILD-02 | Capture build/lint/test results as metrics | "Angular Template Scaffold" — corrected `test`/`lint` commands for the real Angular 22 default toolchain |
| BUILD-03 | Screenshot the running app with headless Playwright at the declared viewport and `deviceScaleFactor: 1` | "Playwright Determinism" — `newContext({viewport, deviceScaleFactor:1})` + `page.screenshot({clip})` |
| BUILD-04 | Screenshot determinism controls (fixed viewport/DPR, disable animation/motion, pinned/bundled fonts); baseline uses the same pinned renderer as the run | "Playwright Determinism" + "Determinism Self-Test" — pixelmatch threshold pattern |
</phase_requirements>

## Standard Stack

### Core (already locked — versions confirmed installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `playwright` | 1.61.1 [VERIFIED: npm registry, installed locally] | Headless render + screenshot | Bundled Chromium new-headless mode, deterministic viewport control |
| `execa` | 9.6.1 [VERIFIED: npm registry, installed locally] | Spawn install/build/start with reliable cleanup | Default rejects shell injection (no `shell:true`), documented `cleanup`/`detached`/`forceKillAfterDelay` termination model |
| `pixelmatch` | 7.2.0 [VERIFIED: npm registry, installed locally] | Determinism self-test pixel diff | Smallest/fastest RGBA diff lib, exact API confirmed below |
| `pngjs` | 7.0.0 [VERIFIED: npm registry, installed locally] | Decode/encode PNG buffers for pixelmatch | pixelmatch's documented companion |
| `vitest` | 4.1.9 [VERIFIED: npm registry, installed locally] | Integration + self-tests | Default `testTimeout` is 5000ms [CITED: vitest v4.1.6 docs] — **must be overridden for this phase's tests** (see Pitfall 6) |

### Template-only (dev-dependencies of `stacks/angular/template/`, NOT platform core deps)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sirv-cli` | 3.0.1 [VERIFIED: npm registry] | Production static serve for `start` (D2-08) | Angular template's `start` script only |
| `@angular/cli` | 22.0.5 [VERIFIED: npm registry, `ng` on PATH locally] | Scaffold + build + test + lint the template | One-time scaffold + template's own `build`/`test`/`lint` scripts |

### Not needed in v1 (confirm before adding)
| Library | Reason |
|---------|--------|
| `get-port` | D2-09 explicitly defers dynamic port allocation to v2; v1 uses the literal port 4200. Do not wire it in yet — it would be dead code violating YAGNI. |
| `sharp` | Only needed if expected/actual screenshot dimensions can differ; D2-11's fixed viewport-clip makes this a non-issue for v1. |

**Installation:** All Standard Stack libraries are already present in `package.json`/`node_modules` (Phase 1 install). Only the template's own `stacks/angular/template/package.json` needs `sirv-cli` (devDependency) and the Angular scaffold — created via `ng new` + `npm install -D sirv-cli` + `ng add @angular-eslint/schematics` once, then committed.

**Version verification performed:**
```
npm view playwright version   → 1.61.1
npm view execa version        → 9.6.1
npm view get-port version     → 7.2.0
npm view pixelmatch version   → 7.2.0
npm view pngjs version        → 7.0.0
npm view sirv-cli version     → 3.0.1
npm view @angular/cli version → 22.0.5
```
All match `package.json`/`.claude/CLAUDE.md` pins exactly — no drift since Phase 1.

## Package Legitimacy Audit

Only two packages are newly introduced in this phase (everything else was already vetted/installed in Phase 1): `sirv-cli` and `@angular/cli` (as the template scaffolding tool). Both checked against the npm registry directly (`npm view`, `npm view <pkg> scripts.postinstall`, npmjs downloads API) since the `package-legitimacy` seam is not available in this environment's installed `gsd-tools` (fell back to direct registry verification, see Verification Protocol note).

| Package | Registry | Age | Downloads (last week) | Source Repo | Postinstall script | Verdict | Disposition |
|---------|----------|-----|------------------------|-------------|---------------------|---------|--------------|
| `sirv-cli` | npm | ~8 yrs (created 2018-05-14) | 104,409 | `github.com/lukeed/sirv` | none | OK | Approved |
| `@angular/cli` | npm | ~9 yrs (created 2017-02-01) | 5,108,191 | `github.com/angular/angular-cli` | none | OK | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
stack.yaml (Stack spec, D2-16 extended)
      │
      ▼
runStack(stackSpec, runId, storage)              ← D2-20 pure entrypoint
      │
      ├─► copyWorkspace()                         WORK-01/02
      │      stacks/angular/template/ ──cp──► tmp/<run_id>/angular/
      │
      ├─► runStage("install")  execa("npm", ["ci","--ignore-scripts"], {
      │        cwd: tmp/<run_id>/angular, env: allowlistOnly, timeout: 5m })
      │        │
      │        ├─success─► StageCompleted event ──► next stage
      │        └─failure/timeout─► StageFailed event ─► BenchmarkFinished(build_failed|timeout) ─► STOP (no screenshot)
      │
      ├─► runStage("build")  execa("npx", ["ng","build"], {...})
      │        writes tmp/<run_id>/angular/dist/<app>/browser/
      │        │
      │        └─failure/timeout─► BenchmarkFinished(build_failed|timeout) ─► STOP
      │
      ├─► runStage("lint") / runStage("test")   [non-fatal, D2-14]
      │        pass/fail recorded as metric, pipeline continues regardless
      │
      ├─► runStage("start")  execa("npx", ["sirv","dist/<app>/browser","--single","--port","4200"], {
      │        detached:true (POSIX process group), cwd, env, timeout: 90s })
      │        │
      │        └─crash before ready─► BenchmarkFinished(start_failed) ─► STOP
      │
      ├─► waitReady(port)                        D2-10 layered gate
      │      poll fetch(url) until 200 (bounded)
      │      → page.goto(url, {waitUntil:'networkidle'})
      │      → await page.evaluate(() => document.fonts.ready)
      │      → short fixed settle (e.g. 250ms)
      │        │
      │        └─timeout─► BenchmarkFinished(timeout, failedStage:"start") ─► teardown ─► STOP
      │
      ├─► renderScreenshot(page)                 RenderPort, BUILD-03/04
      │      applyDeterminism(page): addInitScript (Date/Math.random),
      │        inject CSS (kill animations/caret), block font-CDN routes
      │      page.on('console'|'requestfailed'), context.on('weberror')  → non-fatal signal, D2-15
      │      page.screenshot({ clip: {x:0,y:0,...viewport}, path })
      │        │
      │        └─► storage.writeArtifact(runId, "screenshot", "generated.png", bytes)
      │
      ├─► teardown()                              WORK-04, always runs (success or failure)
      │      kill start subprocess's whole process group (SIGTERM → SIGKILL after grace)
      │      close Playwright browser/context
      │        │
      │        └─► verify: port free, no living child pid
      │
      └─► BenchmarkFinished(status, failedStage)  ─► events log ─► (D2-05) delete tmp/ on success, keep on failure
```

### Recommended Project Structure
```
src/
├── core/            # existing (events.ts, ports.ts, ids.ts, units.ts) — unchanged
├── specs/            # existing — extend schema.ts with lint/test (D2-16)
├── storage/          # existing artifacts.ts — reused verbatim for logs + screenshots
├── manifest/         # existing — feed Playwright/Chromium revision (D2-12) here
├── workspace/         # NEW — copyWorkspace, path derivation from run_id
│   ├── copy.ts
│   └── teardown.ts
├── runtime/            # NEW — stage sequencing + execa spawn wrapper
│   ├── stage.ts        # runStage(): spawn + timeout + event emission + log capture
│   ├── env.ts          # buildAllowlistedEnv()
│   └── readiness.ts    # waitReady(): fetch-poll + handoff
├── render/             # NEW — the only module that imports playwright (D-23/D2-21)
│   ├── renderPort.ts   # RenderPort interface (core/ports.ts style, or colocated)
│   ├── playwrightRenderer.ts
│   └── determinism.ts  # addInitScript + CSS injection + font blocking
└── pipeline/           # NEW — runStack() orchestration (D2-20 entrypoint)
    └── runStack.ts

stacks/
└── angular/
    └── template/        # NEW — committed Angular skeleton (D2-01)
        ├── package.json
        ├── package-lock.json
        ├── angular.json
        └── src/...

tests/
├── fixtures/            # determinism + isolation self-test fixture app
├── runStack.integration.test.ts
└── determinism.selftest.test.ts
```

### Pattern 1: Timeout-Guarded Stage Runner
**What:** Every stage (install/build/lint/test/start) goes through one function that spawns via
`execa`, enforces the D2-17 timeout, captures combined stdout+stderr to a tail-capped log, and
emits the D-06 `StageStarted`/`StageCompleted`/`StageFailed` events — never throws past the
caller.
**When to use:** All five build/serve stages, uniformly.
**Example:**
```typescript
// Pattern synthesized from execa v9.6 docs (github.com/sindresorhus/execa/docs/termination.md,
// docs/bash.md) + D-06 event shapes (src/core/events.ts)
import { execa, type Result } from "execa";
import type { Stage } from "../core/events.js";

interface StageOutcome {
  stage: Stage;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  logTail: string; // last ~5MB kept, per D2-19
}

async function runStage(
  stage: Stage,
  file: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<StageOutcome> {
  const start = Date.now();
  try {
    // Array-form call (no `shell: true`) — execa's own docs call shells
    // "unsafe [and] can allow command injection"; array form never spawns
    // a shell, so stack.yaml command strings never need escaping.
    const result: Result = await execa(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      extendEnv: false,        // D2-04: discard parent env entirely
      timeout: opts.timeoutMs, // execa sends killSignal (default SIGTERM) at this point
      reject: false,           // inspect exitCode ourselves — never throw for a normal failure
      all: true,               // interleaved stdout+stderr in result.all (D2-19)
    });
    return {
      stage,
      exitCode: result.exitCode ?? 1,
      durationMs: Date.now() - start,
      timedOut: result.timedOut ?? false,
      logTail: tailCap(result.all ?? "", 5 * 1024 * 1024),
    };
  } catch (err) {
    // Only reachable for spawn-level failures (ENOENT etc.), not exit-code failures
    return { stage, exitCode: 1, durationMs: Date.now() - start, timedOut: false, logTail: String(err) };
  }
}
```

### Pattern 2: Env Allowlist Builder (D2-04)
**What:** Build a minimal, default-deny env object once per run; never spread `process.env`.
**Example:**
```typescript
// npm_config_cache / npm_config_ignore_scripts naming confirmed against
// github.com/npm/cli/blob/latest/docs/lib/content/using-npm/config.md:
// "Environment variables starting with npm_config_ are automatically
// interpreted by npm as configuration parameters... dashes replaced with underscores."
function buildAllowlistedEnv(npmCacheDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    npm_config_cache: npmCacheDir,
    npm_config_ignore_scripts: "true",
    CI: "1",
    NODE_ENV: "production",
  };
}
```

### Pattern 3: Layered Readiness Gate (D2-10)
**What:** Bounded HTTP poll before ever touching Playwright, then a Playwright-side settle.
**Example:**
```typescript
// Node 24 native fetch + AbortSignal.timeout — no library needed (stdlib since Node 17.3/18).
async function waitForHttp200(url: string, startTimeoutMs: number): Promise<void> {
  const deadline = Date.now() + startTimeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return;
    } catch (err) {
      lastError = err; // server not up yet — expected during early polling
    }
    await new Promise((r) => setTimeout(r, 250)); // fixed 250ms backoff
  }
  throw new Error(`Server never responded 200 within ${startTimeoutMs}ms: ${String(lastError)}`);
}

// Handoff to Playwright, per D2-10's second/third/fourth layers:
async function navigateAndSettle(page: import("playwright").Page, url: string): Promise<void> {
  // Playwright's own docs mark 'networkidle' DISCOURAGED for test assertions —
  // acceptable here only because it's one bounded layer in a gate, not the sole wait.
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 250)); // short fixed settle, D2-10
}
```

### Pattern 4: Determinism Controls (D2-11/D2-12)
**What:** Freeze time/randomness before any app script runs, kill motion, block webfont CDNs, fix
viewport/DPR/browser.
**Example:**
```typescript
// context.addInitScript() confirmed (docs/src/api/class-browsercontext.md, v1.61.0):
// "The script is evaluated after the document was created but before any of its
// scripts were run. This is useful to amend the JavaScript environment, e.g. to
// seed Math.random."
const browser = await chromium.launch({
  channel: "chromium", // opt into new headless mode — confirmed release-notes v1.49+,
                        // still opt-in via `channel`, not the default `headless: true` bundle
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: stack.viewport.width, height: stack.viewport.height },
  deviceScaleFactor: 1,
  reducedMotion: "reduce", // emulates prefers-reduced-motion: reduce
});

await context.addInitScript(() => {
  const fixedNow = 1735689600000; // frozen epoch ms, arbitrary fixed instant
  Date.now = () => fixedNow;
  const OriginalDate = Date;
  // @ts-expect-error – deliberate override for determinism
  Date = class extends OriginalDate {
    constructor(...args: any[]) {
      // @ts-expect-error
      super(...(args.length ? args : [fixedNow]));
    }
    static now() { return fixedNow; }
  };
  let seed = 42;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
});

// Kill CSS animations/transitions + caret, confirmed pattern (no doc citation needed —
// plain CSS, not a Playwright API):
await context.addInitScript(() => {
  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }
  `;
  document.head?.appendChild(style) ?? document.documentElement.appendChild(style);
});

// Block external font CDN requests (confirmed pattern, docs/src/network.md):
const page = await context.newPage();
await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
```

### Pattern 5: Process-Tree Teardown (WORK-04)
**What:** Guarantee no orphaned dev-server descendants and no held port after the `start` stage
ends, whether it exited cleanly, crashed, or was killed on timeout.
**Example:**
```typescript
// execa 9.6 confirmed behavior (docs/environment.md, test/terminate/cleanup.js,
// docs/termination.md):
// - `detached: true` on POSIX makes the child the leader of a new process group
//   (subprocess.pid === the group id); Node's own child_process docs document
//   process.kill(-pid) as the way to signal the whole group.
// - execa's own `cleanup` option (default true) kills the DIRECT child on parent
//   exit but does NOT walk descendants — npm/ng/sirv can fork grandchildren that
//   `cleanup` alone won't reach. Combining `detached: true` + explicit group kill
//   is what actually reaches the whole tree.
// - `forceKillAfterDelay` defaults to 5000ms: if the tree ignores SIGTERM, execa
//   (or our own fallback) escalates to SIGKILL after 5s. Not supported on Windows
//   (docs explicitly call this out) — acceptable, this project targets Linux/macOS dev.
const subprocess = execa(file, args, {
  cwd,
  env,
  extendEnv: false,
  detached: true,      // POSIX: subprocess.pid becomes the process group id
  cleanup: true,        // still kill the direct child if OUR process exits unexpectedly
  forceKillAfterDelay: 5000,
});

function killProcessTree(subprocess: import("execa").ResultPromise): void {
  if (subprocess.pid === undefined) return;
  try {
    process.kill(-subprocess.pid, "SIGTERM"); // negative pid = whole process group (POSIX)
  } catch {
    subprocess.kill("SIGTERM"); // fallback: at least kill the direct child
  }
}
```
**Verification after teardown:** attempt a fresh `fetch("http://localhost:4200")` — it must
reject/refuse (ECONNREFUSED), proving the port is free.

### Anti-Patterns to Avoid
- **`execa(commandString, { shell: true })` for stack.yaml commands:** execa's own docs state
  shells "can be unsafe by potentially allowing command injection" and disable execa's automatic
  escaping. Split `install`/`build`/`start` strings on whitespace into `[file, ...args]` and call
  `execa(file, args, opts)` — the default (no shell) form.
- **Relying on `waitUntil: 'networkidle'` alone for readiness:** Playwright's docs literally say
  "DISCOURAGED... rely on web assertions instead." Use it only as one bounded layer inside the
  D2-10 gate, after the HTTP-200 poll already proved the server is up.
- **`sirv dist/<app>` (no `/browser`):** the modern `@angular/build:application` builder nests
  output one level deeper than the older browser builder did.
- **Spreading `...process.env` anywhere in the spawn options:** defeats D2-04 entirely; always
  build the allowlist object explicitly and pass `extendEnv: false`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process-tree kill / zombie prevention | A custom `ps`-tree-walking killer | `execa`'s `detached` + POSIX group-kill (`process.kill(-pid)`) + `forceKillAfterDelay` | Cross-platform edge cases (defunct zombies, SIGKILL semantics) are already solved and tested upstream |
| Pixel-level image diffing | A custom RGBA loop comparator | `pixelmatch` + `pngjs` | Anti-alias detection + perceptual (YIQ) diff already tuned; hand-rolled loops miss AA false-positives |
| Static SPA file serving with client-route fallback | A hand-written `http.createServer` + manual rewrite-to-index.html logic | `sirv-cli --single` | `opts.single` already implements the exact lookup chain (`/about`, `/about.html`, `/about/index.html`, fallback) correctly |
| Readiness polling backoff | A bespoke retry/backoff library | Native `fetch` + `AbortSignal.timeout` + a fixed `setTimeout` loop | Node 24 ships this natively; no dependency justified for ~10 lines |

**Key insight:** Every "don't hand-roll" item above already has a locked, pinned library in
`.claude/CLAUDE.md` — the risk in this phase isn't picking the wrong library, it's mis-wiring the
*options* (shell mode, detached mode, output path) around an otherwise-correct library choice.

## Common Pitfalls

### Pitfall 1: Angular application builder output path has a `browser/` subfolder
**What goes wrong:** `sirv dist/<app> --single --port 4200` (D2-08's literal example) serves an
empty/wrong directory and every request 404s, because the actual static assets live one level
deeper.
**Why it happens:** The `@angular/build:application` builder (default since the esbuild
migration, confirmed current in Angular CLI 22) changed the output location from
`dist/<project-name>/` to `dist/<project-name>/browser/` specifically so it can also emit
`dist/<project-name>/server/` when SSR is enabled — but the `browser/` nesting applies
unconditionally, even with SSR off. [CITED: angular.dev/tools/cli/build-system-migration]
**How to avoid:** Serve `dist/<app>/browser` (or read `angular.json`'s `outputPath` if the
template customizes it). Verify the target path exists before wiring the `start` command.
**Warning signs:** `sirv` starts cleanly (exit 0, port bound) but the readiness poll times out
or the served page is a directory listing / 404, not the app.

### Pitfall 2: Angular's default test runner switched to Vitest — the D2-16 example command is stale
**What goes wrong:** `ng test --watch=false --browsers=ChromeHeadless` either errors (`--browsers`
is a Karma-launcher flag) or silently no-ops on a freshly scaffolded template, because a current
`ng new` no longer wires Karma by default.
**Why it happens:** "Following the stable release of Vitest in Angular v21, it is now the primary
test runner" [CITED: angular.dev/roadmap]; the builder is `@angular/build:unit-test` with
`runner: "vitest"` by default, which runs against jsdom — no browser launcher, no `--browsers`
flag needed at all.
**How to avoid:** Declare `test: ng test --no-watch --no-progress` in `stack.yaml` for the
Angular row (drop `--browsers=ChromeHeadless` entirely). Setting `CI=1` in the D2-04 allowlisted
env is enough on its own for `ng test` to auto-detect non-interactive single-run mode
[CITED: angular.dev/guide/testing — "Most CI servers automatically set a CI=true environment
variable, which ng test detects..."], but pass the explicit flags too for determinism across
Angular CLI versions/runners.
**Warning signs:** Test stage hangs past its timeout (watch mode never exits) or exits non-zero
immediately with an "unknown option --browsers" error.

### Pitfall 3: `ng lint` requires an explicit opt-in during template scaffold
**What goes wrong:** D2-16's `lint: ng lint` field fails on a freshly `ng new`-scaffolded
skeleton with "no lint builder configured."
**Why it happens:** "To enable and use the `ng lint` command, you must first add a package that
implements linting capabilities using `ng add`" [CITED: angular.dev/cli/lint] — the CLI no longer
bundles TSLint/ESLint by default.
**How to avoid:** During the one-time template scaffold (not per-run), run
`ng add @angular-eslint/schematics --skip-confirmation` before committing
`stacks/angular/template/`. This adds the `lint` target + `.eslintrc`/`eslint.config.js` to the
committed `angular.json`, so every run's `ng lint` "just works" against the committed config.
**Warning signs:** Lint stage always exits non-zero with a "no lint builder" message rather than
real lint findings — distinguish this from a real lint failure by checking stderr content, not
just exit code, if debugging the template.

### Pitfall 4: `waitUntil: 'networkidle'` alone is an unreliable readiness signal
**What goes wrong:** A page with a polling widget, analytics beacon, or any background
`fetch`/WebSocket never reaches "no network connections for 500ms," so `networkidle` hangs until
Playwright's own navigation timeout — which is a different timeout than the D2-17 start/ready
budget, producing a confusing failure mode.
**Why it happens:** Playwright's docs explicitly mark it "**DISCOURAGED**... rely on web
assertions to assess readiness instead" [CITED: playwright v1.61.0 types.d.ts / goto() docs].
**How to avoid:** D2-10's layered design already mitigates this — the HTTP-200 poll happens
*first* and is what's actually bounded by the start timeout; treat the Playwright-side
`networkidle` + `fonts.ready` + settle as a best-effort refinement with its own short,
independently-bounded budget (e.g., wrap `page.goto` in a `Promise.race` against a hard 10–15s
cap), not as the stage's sole pass/fail gate.
**Warning signs:** Stage times out at exactly Playwright's default navigation timeout (30s) even
though the HTTP poll succeeded quickly — the two timeouts got conflated.

### Pitfall 5: `execa`'s `cleanup` option kills the direct child, not the whole descendant tree
**What goes wrong:** After `runStack` finishes, `sirv`'s parent process exits but a
grandchild (spawned via `npx` shimming, or a Node child worker) survives, still holding port
4200 — the next run's `waitForHttp200` connects to the *stale* server instead of failing fast,
silently corrupting the next run's screenshot.
**Why it happens:** execa's `cleanup` (default `true`) attaches an exit handler on **our**
process that calls `subprocess.kill()` — that only signals the direct child PID. `npx` itself
(if used to invoke `sirv`) is a well-known extra process hop that can leave the real server
process as an orphaned grandchild if only the `npx` shim receives the signal.
**How to avoid:** Prefer invoking `sirv-cli`'s binary directly (e.g., resolve
`node_modules/.bin/sirv` inside the template, or `execa("node", [require.resolve("sirv-cli/bin.js"), ...])`)
rather than routing through `npx`, and use the `detached: true` + `process.kill(-pid)`
group-kill pattern (Pattern 5 above) so the signal reaches the whole process group regardless of
how many hops deep the real server process is.
**Warning signs:** WORK-04's teardown-verification (fresh `fetch` after teardown) still gets a
response instead of `ECONNREFUSED`.

### Pitfall 6: vitest's default 5-second test timeout is far shorter than a real `npm ci` + `ng build`
**What goes wrong:** The integration test that calls `runStack()` against the real Angular
fixture times out mid-`npm ci` with a vitest-level "test timed out in 5000ms" failure that looks
like a hang, not a real pipeline bug.
**Why it happens:** "The default value is 5000ms in Node.js environments" [CITED: vitest v4.1.6
`config/testtimeout.md`] — this is vitest's own test-runner timeout, completely separate from
the D2-17 per-stage timeouts inside `runStack` itself.
**How to avoid:** Set a per-test timeout well above the D2-17 overall run cap (~15m), e.g.
`test('runs the Angular fixture end to end', async () => {...}, 16 * 60_000)`, or raise
`testTimeout` in a dedicated `vitest.config.ts` for the integration suite (keep the unit-test
suite's default 5s so a genuinely hung unit test still fails fast).
**Warning signs:** CI test run fails with `Test timed out in 5000ms` on the integration spec
specifically, while unit tests continue to pass in milliseconds.

## Code Examples

### Determinism self-test (BUILD-04, "screenshot twice" self-test)
```typescript
// Source: pixelmatch API confirmed via context7.com/mapbox/pixelmatch/llms.txt
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

function assertDeterministic(shotA: Buffer, shotB: Buffer, maxDiffPct = 0.1): void {
  const imgA = PNG.sync.read(shotA);
  const imgB = PNG.sync.read(shotB);
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(
      `Determinism self-test dimension mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`,
    );
  }
  const { width, height } = imgA;
  const numDiffPixels = pixelmatch(imgA.data, imgB.data, null, width, height, {
    threshold: 0.1,   // pixelmatch default sensitivity
    includeAA: false, // ignore anti-aliased edge pixels — reduces false positives from subpixel font rendering
  });
  const diffPct = (100 * numDiffPixels) / (width * height);
  if (diffPct > maxDiffPct) {
    throw new Error(`Determinism self-test failed: ${diffPct.toFixed(3)}% pixels differ (max ${maxDiffPct}%)`);
  }
}
```

### Isolation self-test (WORK-02, hash-before/after)
```typescript
// No library needed — node:crypto + node:fs, walking the tree deterministically.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function hashTree(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) { // sorted = stable order across OSes
      if (entry === "node_modules" || entry === ".git" || entry === "tmp" || entry === "results") continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      hash.update(relative(root, full));
      hash.update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

// Self-test: hashTree(projectRoot) before runStack(), again after — must be equal (WORK-02).
```

### Combined tail-capped stage log (D2-19)
```typescript
// Pattern: execa's `all: true` (docs/output.md) gives interleaved stdout+stderr already;
// cap it to the last N bytes before writing via the reused Phase-1 artifact store.
function tailCap(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(buf.length - maxBytes).toString("utf8"); // keep the tail — errors live at the end
}

// storage.writeArtifact(runId, "log", `${stage}.log`, Buffer.from(tailCap(result.all, 5 * 1024 * 1024)));
```

### Runtime page-error capture (D2-15, non-fatal)
```typescript
// page.on('console'|'requestfailed') + context.on('weberror') all confirmed
// (docs/src/api/class-page.md, class-request.md, class-weberror.md, v1.61.0).
// `weberror` is the current (non-deprecated) event for uncaught page exceptions;
// `pageerror` on Page still exists as an older alias — prefer `weberror` on the context.
interface PageErrorSignal { consoleErrors: string[]; uncaughtExceptions: string[]; failedRequests: string[] }

function captureRuntimeSignals(context: import("playwright").BrowserContext, page: import("playwright").Page): PageErrorSignal {
  const signal: PageErrorSignal = { consoleErrors: [], uncaughtExceptions: [], failedRequests: [] };
  page.on("console", (msg) => { if (msg.type() === "error") signal.consoleErrors.push(msg.text()); });
  context.on("weberror", (webError) => signal.uncaughtExceptions.push(String(webError.error())));
  page.on("requestfailed", (request) => signal.failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`));
  return signal; // non-fatal — screenshot proceeds regardless (D2-15)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Angular Karma + Jasmine as default `ng test` | Vitest as default `ng test` runner (jsdom, no browser launcher) | Stable in Angular v21 [CITED: angular.dev/roadmap] | D2-16's example test command needs the `--browsers` flag dropped |
| Angular browser builder → `dist/<app>/` | `@angular/build:application` builder → `dist/<app>/browser/` | Confirmed current in the CLI 22 migration docs | D2-08's serve command needs the `/browser` suffix |
| Angular built-in TSLint | Opt-in `ng add @angular-eslint/schematics`, no lint builder by default | Ongoing since TSLint deprecation | Template scaffold must run this once, or `lint` stage always fails |
| `page.on('pageerror')` for uncaught exceptions | `context.on('weberror')` (page-scoped `pageerror` still works but is the older API surface) | Documented in current (v1.61.0) API reference | Prefer `weberror` in new code; both are viable for D2-15 |
| Puppeteer-style `--headless=new` CLI flag | Playwright's own `channel: 'chromium'` launch option | Since Playwright v1.49 [CITED: release-notes] | D2-12's "new-headless mode" is expressed as a launch option, not a CLI flag string |

**Deprecated/outdated:**
- `waitUntil: 'networkidle'` as a sole readiness signal — Playwright's own docs discourage it; still fine as one layer in a bounded gate (D2-10), never alone.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A fixed 250ms poll interval and 250ms final settle are adequate tuning for the readiness gate | Pattern 3 (Layered Readiness Gate) | Low — CONTEXT.md explicitly leaves "the short-settle duration and Playwright wait tuning" to planner discretion; these are starting values, easily adjusted, not a correctness risk |
| A2 | A fixed epoch (`1735689600000`) and a simple LCG for `Math.random` stubbing are sufficient for determinism | Pattern 4 (Determinism Controls) | Low-Medium — if the Angular fixture app uses `crypto.getRandomValues` instead of `Math.random`, this stub misses it; verify against whatever fixture app is actually chosen (CONTEXT.md leaves fixture choice to planner discretion too) |
| A3 | Resolving `sirv-cli`'s binary directly (bypassing `npx`) is available and preferable to `npx sirv ...` | Pitfall 5 | Low — `node_modules/.bin/sirv` is a standard npm-created symlink; if the template's `start` script instead uses `npx sirv-cli`, an extra process hop is introduced that the process-group-kill pattern still handles, just with one more link in the chain |

**All version/API claims above (Playwright, execa, pixelmatch, Angular CLI, sirv, npm, vitest) are `[CITED]` against official docs fetched via context7 in this research session — no ecosystem claim here is `[ASSUMED]`.**

## Open Questions

1. **Exact fixture app for the determinism + isolation self-tests**
   - What we know: CONTEXT.md explicitly leaves "the fixture app used by the determinism
     self-test and isolation self-test" to planner discretion.
   - What's unclear: Whether the self-test fixture should be the same Angular template
     (`stacks/angular/template/`, slower but exercises the real pipeline) or a minimal static
     HTML fixture (faster, isolates the Playwright determinism layer from Angular build
     variance).
   - Recommendation: Use a minimal static HTML fixture (a single `index.html` with a CSS
     animation, a webfont `<link>`, and a `Math.random()`-seeded element) served directly by
     `sirv` for the determinism self-test — it isolates Playwright's own determinism controls
     from Angular build nondeterminism, and runs in milliseconds instead of minutes. Use the
     real Angular template (or the isolation-test's own throwaway copy) for the isolation
     self-test, since that one must prove the *real* `copyWorkspace`/`runStack` path never
     touches the main tree.

2. **Whether `sirv-cli`'s binary should be invoked via `npx` or a resolved direct path**
   - What we know: Both work functionally; `npx` adds a process hop (Pitfall 5).
   - What's unclear: Whether the template's own `package.json` `"start"` script convention
     (`sirv dist/<app>/browser --single --port 4200`, resolvable via `npm start` which already
     puts `node_modules/.bin` on `PATH`) is what D2-07's "runs whatever `start` declares" means,
     versus `runStack` invoking `sirv` as a raw binary itself.
   - Recommendation: Have the template's `start` field in `stack.yaml` be `npm start` (which
     Node/npm resolves through `node_modules/.bin` with zero extra hops), and have the
     template's own `package.json` `"scripts": {"start": "sirv dist/<app>/browser --single --port 4200"}`
     invoke `sirv` directly, not through `npx`. This keeps D2-07's stack-agnostic contract
     ("core just runs whatever `start` declares") while avoiding the `npx` hop entirely.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime for all of Phase 2 | ✓ | v24.13.1 | — |
| npm | `npm ci`, install stage | ✓ | 11.8.0 | — |
| Playwright Chromium browser binary | Screenshot capture | ✓ (already downloaded to `~/.cache/ms-playwright`, incl. `chromium-1217`/`chromium_headless_shell-1217`) | matches `playwright@1.61.1`'s pinned revision | — |
| Angular CLI (`ng`) | One-time template scaffold | ✓ (on `PATH`) | 22.0.5 | Not needed at runtime — only for the one-time scaffold; `npm ci` + `npm start`/`ng build` inside the template don't require a global `ng` |
| `stacks/` directory | D2-01 committed template | ✗ (currently empty — this phase creates it) | — | No fallback — this is the phase's own deliverable, not a missing external tool |

**Missing dependencies with no fallback:** none (the empty `stacks/` dir is this phase's output, not a blocker).
**Missing dependencies with fallback:** none — environment is fully ready for implementation.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | none — see Wave 0 (a dedicated integration-suite config raising `testTimeout` is needed, per Pitfall 6) |
| Quick run command | `npx vitest run tests/<file>.test.ts` |
| Full suite command | `npm test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|--------------|
| WORK-01 | `runStack` creates `tmp/<run_id>/angular/` populated from the template | integration | `npx vitest run tests/runStack.integration.test.ts -t "creates workspace"` | ❌ Wave 0 |
| WORK-02 | Main project tree is byte-identical before/after a run | integration (self-test) | `npx vitest run tests/isolation.selftest.test.ts` | ❌ Wave 0 |
| WORK-03 | Install spawns with `--ignore-scripts`, allowlisted env only, and aborts at its timeout | unit + integration | `npx vitest run tests/runStage.test.ts -t "install stage"` | ❌ Wave 0 |
| WORK-04 | After teardown, port 4200 is free and no child process survives | integration | `npx vitest run tests/runStack.integration.test.ts -t "teardown"` | ❌ Wave 0 |
| BUILD-01 | install→build→start→ready happy path; build/start/timeout failures yield scored `RunStatus`, never an uncaught exception | integration (happy path + 3 forced-failure variants) | `npx vitest run tests/runStack.integration.test.ts` | ❌ Wave 0 |
| BUILD-02 | lint/test failures are recorded but never block the screenshot; `dist/` size is captured | integration | `npx vitest run tests/runStack.integration.test.ts -t "non-fatal stages"` | ❌ Wave 0 |
| BUILD-03 | Screenshot PNG dimensions equal declared viewport at `deviceScaleFactor: 1` | integration | `npx vitest run tests/runStack.integration.test.ts -t "screenshot dimensions"` | ❌ Wave 0 |
| BUILD-04 | Screenshotting the same fixture twice yields ≤0.1% differing pixels | integration (determinism self-test) | `npx vitest run tests/determinism.selftest.test.ts` | ❌ Wave 0 |

**Held-out vs. direct assertion split:**
- **Direct assertions** (deterministic, single expected value): screenshot dimensions (BUILD-03),
  `RunStatus` enum value + `failedStage` per forced-failure scenario (BUILD-01), port-free check
  (WORK-04), tree-hash equality (WORK-02).
- **Property/threshold-based checks** (BUILD-04's determinism self-test, and only that one):
  pixel-diff percentage must stay under a threshold (≤0.1%), not equal an exact value — screen
  rendering has inherent sub-pixel/AA jitter even with all determinism controls applied, so an
  exact-equality assertion would be flaky by construction. This is the one place in Phase 2 where
  a threshold check is correct, not a cop-out.

### Sampling Rate
- **Per task commit:** targeted `npx vitest run tests/<touched-file>.test.ts`
- **Per wave merge:** `npm test` (full suite, incl. the slow integration + determinism self-test)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/runStack.integration.test.ts` — covers WORK-01/02/04, BUILD-01/02/03
- [ ] `tests/determinism.selftest.test.ts` — covers BUILD-04
- [ ] `tests/isolation.selftest.test.ts` — covers WORK-02 (may be folded into the integration file instead of a separate one — planner's call)
- [ ] `tests/fixtures/` — a minimal static HTML fixture for the determinism self-test (Open Question 1)
- [ ] `stacks/angular/template/` — the committed Angular skeleton itself (D2-01) is a prerequisite for every integration test above, not just a test gap
- [ ] A dedicated vitest config (or per-test timeout overrides) raising `testTimeout` well past 5000ms for the integration suite (Pitfall 6) — package.json's current `"test": "vitest run"` uses vitest's built-in 5000ms default with no override yet

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | Single-operator local CLI, no auth surface in this phase |
| V3 Session Management | no | No sessions in this phase |
| V4 Access Control | no | No multi-user access boundary |
| V5 Input Validation | yes | `stack.yaml` command fields are trusted config (author-controlled, zod `.strict()`-validated per D-08), but still spawn via array-form `execa(file, args)` (no `shell: true`) so a future untrusted/agent-authored `start`/`build` string (Phase 4) can never achieve shell metacharacter injection |
| V6 Cryptography | no new surface | Reuses Phase 1's sha256 artifact hashing (`src/storage/artifacts.ts`) verbatim; no new crypto introduced |
| V12 Files and Resources | yes | Reuse Phase 1's path-containment guard in `writeArtifact` verbatim for screenshots/logs (D2-06/D2-19); `copyWorkspace` must derive all paths from `run_id` only, never from spec-supplied strings |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Shell command injection via `stack.yaml` `install`/`build`/`start` strings | Tampering | Array-form `execa(file, args)` (no `shell: true`) — execa's default never spawns a shell |
| Parent-process secrets (npm tokens, API keys, CI credentials) leaking into a run's install/build scripts | Information Disclosure | D2-04's default-deny env allowlist + `extendEnv: false`; combined with `--ignore-scripts` (WORK-03) so `postinstall` hooks in third-party deps can't exfiltrate even what little env they do get |
| Orphaned dev-server process left listening after a run (resource exhaustion / port squatting across runs) | Denial of Service (self-inflicted) | WORK-04's process-group kill (Pattern 5) + post-teardown port-free verification |
| Artifact filename escaping `results/<run_id>/` (path traversal) | Tampering | Already mitigated — Phase 1's `writeArtifact` path-containment guard is reused verbatim, not re-implemented |
| Runaway stage output filling disk | Denial of Service (self-inflicted) | D2-19's tail-capped combined log (~5MB) |

## Sources

### Primary (HIGH confidence — official docs fetched via context7 this session)
- `/microsoft/playwright/v1.61.0` — `chromium.launch({channel:'chromium'})` new-headless opt-in, `browser.newContext({viewport, deviceScaleFactor, reducedMotion})`, `page.screenshot`/CDP `clip` semantics, `page.goto` `waitUntil` enum (incl. the "networkidle... DISCOURAGED" note), `page.route`/`route.abort()`, `context.addInitScript` timing guarantee, `page.on('console'|'requestfailed')`, `context.on('weberror')`.
- `/sindresorhus/execa` (main branch docs) — `detached`, `cleanup`, `forceKillAfterDelay` (default 5000ms), `killSignal` (default SIGTERM), `timeout`, `cancelSignal`/`AbortController`, `env`/`extendEnv`, and the explicit "shells... can be unsafe by potentially allowing command injection" guidance.
- `/mapbox/pixelmatch` — `pixelmatch(img1, img2, output, width, height, options)` signature, `threshold` (default 0.1), `includeAA` (default false), return value = differing-pixel count.
- `/lukeed/sirv` (sirv-cli readme) — `--single` SPA fallback lookup chain, `opts.single`/`opts.ignores` semantics.
- `/websites/angular_dev` — `@angular/build:application` builder's `dist/<project>/browser/` output path (`tools/cli/build-system-migration`), Vitest as the stable default `ng test` runner since v21 (`roadmap`, `guide/testing`), `ng lint` requiring `ng add` (`cli/lint`), `ng test --no-watch --no-progress --browsers=ChromeHeadless` CI invocation pattern (`guide/testing/karma`), `CI=true` auto-detection (`guide/testing`).
- `/npm/cli` — `npm_config_<key>` environment-variable config mapping (`docs/lib/content/using-npm/config.md`), `--ignore-scripts` behavior on `npm ci`/`npm run` (skips pre/post but still runs the named script).
- `/vitest-dev/vitest/v4.1.6` — default `testTimeout` = 5000ms in Node environments (`config/testtimeout.md`), per-test timeout override syntax.
- npm registry (`npm view <pkg> version`, `npm view <pkg> time.created`, `npm view <pkg> scripts.postinstall`, npmjs.org downloads API) — version/legitimacy verification for all seven packages named above, run directly in this session (2026-07-01).

### Secondary (MEDIUM confidence)
- None — every external claim in this document traces to an official-docs fetch or a direct registry/local-environment probe run in this session.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version pin verified against the live npm registry this session; all already installed locally
- Architecture: HIGH — every API surface (Playwright, execa, sirv, pixelmatch, Angular CLI) fetched from official docs this session, not from training-data memory
- Pitfalls: HIGH — the two highest-impact pitfalls (Angular `dist/browser/` path, Vitest-not-Karma default) are direct corrections against the locked CONTEXT.md example commands, each confirmed against current official Angular docs

**Research date:** 2026-07-01
**Valid until:** 2026-07-15 (Angular CLI and Playwright both ship frequently; re-verify `ng build`/`ng test` default behavior and Playwright's headless-mode flag if this phase's implementation slips more than ~2 weeks past this research)

**Note on tool availability:** This session's installed `gsd-tools` (`get-shit-done-redux`, via `npx`/global bin) does not expose the `research-plan`, `classify-confidence`, or `package-legitimacy` query seams described in the researcher's tool_strategy (`Unknown command` for all three). Research proceeded via direct `npx ctx7@latest` (Context7 CLI, per the user's global `context7.md` rule) for all library documentation, and direct `npm view`/npmjs-downloads-API calls for version and package-legitimacy verification, applying the same HIGH/MEDIUM/LOW confidence discipline manually. No finding in this document is weaker than what the seam-based flow would have produced; the fallback only changed the invocation mechanics, not the verification rigor.
