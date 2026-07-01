# Project Research Summary

**Project:** Web Stack Benchmark Platform
**Domain:** Automated benchmark/eval harness for AI coding agents (headless build/render + pixel/DOM/a11y/LLM-judge scoring + telemetry + SQLite persistence)
**Researched:** 2026-07-01
**Confidence:** HIGH

## Executive Summary

This is an eval/benchmark platform, not a user-facing app. Experts in this space (SWE-bench, inspect-ai, VISTA, Design2Code, promptfoo) build these as **reproducible, deterministic, headless pipelines** where the output is a number people trust to make decisions. The dominant lesson across all prior art: a benchmark that isn't reproducible and fair is not a benchmark — it's an anecdote. Every core design choice traces back to reproducibility, isolation, determinism, or fairness.

The recommended approach is a **ports-and-adapters (hexagonal) core** where the orchestrator depends only on abstract ports (`AgentPort`, `BuildRuntime`, `Evaluator`, `Store`). Stacks and scenarios are pure declarative data (`stack.yaml`/`scenario.yaml`), models are config behind one Pi SDK adapter, and evaluators are code behind a registry. Telemetry is a cross-cutting **append-only event log**, and all metrics (cost, iteration count, correction density) are *projections* folded from that log — never computed inline. This makes metrics recomputable without re-running an expensive benchmark. The verified stack is Node 24 / TypeScript 6 with `@earendil-works/pi-coding-agent@0.80.3` (Pi SDK), Playwright, `better-sqlite3`, pixelmatch, `@axe-core/playwright`, zod, and execa.

The key risks are all "silently plausible wrong score" failures, not crashes: (1) **untrusted agent-generated code** runs `npm install`/build on the host with no real isolation in v1 — mitigate with `npm ci --ignore-scripts`, env-stripping, and privilege drop, and gate Docker for v2; (2) **non-deterministic/cross-environment screenshots** wreck pixel scores — pin viewport/DPR, bundle fonts, kill motion, generate baselines with the same renderer; (3) **LLM-judge variance/bias/injection** — independent judge model, temp=0, images-only, position counterbalancing; (4) the **reproducibility illusion** — pin everything and store a run manifest. The single most important build-order insight: **build the entire deterministic pipeline on fixtures before plugging in the flaky, paid, slow agent.**

## Key Findings

### Recommended Stack

Node 24 LTS + TypeScript 6 (strict, nodenext). The one high-risk dependency — the "Pi SDK" — is verified: it is `@earendil-works/pi-coding-agent@0.80.3` (the old `@mariozechner/*` scope is deprecated). Its SDK surface covers everything the Agent Runtime needs: programmatic sessions, multimodal image prompts, skills/prompt loading, model switching, an event stream, and per-turn `usage`/`cost.total`. Reuse its bundled `@earendil-works/pi-ai` directly for the LLM Judge — no second LLM SDK. **Critical caveat: Pi has no native MCP** (deliberate design choice); for the v1 Angular row, Pi's native file tools cover the need, so treat MCP loading as a separate de-risking spike, not a one-line call.

**Core technologies:**
- `@earendil-works/pi-coding-agent@0.80.3` — agent runtime (the only path to the agent) — verified SDK for sessions, image prompts, events, usage/cost
- `playwright@1.61` — headless build render + deterministic screenshots + host for axe-core/DOM checks — industry standard
- `better-sqlite3@12` — results DB — synchronous API ideal for a CLI orchestrator; the DB is the canonical product output
- `pixelmatch@7` + `pngjs@7` — pixel-diff visual similarity — deterministic anchor of the score
- `@axe-core/playwright@4.12` — accessibility eval — solved, deterministic integration
- `zod@4` + `yaml@2` — parse + validate declarative specs and the judge's JSON verdict — fail fast on malformed config
- `commander@15` + `execa@9` — CLI + reliable process-tree teardown (dev servers orphan under native spawn)

### Expected Features

**Must have (table stakes):**
- Declarative spec loader (one stack.yaml / scenario.yaml / model.json) through a generic engine
- Agent Runtime encapsulating the Pi SDK (the swap-a-model seam)
- Event-based telemetry stream — everything downstream folds over it
- Disposable temp workspace + clean teardown + pinned toolchain (`npm ci`)
- Build → start → wait-ready with per-stage timeouts; failures scored, not crashed
- Playwright screenshot at declared viewport with wait-for-render
- All four evaluators (PixelMatch, DOM Diff, axe-core, VLM Judge) behind one extensible interface
- Composite + raw sub-scores persisted separately, normalized
- SQLite (full rep-keyed schema) + artifact store + config/version stamping
- CLI summary + static HTML report with side-by-side visual diff

**Should have (competitive differentiators):**
- **Iteration count + correction density** — the signature metrics almost no comparable tool captures; must ride the event stream from day one
- Full raw trajectory capture (store in v1, analyze in v2)
- Cost/token/TTFT telemetry with first-class per-run cost

**Defer (v2+):**
- Matrix generator + scheduler/concurrency + resume/retry
- Repetitions (N>1) + mean/stddev/pass@k aggregation (schema must allow it in v1)
- Docker-per-run isolation, comparison heatmaps/leaderboards, Lighthouse, historical/regression analysis, Markdown/CSV export

### Architecture Approach

Ports-and-adapters core: the Orchestrator + Metrics Projector depend only on abstract ports and declarative specs, knowing nothing about Pi, concrete stacks, or concrete evaluators. Three tiers of pluggability, each the least powerful mechanism that works — stacks/scenarios as pure data, models as config behind one adapter, evaluators as code behind a registry. Telemetry is a cross-cutting append-only event log; metrics tables (`metrics`, `tool_calls`, `iterations`) are recomputable projections. Refine the vision's 5-domain split by (1) separating Workspace Runtime (owns a disposable dir) from Build/Serve Runtime (owns processes in it), (2) treating telemetry as a spine not a downstream box, and (3) adding an explicit `src/core/ports.ts` contracts module.

**Major components:**
1. Orchestrator — run state machine, sequences domains through ports; knows no specifics
2. Agent Runtime — sole importer of Pi SDK; normalizes SDK events → canonical `AgentEvent` union
3. Workspace Runtime — disposable `tmp/run-XXX/` lifecycle + isolation
4. Build/Serve Runtime — install→build→serve→wait-ready→Playwright screenshot
5. Evaluation Runtime — pixelmatch/dom/a11y/judge pipeline + composite scorer
6. Telemetry Collector + Metrics Projector — append-only log → folded read-models
7. Storage (SQLite + disk artifacts) and Reports (read-only)

### Critical Pitfalls

1. **Untrusted agent code on the host** — `npm install` runs lifecycle scripts with full host privileges; temp dir is a file boundary, not an execution boundary. Avoid: `npm ci --ignore-scripts`, env-stripped spawn (no ambient credentials), privilege drop/ulimits/timeouts; escalate to containers for v2.
2. **Non-deterministic + cross-environment screenshots** — fonts/DPR/timing/animation make pixel scores jitter or systematically bias. Avoid: fixed viewport + `deviceScaleFactor:1`, bundle fonts, kill motion/clock/randomness, generate baselines with the *same* pinned renderer, add a determinism self-test (same app twice → diff≈0).
3. **LLM-judge variance/bias/injection** — noisy, position/verbosity/self-preference biased, hijackable by on-screen text. Avoid: independent judge model (never same family as an agent under test), temp=0 + N-sample averaging, position counterbalancing, structured rubric output, images-only sanitized input.
4. **Cost accounting drift** — four token classes and moving prices break `tokens×price`. Avoid: store raw per-turn usage permanently, version the price table, derive cost as a re-runnable view.
5. **The reproducibility illusion** — floating deps/model/browser/judge silently move "same inputs." Avoid: pin everything and store a full run manifest; a pinned-instrument change is a methodology version bump that segments history.

## Implications for Roadmap

Research strongly endorses a **deterministic-substrate-first** build order (Architecture §Build Order): validate ~80% of the system on fixtures before the agent lands, so the agent is the only new variable when it arrives.

### Phase 1: Foundations & Contracts
**Rationale:** Everything writes through these; ports define the agnostic core.
**Delivers:** repo skeleton, `src/core/ports.ts` + canonical event union, SQLite schema (rep-keyed, WAL, run manifest/spec-snapshot), artifact store, telemetry collector, spec loaders with zod validation.
**Addresses:** declarative spec loader, SQLite schema + version stamping, event stream substrate.
**Avoids:** Pitfall 8 (reproducibility — manifest first-class), Anti-Pattern 6 (over-engineered event store — just append+fold).

### Phase 2: Workspace + Build/Serve Runtime (no agent)
**Rationale:** Run the raw stack template through dir→install→build→serve→screenshot to prove the deterministic pipeline.
**Delivers:** disposable workspace lifecycle + teardown; `npm ci --ignore-scripts`; per-stage timeouts; Playwright screenshot at fixed viewport/DPR with wait-for-render.
**Uses:** execa (process-tree kill), playwright, `get-port`.
**Avoids:** Pitfall 1 (isolation/privilege drop), Pitfall 2 (screenshot determinism), port/zombie traps.

### Phase 3: Evaluation Pipeline + Scorer (on static screenshots)
**Rationale:** Prove all four evaluators + composite deterministically before the agent exists. **Checkpoint: full pipeline green without the LLM.**
**Delivers:** pixelmatch/dom/a11y/judge behind one `Evaluator` interface + registry; normalized composite + raw sub-scores; determinism self-test; baseline provenance check.
**Implements:** Evaluation Runtime, evaluator registry pattern.
**Avoids:** Pitfall 3 (cross-env baselines), Pitfall 5 (judge bias — independent model, temp=0, images-only).

### Phase 4: Agent Runtime (Pi SDK adapter)
**Rationale:** The hardest, most variable, external, paid piece — built last of the runtimes so it's the only unproven variable.
**Delivers:** `AgentPort` implementation; inject prompt+skills+image; normalize Pi events → canonical events; capture raw usage (all four token classes) + derive TTFT.
**Uses:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`.
**Avoids:** Anti-Pattern 1 (SDK leakage), Pitfall 6 (cost drift), Pi's no-MCP gap (use native tools for v1).

### Phase 5: Orchestrator + Metrics Projector + Reports
**Rationale:** Wire the single row end-to-end; fold events into metrics; render output.
**Delivers:** one green row (Angular + DeepSeek 4 Pro + dashboard); metrics/tool_calls/iterations projections; iteration count + correction density; CLI summary + static HTML report with side-by-side visual diff.
**Addresses:** signature differentiators, composite reporting.
**Avoids:** Anti-Pattern 3 (inline metrics), Pitfall 4 (bucketed/attributed timing).

### Phase Ordering Rationale
- Deterministic components (0–3) have no agent dependency and must precede it — debugging five unproven components through one flaky paid black box is the classic trap.
- The orchestrator depends on all runtimes but only through ports, so runtimes are built and tested in isolation.
- Reports/projector depend on a populated event log, so they come after a run can complete.
- Nothing in v1 imports `matrix.ts`/`scheduler.ts`/`docker.ts` — building the matrix before one row works (Anti-Pattern 5) is explicitly avoided; v2 becomes a loop over proven code.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Agent Runtime):** exact Pi SDK event shapes and the MCP gap firm up here; fast-moving 0.80.x version. Consider a de-risking spike for MCP loading and event normalization.
- **Phase 3 (LLM Judge):** judge-independence rule, rubric design, and calibration-vs-humans need a design decision; bias mitigation is subtle.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundations):** SQLite/zod/event-log-fold are well-documented, established patterns.
- **Phase 2 (Workspace/Build):** Playwright + npm + execa teardown are standard; pitfalls are known and enumerated.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against live npm registry; Pi SDK API verified against published docs |
| Features | HIGH | Feature taxonomy well-established across SWE-bench/inspect-ai/Design2Code/VISTA |
| Architecture | HIGH / MEDIUM | Structural patterns follow directly from requirements (HIGH); Pi event shapes + exact SQLite columns firm up in their phases (MEDIUM) |
| Pitfalls | HIGH | Established engineering + eval-research knowledge; key claims web-verified |

**Overall confidence:** HIGH

### Gaps to Address
- **Pi SDK MCP support:** Pi has no native MCP. For v1 use native tools; if a scenario truly needs an external MCP, spike `pi-mcp-adapter` — do not assume `scenario.yaml → mcps:` is a one-call feature. Resolve in Phase 4.
- **Exact Pi event shapes:** the canonical event normalization depends on real SDK event structures — confirm in the Agent Runtime phase.
- **SQLite column typing (tall metrics EAV vs wide):** design proposal; firm up in the storage phase. Get rep-keying and the run manifest right in v1 or v2 forces a migration.
- **v1 network isolation is best-effort** without containers — document consciously; escalate to Docker per Pitfall 1 triggers before any shared/CI/parallel run.
- **Baseline/expected screenshot generation:** must use the same pinned renderer as the run; scenario spec must carry the expected screenshot + provenance.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`), 2026-07-01 — authoritative current versions for all packages
- `github.com/earendil-works/pi` `docs/sdk.md` + `packages/ai/README.md` — verified Pi SDK session/image/events/usage API
- Playwright visual-testing docs + issues (#7548, #11912), official Playwright Docker image — screenshot stability
- LLM-as-judge bias research: arXiv 2410.21819 (self-preference), 2410.02736 (justice/prejudice), position-bias sources
- SWE-bench harness reference, inspect-ai sandbox/scorer architecture — reproducibility + isolation patterns
- Established npm supply-chain, container-security, SQLite WAL, and process-group-kill practice

### Secondary (MEDIUM confidence)
- pi.dev + community docs (pi-mcp-adapter) — Pi's no-native-MCP stance and adapter workaround
- Design2Code / VISTA — UI-fidelity evaluation (CLIP + VLM judge) mapped to this domain

### Tertiary (LOW confidence)
- Exact Pi SDK event shapes and final SQLite column typing — inferred; validate during Agent Runtime and Storage phases

---
*Research completed: 2026-07-01*
*Ready for roadmap: yes*
