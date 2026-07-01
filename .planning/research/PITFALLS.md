# Pitfalls Research

**Domain:** Automated benchmark/eval platform for AI coding agents (front-end web app generation, headless render + pixel/DOM/a11y/LLM-judge scoring)
**Researched:** 2026-07-01
**Confidence:** HIGH (established engineering + eval-research knowledge; two claims web-verified)

> Phases don't exist yet (greenfield, pre-roadmap). Pitfalls are mapped to **component/topic** names from the proposed architecture (Workspace Runtime, Agent Runtime, App Runtime, Screenshot, Evaluation Pipeline, Telemetry/Metrics, Storage, Scoring, Specs/CLI/Report). The roadmap should turn these into phases and inherit the mapping.

The single most important framing: **this platform's output is a number that people will trust to make decisions.** Almost every pitfall below is dangerous not because it crashes, but because it silently produces a *plausible wrong score*. A benchmark that is subtly non-reproducible or unfair is worse than no benchmark, because it launders subjectivity as objectivity. Treat "the score changed and I don't know why" as a P0 defect class, not a nuisance.

---

## Critical Pitfalls

### Pitfall 1: Running untrusted agent-generated code on the host (v1 local temp dir)

**What goes wrong:**
The agent writes arbitrary code and, worse, an arbitrary `package.json`. Then v1 runs `npm install` → `npm run build` → `npm start` on the host with no isolation. `npm install` executes **lifecycle scripts** (`preinstall`/`install`/`postinstall`) from *every transitive dependency* with the full privileges of the benchmark process — before any of your code runs. A prompt-injected or hallucinated dependency (typosquat, malicious postinstall) can exfiltrate env vars (including your `PI_SDK`/model API keys), read `~/.ssh`, `~/.aws`, `~/.npmrc`, plant persistence, or wipe files. The generated build/start scripts get the same reach. `tmp/run-XXX/` is a *convenience boundary, not a security boundary* — a temp dir does nothing to contain a process that can read the whole home directory.

**Why it happens:**
Docker was deferred (reasonably, to prove pipeline logic first), and the temp dir *feels* isolated because the files are scoped. The isolation of files is conflated with isolation of execution. The threat is also non-obvious: the agent is "yours," so it feels trusted — but its output is attacker-controllable via prompt content, mockups, and the model's own failure modes.

**How to avoid (v1, without Docker):**
- **Never run the benchmark with your real credentials in the ambient environment.** Pass the Pi SDK key to the *agent process only* via an explicit, minimal env allowlist; strip everything else (`env -i` style spawn with a curated allowlist, not `process.env` pass-through).
- **Disable install lifecycle scripts by default:** run installs with `npm ci --ignore-scripts` (and set `ignore-scripts=true` in a run-local `.npmrc`). Most front-end builds work without postinstall; flag the rare stack that needs them as an explicit, reviewed exception.
- **Prefer `npm ci` over `npm install`** — requires a committed lockfile in the stack `template/`, which also fixes reproducibility (Pitfall 8).
- Run the child process as a **dedicated low-privilege OS user** with no access to the home dir of the benchmark user; `chmod` the run dir to that user; set `HOME` to the temp dir.
- Apply cheap OS guardrails available now: `ulimit`/`prlimit` (CPU, memory, file size, process count to stop fork bombs), a wall-clock **kill switch/timeout** on every spawned process, and disk quota on the temp dir.
- **Network is the biggest hole and the hardest to close without containers.** If any egress control is possible (network namespace, firewall rule, offline npm cache/registry mirror for the pinned deps), do it. Document explicitly that v1 network isolation is best-effort.

**When to escalate to containerization (v2 trigger conditions — make these explicit in the roadmap):**
- Running any model/prompt/stack you did not author the template for, or accepting scenarios/mockups from outside your team.
- Running unattended/in CI, or in parallel (blast radius multiplies).
- Any stack that legitimately needs install lifecycle scripts or network at build time.
- The moment you cannot confidently answer "what can this generated code reach on my machine?"
Target for v2: rootless container per run (`--network none` unless the build genuinely needs it, read-only root FS, dropped caps, seccomp, mem/CPU limits, non-root UID). The `docker.ts` path already exists in the proposed layout — leave the seam.

**Warning signs:**
Benchmark run touches files outside `tmp/`; outbound connections during `npm install` to unexpected hosts; env dump in a generated file; install time or network traffic wildly inconsistent between runs; any generated `postinstall` script.

**Phase to address:** Workspace Runtime (isolation model + privilege drop) and App Runtime (install/build execution). Must be designed in the **first** phase that executes generated code, not retrofitted.

---

### Pitfall 2: Non-deterministic screenshots break PixelMatch from the inside

**What goes wrong:**
The same generated app screenshotted twice yields different pixels, so the visual score jitters run-to-run and PixelMatch reports differences that reflect timing, not quality. Sources, roughly in order of impact:
- **Fonts** — the app requests a web font that loads over the network with variable timing, or falls back to a system font that differs per machine. Font metrics shift text, which cascades layout and lights up huge diff regions.
- **Animations/transitions** — spinners, fade-ins, skeleton loaders caught mid-frame.
- **Timing/async** — screenshot taken before data/images/layout settle; lazy-loaded content, CLS.
- **Viewport & device-pixel-ratio (DPR)** — DPR ≠ 1 changes raster dimensions; a mismatch vs. the expected image means every pixel is offset.
- **Caret/cursor, scrollbars, current date/time, random data, carousels.**

**Why it happens:**
People assume a screenshot is a pure function of the code. It's a function of code × fonts × timing × viewport × DPR × clock. Playwright *does* auto-disable CSS animations and wait for `document.fonts.ready` before `toHaveScreenshot` — which lulls teams into thinking it's handled, while network fonts, custom render loops, JS animations, and readiness-before-data still leak through.

**How to avoid:**
- **Pin the render surface exactly:** fixed `viewport` (from the stack/scenario spec) and explicit `deviceScaleFactor: 1`. Never rely on the host default DPR.
- **Kill motion and dynamism** before capture: inject `*{animation:none!important;transition:none!important;caret-color:transparent!important}`, hide scrollbars, freeze `Date.now`/`Math.random`/timezone (`page.clock`, fixed `TZ`, seeded data), and mask known-dynamic regions.
- **Self-host / bundle fonts** in the stack template and block external font requests; wait for `document.fonts.ready` *and* network idle *and* an explicit app-ready signal — don't screenshot on a fixed sleep.
- Add a **determinism self-test**: screenshot the *same* built app twice in one run and assert diff ≈ 0. If it isn't, the pixel score is untrustworthy — fail loud rather than record a noisy number.
- Configure PixelMatch tolerance deliberately (`threshold`/antialias handling, `maxDiffPixelRatio`) but treat tolerance as a band-aid, not a fix for nondeterminism.

**Warning signs:**
Same app scores differently on re-render; diff heatmap concentrated on text runs (font issue) or uniformly offset (DPR/viewport); large diffs on spinner/loader locations.

**Phase to address:** Screenshot (Playwright) phase; determinism self-test belongs in the Evaluation Pipeline phase.

---

### Pitfall 3: Comparing screenshots rendered in different environments (the expected image trap)

**What goes wrong:**
Even a perfectly deterministic app fails if the **expected/baseline** screenshot was produced on a different OS/browser/DPR than the generated one. Font hinting and antialiasing differ between macOS, Windows, and Linux, and between headed and headless Chromium; the same HTML/CSS renders subtly different glyphs and edges. PixelMatch then reports a low similarity that reflects *rendering environment*, not *agent quality* — and it does so consistently, so it looks like a real signal. This quietly biases every stack's score by however far its typical output diverges from the baseline's environment.

**Why it happens:**
The expected image is often authored once, casually (designer's Mac, a browser tab), while generated screenshots come from headless Linux Chromium in the pipeline. Nobody records *how* the baseline was made, so the mismatch is invisible.

**How to avoid:**
- **Generate expected screenshots with the exact same renderer** the pipeline uses — same Playwright/Chromium version, same viewport, same DPR, ideally the same OS image. The official `mcr.microsoft.com/playwright` image bakes fonts + browser for reproducibility across machines; standardize on one pinned image/version for *both* baseline creation and run capture (web-verified).
- **Record render provenance** with every screenshot: browser version, OS, viewport, DPR, font set. Refuse to compare, or flag, when baseline provenance ≠ run provenance.
- Pin the Playwright/Chromium version in the lockfile; a browser upgrade silently shifts all baselines (a reproducibility regression — Pitfall 8).
- For LLM-judge and DOM evals, cross-environment rendering matters less — lean on them when pixel comparison is environment-sensitive, but don't let them mask the problem.

**Warning signs:**
Consistent (not noisy) low pixel-similarity across many stacks; diff isolated to glyph edges/antialiasing; baseline file with unknown origin; scores shift after a Playwright/OS bump.

**Phase to address:** Screenshot phase (provenance capture + pinned image) and Specs phase (scenario must declare/produce baseline via the same renderer).

---

### Pitfall 4: Wall-time and performance metrics contaminated by network, registry, and rate limits

**What goes wrong:**
"Wall time," "build time," and "cost/speed" get compared across stacks/models as if they measure the agent — but they're dominated by uncontrolled externals: npm registry latency and cold vs. warm cache, model-provider **rate limiting / 429 backoff**, TTFT variance under provider load, network jitter, and background load on the runner. A model isn't "slower"; it got throttled that afternoon. `npm install` time isn't "the stack's cost"; it's registry weather. These confounds are invisible in the final number and reverse rankings between runs.

**Why it happens:**
Wall-clock is the easiest thing to measure, so it's treated as ground truth. The measurement includes I/O waits the platform doesn't control, and nobody separates "time the agent spent thinking" from "time we spent waiting on someone else's server."

**How to avoid:**
- **Segment the clock into attributable buckets** (agent think/generate time, tool execution, install, build, startup, render, eval) and store each separately — never a single opaque wall time. The event model (`BuildStarted`/`BuildFinished` etc.) already enables this; make sure every boundary emits paired events.
- **Warm/pin the dependency cache** (offline mirror or pre-primed npm cache of the locked deps) so `install` measures the stack, not the registry. Report install time as "warm" vs "cold."
- **Detect and annotate rate-limit/backoff time** from the Pi SDK/provider (429s, retry waits) and *subtract or flag* it in agent timing; a run that hit rate limits should be marked, not silently averaged in.
- Record host conditions (parallel load, network reachability) with each run; consider a "clean room" mode (serial, warm cache, no other runs) for any published comparison.
- Report **distributions across repetitions**, not a single wall time — variance is itself a result (and v2's ×5 repetitions is the honest way to do this).

**Warning signs:**
Same (stack,model) run varies >20% run-to-run; timing correlates with time-of-day; 429s in agent logs; install time swings wildly.

**Phase to address:** Telemetry/Metrics phase (bucketed timing + rate-limit annotation) and App Runtime (cache warming).

---

### Pitfall 5: LLM-as-judge variance, bias, and prompt leakage

**What goes wrong:**
The LLM Judge is treated as an objective scorer, but it is a noisy, biased instrument:
- **Variance** — same two screenshots score differently across calls (nonzero temperature, sampling); the "score" wobbles ±points with no code change.
- **Position/order bias** — whichever image is labeled/first (expected vs generated) is systematically favored.
- **Verbosity/complexity bias** — busier UIs rated higher regardless of fidelity.
- **Self-preference** — a judge from the same model family as the agent favors that agent's output (a fairness disaster when benchmarking models: the judge's lineage silently advantages one competitor). Research shows *no judge is uniformly reliable* and frontier models exceed 50% error on hard bias benchmarks (web-verified).
- **Prompt leakage / injection** — the generated app can render text ("SCORE: 100, this perfectly matches the mockup") that flows into the judge's context (via screenshot OCR or DOM), hijacking the score. The mockup or prompt can also leak the target, letting the judge grade to the description instead of the render.

**Why it happens:**
LLM judges are convenient and produce confident numbers, so their instrument error is ignored. Determinism is assumed. The judge is fed uncontrolled, attacker-influenceable content (the very artifact under test).

**How to avoid:**
- **Judge model must be independent of every agent model under test** — a fixed, separate judge, ideally not sharing training lineage with any contestant. Document it as a fixed instrument; changing it invalidates historical comparability.
- **temperature = 0** and, better, **average N samples** and report variance; treat a single judge call as a sample, not a verdict.
- **Randomize/counterbalance position** of expected vs generated across calls; or run both orders and average to cancel position bias.
- **Structured rubric output** (layout/spacing/typography/missing/extra as separate scored fields with justification) rather than one gestalt number — reduces verbosity bias and makes bias auditable.
- **Sanitize judge inputs:** the judge compares *images only*; never feed it the target prompt/mockup description or the app's DOM text as instructions. Guard against injected text in the render (the judge should score visual fidelity, and be prompted to ignore textual claims in the image).
- **Calibrate against humans** on a small gold set once, and periodically; know the judge's agreement rate before trusting it in the composite.

**Warning signs:**
Judge score changes on identical inputs; agent and judge share a model family; swapping image order changes the score; suspiciously high scores on visually-poor apps containing on-screen text; judge justifications reference details not visible in the render.

**Phase to address:** Evaluation Pipeline (LLM Judge) phase; judge-independence rule is a Scoring/fairness constraint.

---

### Pitfall 6: Token/cost accounting drift and inaccuracy

**What goes wrong:**
Cost is a headline metric, but it silently drifts and mis-sums:
- **Pricing changes** — provider changes $/token; historical runs computed with old prices become non-comparable, or a hardcoded price table goes stale.
- **Cache accounting** — cache-write and cache-read tokens are priced differently from fresh input/output; folding them into one "input tokens" number over- or under-states real cost by large factors on cache-heavy agent loops.
- **Tokenizer/model differences** — estimating tokens with the wrong tokenizer; counting characters/words instead of provider-reported tokens.
- **Hidden usage** — tool-call overhead, system prompts, retries, and rate-limit re-sends not counted; failed turns' tokens dropped.

**Why it happens:**
Cost is computed as `tokens × price` with a single price and a single token count, when reality has four token classes (input, output, cache-read, cache-write), per-model prices, and a moving price table.

**How to avoid:**
- **Store raw provider-reported usage** (all four token classes, per turn) separately and permanently; compute cost as a *derived, re-runnable* view — never store only the final dollar figure. When prices change, recompute; never lose the raw counts.
- **Version the price table** with effective dates; record which price version each cost figure used, so old runs stay reproducible and re-priceable.
- Trust the **provider/Pi SDK usage payload** over any local tokenizer estimate; if estimating, use the exact model tokenizer and reconcile against reported usage.
- Count **failed/retry turns and tool overhead** — they cost real money and are part of the agent's efficiency profile.
- Pin the exact **model version/snapshot** in the run record; "deepseek-4-pro" silently repointing to a new build changes both cost and behavior (reproducibility — Pitfall 8).

**Warning signs:**
Cost doesn't reconcile with the provider dashboard; cost changes after a price update with no code change; cache tokens absent from records; big gap between estimated and billed cost.

**Phase to address:** Telemetry/Metrics phase (raw usage capture) and Storage phase (versioned price table, derived cost view).

---

### Pitfall 7: Biased / unfair benchmark (prompt or template tuned to one stack)

**What goes wrong:**
The benchmark claims to compare stacks/models fairly, but the design advantages one. Failure modes:
- **Prompt tuned to a stack** — the base prompt uses Angular idioms, so Angular wins by construction; the number measures prompt-fit, not stack difficulty.
- **Template head-start asymmetry** — one stack's `template/` ships more scaffolding (routing, state, UI kit) than another's, so "the agent built it" is really "the template did."
- **Skill/MCP asymmetry** — richer skills for one stack.
- **Scenario overfit** — the mockup happens to suit one framework's defaults.
- **Convenience-sample stacks** — only the maintainer's favorite stacks, presented as general truth.

**Why it happens:**
The team knows one stack best, so prompts/templates/skills are written from that vantage. Because v1 proves exactly one row (Angular + DeepSeek), there's no cross-stack pressure to surface the asymmetry — it bakes in silently and only bites when v2 adds stacks and someone publishes a ranking.

**How to avoid:**
- **Keep the base prompt stack-agnostic**; put stack-specific guidance only in the declared, symmetric `skills`/`stack.yaml`, and audit that each stack gets *equivalent* support (same skill depth, same MCP set, comparable template baseline).
- **Normalize template baselines**: define what a template may contain (build config, empty shell) vs. what the agent must produce (all UI/logic). Measure and report template LOC/scaffolding so head-starts are visible, not hidden.
- Even in v1, **write the prompt and harness as if 8 stacks exist** (the declarative-first decision supports this) so no stack-specific assumption leaks into the core.
- **Publish the methodology** (prompt, template contents, skills, judge) alongside scores; a benchmark whose fairness can't be inspected won't be trusted.
- When v2 lands, sanity-check for the "home stack always wins" smell and get an outside eye on the prompt.

**Warning signs:**
Base prompt names a framework/idiom; one template much larger than others; one stack consistently wins on every scenario; skills folder lopsided; reviewers from other stacks object to the prompt.

**Phase to address:** Specs phase (prompt/stack/scenario design + symmetry audit) and Scoring phase (report template baseline as a metric). Design intent set in v1 even though breadth is v2.

---

### Pitfall 8: The reproducibility illusion (nothing pinned, so "same inputs" isn't)

**What goes wrong:**
The core promise is "same inputs → same score," but without pinning, inputs silently move: floating `npm install` resolves new transitive versions; the model snapshot repoints; Playwright/Chromium upgrades shift baselines; the judge model updates; OS/font images change. Re-running "the same" benchmark next month gives a different number, and nobody can say why. Every other pitfall (2, 3, 5, 6) is a specific instance of this.

**Why it happens:**
Defaults float. `npm install` without a lockfile, `deepseek-4-pro` without a build id, `playwright@latest`, an evolving judge — each is convenient and each quietly breaks reproducibility. The platform's whole value proposition dies quietly.

**How to avoid:**
- **Pin everything and record it in the run:** locked deps (`npm ci` + committed lockfile), exact model snapshot/version, Playwright+browser version, judge model+version, OS/font image, and all spec files' content hashes.
- Store a **full "run manifest"** (a reproducibility fingerprint) with every result; two runs are only comparable if their manifests match on the axes being compared.
- Treat any change to a pinned instrument (browser, judge, price table) as a **methodology version bump** that segments historical data — don't average across it.

**Warning signs:**
No lockfile in a template; model/browser/judge referenced by floating tag; run records lack version metadata; re-run of an identical config yields a different score.

**Phase to address:** Cross-cutting — enforce in Workspace/App Runtime (deps), Screenshot (browser), Evaluation (judge), Storage (manifest). Make the run manifest a first-class Storage schema element.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Local temp dir instead of container (v1 decision) | No Docker orchestration; faster to first result | Untrusted code runs on host; not CI-safe; not parallel-safe | Only single-machine, attended, own-authored templates, scripts disabled, creds stripped. Escalate per Pitfall 1 triggers. |
| `npm install` (floating) instead of `npm ci` (locked) | Works without a lockfile in templates | Non-reproducible builds; install time noise; supply-chain drift | Never for published scores. Only in throwaway spikes. |
| Single opaque "wall time" metric | Trivial to capture | Unattributable, confounded, misleading comparisons | Never as a comparison metric; fine as a raw debug field alongside buckets. |
| Store computed dollar cost only (drop raw tokens) | Smaller schema | Can't re-price on rate changes; historical runs frozen at old prices | Never — always keep raw per-turn usage. |
| Single LLM-judge call, temp>0 | One API call, cheap | Noisy non-reproducible score; bias uncorrected | Never for the composite. OK for eyeballing during dev. |
| Judge model = an agent model family | One fewer model to wire | Self-preference contaminates fairness | Never when the shared-family model is under test. |
| Hardcode Angular/DeepSeek assumptions in core | Ship v1 row faster | v2 matrix needs a core rewrite; violates declarative-first | Never — declarative-first is a stated constraint; keep the core generic. |
| Fixed `sleep` before screenshot | Simple | Flaky (too short) or slow (too long); nondeterministic | Never — wait on explicit readiness signals. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Pi SDK (agent) | Calling it from multiple modules; leaking SDK types across the system | Encapsulate fully in Agent Runtime (stated constraint); rest of system speaks a neutral interface. Capture raw usage/events here. |
| npm registry | Treating install as free/fast/deterministic; running lifecycle scripts | `npm ci --ignore-scripts` against a pinned lockfile + warm/offline cache; measure warm vs cold separately. |
| Playwright/Chromium | Assuming default DPR/viewport; using `@latest`; different browser for baseline vs run | Pin browser version + official image; set explicit viewport & `deviceScaleFactor:1`; same renderer for baseline and capture. |
| Model provider | Ignoring 429/backoff time in agent metrics; assuming a stable model behind a name | Detect/annotate rate-limit waits; pin model snapshot id; store provider-reported usage verbatim. |
| axe-core / Lighthouse | Treating a11y score as pass/fail without app being fully rendered/hydrated; version drift changes rule set | Run after readiness signal; pin axe/Lighthouse version in the manifest; store rule-set version. |
| SQLite | Concurrent writers from parallel runs | See Performance Traps — WAL + single-writer queue. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| SQLite write contention under parallel runs | `SQLITE_BUSY`/`database is locked`; lost events; stalls | Enable **WAL mode** + `busy_timeout`; funnel all writes through a **single writer** (one connection/queue), let runs write to per-run files/log and ingest serially; batch event inserts in a transaction | The moment >1 run writes concurrently (v2 parallel matrix). v1 serial is fine — but build the single-writer seam now. |
| Port collisions across runs | Dev server fails to bind; run picks up a *previous* run's server → screenshots the wrong app (silent, corrupts scores) | Allocate a free ephemeral port per run (bind :0 / probe), pass it via the stack spec; never hardcode 4200; assert the server you screenshot is the one you started | As soon as two runs overlap, or a prior run didn't release its port. |
| Dangling / zombie processes | Orphaned `node`/dev-server/browser processes accumulate; RAM exhaustion; ports held; later runs contaminated | Track child PIDs; kill the **process group** (not just the parent) on completion/timeout/error; `try/finally` teardown; reap browsers; verify port freed | Over a long session or many runs; worsens with crashes/timeouts. |
| Playwright browser leak | Chromium instances pile up; memory blow-up | Always `browser.close()` in `finally`; one context per run; cap concurrency | Many runs, especially on failures where cleanup is skipped. |
| Temp dir disk exhaustion | `ENOSPC`; `node_modules` × N runs fills disk | GC old run dirs (keep artifacts, drop `node_modules`); disk quota per run; prune policy | After tens of runs — `node_modules` is huge and multiplies. |
| Unbounded event volume | Telemetry table grows huge; report queries slow | Index by run_id; batch inserts; consider retention/rollup for events vs metrics | v2 matrix (stacks×models×reps×events). |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Running generated code with ambient credentials in env | Key/secret exfiltration via malicious dep/build script | Strip env to an explicit allowlist; give the agent process only what it needs; never expose cloud/ssh creds to the run. |
| `npm install` with lifecycle scripts enabled on untrusted `package.json` | Arbitrary code execution before your code runs (supply-chain / injected dep) | `--ignore-scripts` by default; run-local `.npmrc`; review exceptions. |
| Temp dir treated as a sandbox | Full host read/write/network from generated code | It's a file boundary, not an execution boundary — add privilege drop, ulimits, timeouts; escalate to containers per Pitfall 1. |
| Uncontrolled network egress during run | Data exfiltration; download of second-stage payload | Best-effort egress control in v1 (offline cache/firewall); `--network none` in v2 containers unless build needs it. |
| Prompt injection into the LLM judge via rendered/generated text | Agent scores its own work; benchmark integrity destroyed | Judge on images only; instruct judge to ignore textual claims in the render; independent judge model; sanitize inputs. |
| Logging secrets/prompts verbatim into artifacts/DB | Leak via shared reports/DB | Redact keys from logs; be deliberate about storing full prompts if they contain secrets. |

## UX Pitfalls

("Users" = the engineers/researchers reading the CLI summary and HTML report.)

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Reporting a single composite score with no breakdown | False precision; can't tell *why* a stack won/lost | Show component scores (pixel/DOM/a11y/judge), timing buckets, and cost classes; composite is a summary, not the whole story. |
| No variance / single-run numbers presented as truth | Users over-trust a noisy number | Show run count, spread/CI; flag single-run results as provisional (v2 reps). |
| Hiding failed/partial runs | Survivorship bias inflates results | Report build-failed / didn't-converge runs explicitly; "0" is a result. |
| Screenshots without diff overlay | Can't verify the visual score by eye | Show expected/generated/diff heatmap side by side in HTML. |
| No provenance/manifest in report | Users can't reproduce or trust the number | Print the run manifest (versions, pins) in the report. |

## "Looks Done But Isn't" Checklist

- [ ] **Isolation:** Generated code can't read `~/.ssh`/`~/.aws`/env keys — verify by running a probe "malicious" template and confirming it can't reach them; install scripts disabled.
- [ ] **Screenshot determinism:** Same built app screenshotted twice → diff ≈ 0 — verify with the built-in determinism self-test.
- [ ] **Baseline provenance:** Expected image was rendered by the *same* pinned browser/viewport/DPR as the run — verify manifests match.
- [ ] **Timing attribution:** Wall time is split into buckets and rate-limit time is annotated — verify no single opaque number drives comparisons.
- [ ] **Cost:** Raw per-turn token classes (input/output/cache-read/cache-write) stored; cost is derived and re-priceable — verify against provider dashboard.
- [ ] **Judge:** Independent model, temp 0, position counterbalanced, images-only input — verify identical inputs give a stable score.
- [ ] **Process hygiene:** After a run (incl. on timeout/error), no orphan node/browser processes and the port is freed — verify with a process/port check in teardown.
- [ ] **Reproducibility:** Re-running an identical config produces the same score within known variance — verify by actually re-running once.
- [ ] **Wrong-app guard:** The screenshot is provably of the server this run started (not a leftover) — verify port ownership.
- [ ] **Fairness:** Base prompt names no framework; templates/skills symmetric — verify by diffing template scaffolding and reading the prompt.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Untrusted code compromised host | HIGH | Rotate all exposed credentials immediately; wipe run user/dirs; move to containers before any further runs; audit what the process could reach. |
| Non-deterministic screenshots | MEDIUM | Add determinism self-test; pin viewport/DPR; bundle fonts; kill motion/clock/randomness; re-baseline. |
| Cross-env baselines | MEDIUM | Regenerate all baselines with the pinned pipeline renderer; store provenance; invalidate old pixel scores. |
| Contaminated timing | MEDIUM | Re-run in clean-room mode; annotate rate-limit runs; switch to bucketed timing; report distributions. |
| Cost mis-accounted | LOW (if raw kept) / HIGH (if not) | If raw usage stored: recompute with correct price table. If only dollars stored: data is lost — re-run needed. (Hence: always keep raw.) |
| Judge bias/leakage found | MEDIUM | Swap to independent judge; counterbalance position; sanitize inputs; recalibrate vs humans; re-score affected runs; note methodology version bump. |
| Biased prompt/template | MEDIUM | Neutralize prompt; normalize templates; re-run affected stacks; publish corrected methodology. |
| SQLite lock storms | LOW | Enable WAL + busy_timeout; route writes through single writer; move per-run write-heavy data to files, ingest serially. |
| Port/zombie contamination | LOW–MEDIUM | Ephemeral ports + process-group kill + port-ownership assertion; discard runs where the wrong-app guard can't confirm. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase (component/topic) | Verification |
|---------|-----------------------------------|--------------|
| 1. Untrusted code execution | Workspace Runtime + App Runtime (first exec phase) | Probe template can't reach creds/network; scripts disabled; env stripped |
| 2. Non-deterministic screenshots | Screenshot; self-test in Evaluation Pipeline | Same app twice → diff ≈ 0 |
| 3. Cross-env baseline comparison | Screenshot + Specs (baseline generation) | Baseline manifest == run manifest |
| 4. Timing contamination | Telemetry/Metrics + App Runtime (cache) | Bucketed timing present; rate-limit runs flagged; re-run variance <threshold |
| 5. LLM-judge variance/bias/leakage | Evaluation Pipeline (Judge) + Scoring (independence rule) | Stable score on identical inputs; order-swap invariant; judge ≠ agent family |
| 6. Cost accounting drift | Telemetry/Metrics + Storage (versioned prices) | Reconciles with provider dashboard; re-priceable from raw |
| 7. Benchmark unfairness | Specs (prompt/stack/scenario) + Scoring (report scaffolding) | Prompt framework-agnostic; template LOC symmetric |
| 8. Reproducibility illusion | Cross-cutting; Storage owns run manifest | Re-run identical config → same score within variance |
| Port collisions / zombies | Workspace Runtime + App Runtime lifecycle | Post-run: no orphans, port freed, correct-app guard passes |
| SQLite contention | Storage | WAL + single-writer under a concurrent-write test (v2) |

## Sources

- Playwright visual testing / screenshot stability (auto-disable animations, `document.fonts.ready`, pixelmatch internals, `maxDiffPixelRatio`, official Docker image for cross-machine font/browser consistency) — web-verified 2026-07-01: microsoft/playwright issues #7548 & #11912, testdino.com, dev.to "Why Playwright visual testing doesn't scale", oneuptime.com, browserstack.com. HIGH.
- LLM-as-a-judge biases (position, verbosity, self-preference; "no judge uniformly reliable," frontier models >50% error on bias benchmarks) — web-verified 2026-07-01: arXiv 2410.21819 (Self-Preference Bias), arXiv 2410.02736 (Justice or Prejudice?), mbrenndoerfer.com (position bias), adaline.ai. HIGH.
- npm supply-chain / lifecycle-script execution risk, `npm ci --ignore-scripts`, lockfile determinism — established npm/security practice. HIGH.
- Sandboxing / privilege-drop / container isolation for untrusted code (network namespaces, seccomp, rootless, `--network none`, ulimits) — established container-security practice. HIGH.
- SQLite WAL / `busy_timeout` / single-writer concurrency model — official SQLite documentation & established practice. HIGH.
- Process-group kill, ephemeral port allocation, browser/process cleanup — established Node/OS practice. HIGH.
- Project context: `.planning/PROJECT.md` and root `PROJECT.md` (v1 = single row, local temp dir, all 4 evaluators, SQLite, declarative specs). HIGH.

---
*Pitfalls research for: automated AI-coding-agent benchmark/eval platform (front-end web generation)*
*Researched: 2026-07-01*
