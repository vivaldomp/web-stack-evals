# Phase 2: Workspace + Build/Serve Runtime - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 2-Workspace + Build/Serve Runtime
**Areas discussed:** Template source, Install strategy, Serve & screenshot target, Port allocation, Readiness detection, Determinism controls, Failure semantics, Stage timeouts, Env-var allowlist, Self-test tolerance, Artifact layout, Lint/test commands, Workspace retention, Metric scope, Log capture, Static server, Isolation verification, Playwright pinning, Self-test placement, Phase-2 entrypoint, Runtime-error detection, Port seams, Angular version pin

---

## Template source

| Option | Description | Selected |
|--------|-------------|----------|
| Checked-in dir, copied | Committed Angular skeleton with lockfile, copied fresh per run | ✓ |
| Scaffold command | `ng new` per run from a pinned CLI — network, slower, can drift | |
| degit / git clone | Fetch from a pinned git ref — reproducible but adds network + external repo | |

**User's choice:** Checked-in dir, copied → D2-01
**Notes:** Lockfile is the pin; deterministic + offline-friendly.

## Install strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Warm shared npm cache | `npm ci --ignore-scripts` + shared read-only `npm_config_cache` | ✓ |
| Plain network install | Live registry every run, no cache — registry hiccup fails a good run | |
| Fully offline mirror | Pre-vendor all deps — max determinism, heaviest, v2 | |

**User's choice:** Warm shared npm cache → D2-03
**Notes:** node_modules stays per-run/isolated; cache only avoids re-downloads.

## Serve & screenshot target

| Option | Description | Selected |
|--------|-------------|----------|
| Honor stack.yaml `start` | Run build then declared start; core stays stack-agnostic | ✓ |
| Force prod build + platform static server | Uniform but bakes static-output assumption into core | |
| Dev server (ng serve) | HMR/overlays add non-determinism, not representative | |

**User's choice:** Honor stack.yaml `start` → D2-07
**Notes:** Angular `start` authored to serve the production build.

## Port allocation

| Option | Description | Selected |
|--------|-------------|----------|
| Declared port, literal | Serve on stack.yaml port (4200); v1 single sequential row | ✓ |
| Dynamic free port, injected | get-port + inject; future-proofs v2 concurrency, more moving parts | |

**User's choice:** Declared port, literal → D2-09
**Notes:** Teardown via execa process-tree kill regardless; dynamic ports = v2.

## Readiness detection

| Option | Description | Selected |
|--------|-------------|----------|
| Layered gate | HTTP 200 poll → networkidle → fonts.ready → short settle | ✓ |
| HTTP 200 + fixed delay | Simple but the delay is a guess (flaky or wasteful) | |
| Wait for DOM selector | Precise but couples generic runtime to per-scenario knowledge | |

**User's choice:** Layered gate → D2-10

## Determinism controls (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Viewport-clip at declared size | Fixed dims → PixelMatch-comparable | ✓ |
| Kill motion | reducedMotion + inject CSS zeroing animation/transition/caret | ✓ |
| Font stability | fonts.ready + block external font CDNs | ✓ |
| Freeze time/random | Stub Date.now()/Math.random() in the page | ✓ |

**User's choice:** All four → D2-11
**Notes:** Comprehensive determinism bundle for the self-test.

## Failure semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Lint/test non-fatal | Only install/build/start/timeout fatal; lint/test = metrics | ✓ |
| Lint/test also fatal | Conflates code-quality with runnability | |
| Per-stack fatal flags | Flexible but adds config; v2 | |

**User's choice:** Lint/test non-fatal → D2-13/D2-14

## Stage timeouts

| Option | Description | Selected |
|--------|-------------|----------|
| Generous defaults | install 5m/build 5m/start 90s/screenshot 30s/overall ~15m, stack.yaml overridable | ✓ |
| Tight defaults | 3m/3m/60s/~8m — risks false timeouts on cold/slow machines | |
| Stack.yaml-declared, no fallback | Explicit but required config, easy to misconfigure | |

**User's choice:** Generous defaults → D2-17

## Env-var allowlist

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal allowlist | Default-deny; only PATH/HOME/npm_config_cache/CI/NODE_ENV/… | ✓ |
| Denylist known-risky | Default-allow, strip AWS_*/*_TOKEN/… — new secret names leak until listed | |

**User's choice:** Minimal allowlist → D2-04

## Self-test tolerance

| Option | Description | Selected |
|--------|-------------|----------|
| ≤0.1% differing | Tight enough to catch regressions, tolerates AA jitter | ✓ |
| Exactly 0 | Pixel-perfect; flaky against sub-pixel wobble | |
| ≤1% differing | Forgiving but could mask real non-determinism | |

**User's choice:** ≤0.1% differing → self-test threshold

## Artifact layout

| Option | Description | Selected |
|--------|-------------|----------|
| Typed subdirs | screenshots/ logs/<stage>.log code/ meta.json | ✓ |
| Flat directory | All files under results/<run_id>/ — gets noisy | |
| Leave to planner | Direction clear, let planner choose | |

**User's choice:** Typed subdirs → D2 specifics/artifacts

## Lint/test commands

| Option | Description | Selected |
|--------|-------------|----------|
| Optional fields, headless one-shot | Add lint/test to StackSchema; `ng test --watch=false --browsers=ChromeHeadless` | ✓ |
| Convention, no schema change | Infer npm run lint/test — hides flags Karma needs | |
| Defer lint/test to v2 | Drops a BUILD-02 signal | |

**User's choice:** Optional fields, headless one-shot → D2-16

## Workspace retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep on failure, delete on success | Balances disk hygiene + debuggability | ✓ |
| Always delete | Cleanest disk, nothing to inspect on failure | |
| Always keep | Max debuggability, node_modules piles up | |

**User's choice:** Keep on failure, delete on success → D2-05

## Metric scope

| Option | Description | Selected |
|--------|-------------|----------|
| Durations + pass/fail + build size | Cheap, high-signal, no parsing | ✓ |
| Durations + pass/fail only | Drops easy bundle-size signal | |
| Add parsed counts | Brittle output parsing for a single v1 row | |

**User's choice:** Durations + pass/fail + build size → D2-18

## Log capture

| Option | Description | Selected |
|--------|-------------|----------|
| Combined, capped tail | One <stage>.log interleaved, tail-capped ~5 MB | ✓ |
| Separate streams, capped | Loses natural interleaving, doubles files | |
| Combined, uncapped | Full fidelity but no disk backstop | |

**User's choice:** Combined, capped tail → D2-19

## Static server for `start`

| Option | Description | Selected |
|--------|-------------|----------|
| sirv-cli, SPA fallback | `sirv dist/<app> --single --port 4200`, dev-dep in template | ✓ |
| Bundled Node static server | Zero dep but code we own for a solved problem | |
| Leave to planner | Direction clear | |

**User's choice:** sirv-cli, SPA fallback → D2-08

## Isolation verification

| Option | Description | Selected |
|--------|-------------|----------|
| Trust + verify in self-test | run_id-scoped paths + containment; self-test hashes tree before/after | ✓ |
| Guard on every run | Full-tree hash per run — overhead for what construction guarantees | |
| Trust by construction only | Lightest, nothing catches a future stray write | |

**User's choice:** Trust + verify in self-test → D2-06

## Playwright pinning

| Option | Description | Selected |
|--------|-------------|----------|
| Bundled Chromium, new-headless, pinned | Revision pinned by lockfile, stamped in manifest, dpr=1 | ✓ |
| System Chrome channel | Browser version floats — undermines determinism | |

**User's choice:** Bundled Chromium, new-headless, pinned → D2-12

## Self-test placement

| Option | Description | Selected |
|--------|-------------|----------|
| CI/dev test on a fixture | vitest fixture, twice → ≤0.1% diff; zero per-run overhead | ✓ |
| Per-run gate | Doubles render time; overhead on a proven-deterministic renderer | |
| Both | Most coverage, more than v1 needs | |

**User's choice:** CI/dev test on a fixture → D2 specifics/self-test

## Phase-2 entrypoint

| Option | Description | Selected |
|--------|-------------|----------|
| runStack() fn, test-driven | Pure function exercised by integration tests; Phase 5 calls it unchanged | ✓ |
| Temporary CLI command | Throwaway scaffolding Phase 5 replaces | |
| Both | CLI overlaps Phase 5 CLI-01 | |

**User's choice:** runStack() fn, test-driven → D2-20

## Runtime-error detection

| Option | Description | Selected |
|--------|-------------|----------|
| Capture as signal, still screenshot | Record console errors/exceptions/failed requests, still shoot | ✓ |
| Fatal on runtime error | A mostly-rendered app gets zero visual credit | |
| Ignore, just screenshot | Throws away a cheap diagnostic | |

**User's choice:** Capture as signal, still screenshot → D2-15

## New port seams

| Option | Description | Selected |
|--------|-------------|----------|
| Concrete modules now, port if needed | Add an interface only where a test-double needs it | ✓ |
| Full port seams upfront | Several one-implementation interfaces — abstraction ahead of need | |

**User's choice:** Concrete modules now, port if needed → D2-21

## Angular version pin

| Option | Description | Selected |
|--------|-------------|----------|
| Latest stable, lockfile-pinned | Scaffold latest stable once, freeze by committed lockfile | ✓ |
| Pin a specific major | More ceremony, same reproducibility for one row | |

**User's choice:** Latest stable, lockfile-pinned → D2-02

---

## Claude's Discretion

- Exact `src/` module/folder layout for workspace/build/render code.
- Precise env-var allowlist contents (policy locked as default-deny).
- Exact log line formatting + tail-cap byte value.
- Fixture app for the determinism + isolation self-tests.
- `sirv-cli` version and exact static-serve invocation.
- Concrete zod field names for the new optional `lint`/`test` StackSchema fields.
- Short-settle duration + Playwright wait tuning in the readiness gate.

## Deferred Ideas

- Dynamic per-run port allocation (`get-port`) — v2 concurrency.
- Fully offline dependency mirror — v2.
- Per-stack fatal-stage flags — v2.
- Per-run determinism gate — kept as CI/dev fixture test only.
- Parsed lint/test counts + coverage, richer event→metric folding — Phase 5 / v2.
- Docker-per-run isolation (ISO-01) — v2.
- Additional stacks/models/scenarios — v2 matrix (declarative specs, no runtime change).
