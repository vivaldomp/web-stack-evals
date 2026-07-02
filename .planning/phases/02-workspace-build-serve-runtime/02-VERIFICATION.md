---
phase: 02-workspace-build-serve-runtime
verified: 2026-07-02T03:22:00Z
status: human_needed
score: 5/6 must-haves verified
behavior_unverified: 1
overrides_applied: 0
human_verification:
  - test: "Trigger a console error, an uncaught page exception, and a failed network request on a served page, then run createPlaywrightRenderer().screenshot({url, viewport}) against it."
    expected: "screenshot() still resolves (never rejects) and the returned RenderResult's consoleErrors/uncaughtExceptions/failedRequests arrays are non-empty, matching what was actually triggered on the page."
    why_human: "The only place D2-15 capture is implemented (src/render/playwrightRenderer.ts, page.on('console')/context.on('weberror')/page.on('requestfailed') registered before navigation) is exercised end-to-end only against the determinism-selftest fixture and the real Angular app — both are error-free pages, so every test that runs today asserts the three arrays exist/are-arrays but never that they get populated when a real error occurs. Code presence + correct Playwright API wiring is confirmed by reading the source; the capture behavior itself has no automated proof."
---

# Phase 2: Workspace, Build, Serve & Render Runtime Verification Report

**Phase Goal:** A raw stack template runs through the full deterministic build-and-render pipeline in a disposable, isolated workspace and produces a screenshot — with zero agent involvement. This proves the deterministic substrate under real processes.

**Verified:** 2026-07-02T03:22:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fresh `tmp/run-XXX/` workspace created; main project tree byte-identical before/after | ✓ VERIFIED | `src/workspace/copy.ts` derives the destination only from `tmpRoot`+`runId`+fixed `"angular"` subfolder (grep-confirmed, no other input). `tests/isolation.selftest.test.ts` hashes the real project tree before/after a real `runStack()` call — ran it live: 10/10 integration tests pass including this one. Independently confirmed post-run with `git status` (clean) and no tracked `dist`/`node_modules` under `stacks/angular/template/`. |
| 2 | Deps install with `--ignore-scripts` + env-stripped spawn; install/build/start each abort on their own per-stage timeout | ✓ VERIFIED | `stacks/angular.yaml` declares `install: npm ci --ignore-scripts`. `src/runtime/env.ts#buildAllowlistedEnv` returns exactly 5 keys (`PATH`,`HOME`,`npm_config_cache`,`npm_config_ignore_scripts`,`CI`), no `NODE_ENV`. `src/runtime/stage.ts#runStage` calls array-form `execa(file,args,{extendEnv:false,timeout,...})` — grep-confirmed zero `shell: true` and zero `...process.env` spreads anywhere in `stage.ts`/`env.ts`. `runStack.ts` resolves 6 independent `*TimeoutMs` values per stage from the spec (`?? 300000/300000/300000/300000/90000/30000`), no other bare timeout literal in the file (grep-confirmed). Live-ran the forced "build timeout" and "start/ready timeout" integration tests — both pass in well under a second using `buildTimeoutMs:200`/`startTimeoutMs:300` overrides. |
| 3 | Build/lint/start failure recorded as a scored outcome, never an uncaught crash; build/lint/test results captured as metrics | ✓ VERIFIED | `runStack.ts` never lets a stage failure escape as a thrown error — every fatal path (`install`/`build`/`start` non-zero exit or timeout) returns a `RunOutcome` + emits a terminal `BenchmarkFinishedEvent`. Live-ran all 4 forced-failure integration tests (`install failure`→`build_failed`, `build timeout`→`timeout`, `start failure`→`start_failed`, `start timeout`→`timeout`) — all pass, all resolve rather than throw/reject. Lint/test are non-fatal (`runAndRecordStage` never triggers early return for them) — live-ran "non-fatal stages" test: lint+test both recorded as `stage_failed`/`stage_completed` events while `outcome.status` stays `"completed"`. `dist/` byte size captured in `meta.json` (live-ran "dist size is captured" test — passes, `distBytes > 0`). |
| 4 | Headless Playwright screenshot at declared viewport, `deviceScaleFactor:1`, saved to artifact store | ✓ VERIFIED | `src/render/playwrightRenderer.ts` launches `chromium.launch({channel:"chromium",headless:true})`, `browser.newContext({viewport:input.viewport, deviceScaleFactor:1, reducedMotion:"reduce"})`, screenshots with no `fullPage`/`clip` override (viewport-bound capture). Live-ran "screenshot dimensions equal the declared viewport at dpr=1" against the real Angular app — decoded PNG width/height exactly match `stack.viewport` (1280×800) read from the real `stacks/angular.yaml`. Screenshot written via `storage.writeArtifact(runId,"screenshot","generated.png",...)`, round-tripped through `storage.getArtifactPath()` in the same live test. |
| 5 | Determinism: same app screenshotted twice yields near-identical images (self-test passes); after teardown no dev-server process or port left held | ✓ VERIFIED | `tests/determinism.selftest.test.ts` screenshots a fixture (CSS animation + external font link + `Math.random()`) twice via the real renderer and asserts pixelmatch diff ≤0.1% — live-ran, passes. `src/runtime/stage.ts#killProcessTree` sends `process.kill(-pid,"SIGTERM")` (whole POSIX process group via `detached:true`); `runStack.ts` wraps the start-through-screenshot block in a single `finally { killProcessTree(subprocess) }` covering every exit path. Live-ran "start/ready timeout... teardown leaves the port free" test — asserts a real post-teardown `fetch("http://localhost:4200")` rejects. Independently confirmed after the full suite run: `ss -ltnp` shows no listener on 4200, `ps aux` shows no stray `sirv`/`ng` process, `tmp/` holds only the persistent `.npm-cache` dir. |

**Score:** 5/5 ROADMAP truths verified. One additional plan-level must-have (D2-15 page-error capture, from 02-04-PLAN.md, not a ROADMAP SC) is present+wired but behaviorally unverified — see below.

### Plan-Level Must-Have Not Behaviorally Proven

| # | Truth (source: 02-04-PLAN.md) | Status | Evidence |
|---|-------|--------|----------|
| 6 | "Console errors, uncaught page exceptions, and failed requests during rendering are captured as a non-fatal signal alongside a successful screenshot (D2-15), never blocking the screenshot" | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code is present and correctly wired: `src/render/playwrightRenderer.ts` registers `page.on("console",...)`, `context.on("weberror",...)`, `page.on("requestfailed",...)` before navigation and always returns the collected arrays alongside the PNG. But no test in the phase triggers an actual console error / uncaught exception / failed request and asserts the arrays become non-empty — `tests/runStack.test.ts` only asserts `Array.isArray(parsed.pageErrors.consoleErrors)` on a clean happy-path run (always `[]` there), and both `tests/determinism.selftest.test.ts`'s fixture and the real Angular template are error-free pages. The 02-04-SUMMARY.md itself flags this honestly (`human_judgment: true`, "No dedicated test in this plan exercises a page that logs a console error / throws / has a failed request"). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/workspace/copy.ts` | `copyWorkspace` | ✓ VERIFIED | Exists, exported, path-contained by construction, unit-tested (`tests/workspace.test.ts`) |
| `src/workspace/teardown.ts` | `cleanupWorkspace` | ✓ VERIFIED | D2-05 keep/delete semantics, idempotent, unit-tested |
| `src/runtime/env.ts` | `buildAllowlistedEnv` | ✓ VERIFIED | 5-key allowlist, no NODE_ENV, unit-tested |
| `src/runtime/stage.ts` | `runStage`/`startServer`/`killProcessTree` | ✓ VERIFIED | Array-form execa, tail-capped log, process-group kill; unit + live-tested |
| `src/runtime/readiness.ts` | `waitForHttp200` | ✓ VERIFIED | Native fetch poll, no library |
| `src/storage/storagePort.ts` | `createStoragePort` | ✓ VERIFIED | Adapts Phase-1 db-taking functions verbatim, id-type shim only; Phase-1 files byte-identical (git diff clean) |
| `src/render/determinism.ts` | `installDeterminismControls`/`blockExternalFonts` | ✓ VERIFIED | Context-level Date/Math.random freeze + CSS kill, page-level font block |
| `src/render/playwrightRenderer.ts` | `createPlaywrightRenderer(): RenderPort` | ✓ VERIFIED | Only file importing `playwright` under `src/` (grep-confirmed) |
| `src/pipeline/runStack.ts` | `runStack(stack, runId, storage)` | ✓ VERIFIED | Exact 3-arg D2-20 signature, full pipeline wired |
| `stacks/angular/template/` | Committed, buildable Angular skeleton | ✓ VERIFIED | Committed `package.json`/`package-lock.json`, `dist`/`node_modules` present locally but correctly gitignored (0 tracked files under either) |
| `stacks/angular.yaml` | Production StackSchema spec | ✓ VERIFIED | Loads via `loadStack`, viewport matches dashboard scenario (1280×800), port 4200 |
| `tests/runStack.integration.test.ts` | End-to-end proof | ✓ VERIFIED | Live-ran: 8/8 tests pass against the real template/pipeline |
| `tests/isolation.selftest.test.ts` | Hash-tree proof | ✓ VERIFIED | Live-ran: 1/1 passes |
| `tests/determinism.selftest.test.ts` | Pixel-diff proof | ✓ VERIFIED | Live-ran: 1/1 passes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `package.json` deps | every Phase-2 module's imports | `npm ls playwright execa pixelmatch pngjs` | ✓ WIRED | All 4 resolve at exact pinned versions (1.61.1/9.6.1/7.2.0/7.0.0) |
| `stacks/angular.yaml install` field | `runStage()` | literal `npm ci --ignore-scripts` string execed array-form | ✓ WIRED | Confirmed in spec + `stage.ts`'s whitespace-split array-form exec |
| `RenderPort` (core/ports.ts) | `playwrightRenderer.ts` | interface implementation | ✓ WIRED | `createPlaywrightRenderer(): RenderPort` type-checks; only implementor |
| `RenderPort` | `runStack.ts` | `createPlaywrightRenderer()` import | ✓ WIRED | `runStack.ts` never imports `"playwright"` directly (grep-confirmed) |
| `StoragePort` | `runStack.ts` | every `storage.appendEvent`/`writeArtifact` call | ✓ WIRED | Confirmed by reading `runStack.ts` — all storage access goes through the port |
| `StackSchema.*TimeoutMs` | `runStack.ts` timeout resolution | `stack.installTimeoutMs ?? 300000` etc. | ✓ WIRED | Live-ran forced-timeout tests using these overrides — both complete in <1s |

### Behavioral Spot-Checks (live-executed, not SUMMARY-trusted)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Fast unit tier | `npm test` | 10 files, 51 tests, all pass | ✓ PASS |
| Type-check | `npx tsc --noEmit` | No errors | ✓ PASS |
| Full integration/self-test tier | `nvm exec 24.18.0 npx vitest run --config vitest.integration.config.ts --no-file-parallelism` | 3 files, 10 tests, all pass, 23.4s | ✓ PASS |
| No `shell: true` in stage.ts | `grep -c 'shell: true' src/runtime/stage.ts` | `0` | ✓ PASS |
| No `...process.env` spread | `grep -c '\.\.\.process\.env' src/runtime/{stage,env}.ts` | `0`, `0` | ✓ PASS |
| Only playwrightRenderer.ts imports playwright | `grep -rl 'from "playwright"' src/` | `src/render/playwrightRenderer.ts` only | ✓ PASS |
| Port 4200 free post-suite | `ss -ltnp \| grep 4200` | no listener | ✓ PASS |
| No orphaned server processes post-suite | `ps aux \| grep -E 'sirv\|ng build\|ng serve'` | none | ✓ PASS |
| `tmp/` clean post-suite | `ls tmp/` | only `.npm-cache/` (no `run-*` residue) | ✓ PASS |
| Main tree unmutated | `git status` | clean, no tracked-file diff | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| WORK-01 | 02-02, 02-03, 02-06 | Disposable temp workspace per run | ✓ SATISFIED | `copyWorkspace` + live isolation test |
| WORK-02 | 02-03, 02-06 | Run never mutates main project | ✓ SATISFIED | `hashTree` before/after equal (live-run) |
| WORK-03 | 02-01, 02-03 | Isolation mitigations (--ignore-scripts, env-stripped, timeouts) | ✓ SATISFIED | env.ts/stage.ts greps + live forced-timeout tests |
| WORK-04 | 02-03, 02-05, 02-06 | Clean teardown, no orphaned processes/ports | ✓ SATISFIED | `killProcessTree` + live post-teardown fetch-rejects test + `ss`/`ps` checks |
| BUILD-01 | 02-02, 02-05, 02-06 | install→build→start→wait-ready pipeline, scored failures | ✓ SATISFIED | `runStack.ts` + live 4/4 forced-failure tests |
| BUILD-02 | 02-01, 02-02, 02-05, 02-06 | Build/lint/test metrics captured | ✓ SATISFIED | `meta.json` distBytes + non-fatal lint/test events, live-tested |
| BUILD-03 | 02-01, 02-04, 02-06 | Headless Playwright screenshot at declared viewport, dpr:1 | ✓ SATISFIED | Live-run dimension-equality test against real app |
| BUILD-04 | 02-01, 02-04 | Determinism controls | ✓ SATISFIED | Live-run pixelmatch self-test ≤0.1% |

**No orphaned requirements** — the union of every plan's `requirements:` frontmatter field (WORK-01/02/03/04, BUILD-01/02/03/04) exactly matches REQUIREMENTS.md's Phase 2 mapping, all marked `[x]`/"Complete".

### Anti-Patterns Found

None. Grepped every phase-touched `src/`+`stacks/angular.yaml` file for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon"/empty stub returns — zero matches.

## Flagged Items — Assessment

**1. D2-15 page-error capture has no behavioral test (executor-flagged).**
Assessed as a **real, if narrow, coverage gap** — not a phase-blocking defect. The capture code itself (`page.on("console")`, `context.on("weberror")`, `page.on("requestfailed")`, all registered before `page.goto`) is standard, correctly-ordered Playwright API usage and type-checks against `RenderResult`. It is not a ROADMAP success criterion (SC#4 only requires the screenshot at declared viewport/dpr — D2-15 is an additive plan-level must-have from 02-04-PLAN.md). Because no test ever drives a page that actually errors, there's no automated proof the three arrays populate correctly (e.g., a mistyped event name or wrong field access would pass every existing test silently). Routed to human verification below rather than either a rubber-stamped PASS or a blocking FAIL, matching the executor's own honest `human_judgment: true` self-assessment in 02-04-SUMMARY.md.

**2. Fixed port 4200, no per-run port allocation (executor-flagged).**
Confirmed as a **deliberate, documented v1 design decision**, not a defect. `02-RESEARCH.md` D2-09 explicitly defers `get-port` to v2 ("v1 is a single sequential row → no collision risk... Do not wire it in yet — it would be dead code violating YAGNI"), and `02-CONTEXT.md` restates the same decision. This is consistent with REQUIREMENTS.md's v1/v2 split (MATRIX-01/02/03 concurrency explicitly deferred to v2). The test-suite-level consequence (`--no-file-parallelism` needed so two integration test files don't race the same real port) was verified directly: ran the full integration tier with that flag and it passed cleanly (10/10, 23.4s). No gap.

## Human Verification Required

### 1. D2-15 page-error capture actually captures real errors

**Test:** Serve a fixture page that (a) logs `console.error(...)`, (b) throws an uncaught exception, and (c) requests a URL that fails to load. Call `createPlaywrightRenderer().screenshot({url, viewport})` against it.
**Expected:** The call resolves (does not reject); the returned `RenderResult.consoleErrors`/`.uncaughtExceptions`/`.failedRequests` arrays are each non-empty and contain the triggered signal.
**Why human:** No existing automated test in the phase exercises this path — every test that runs today does so against error-free pages (the determinism fixture and the real, clean Angular scaffold). This can be closed cheaply with one more fixture + test in a follow-up plan; a human/executor should decide whether to close it now or accept it as scoped-out for Phase 2 (it does not block any ROADMAP success criterion).

## Gaps Summary

No blocking gaps. All 5 ROADMAP Phase-2 success criteria are verified true against the live-running, unstubbed pipeline (not SUMMARY claims) — the fast unit suite (51 tests), the full integration/self-test tier (10 tests, run under Node 24.18.0 per the environment note), and independent post-run process/port/git-tree checks all confirm the phase's claims. One plan-level (non-ROADMAP) must-have — D2-15 page-error capture — is implemented and correctly wired but lacks a behavioral test proving it actually populates on a real error; this is routed to human verification rather than blocking the phase, consistent with the executor's own transparent flagging of the gap.

---
*Verified: 2026-07-02T03:22:00Z*
*Verifier: Claude (gsd-verifier)*
