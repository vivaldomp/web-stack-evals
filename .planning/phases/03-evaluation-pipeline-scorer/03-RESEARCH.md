# Phase 3: Evaluation Pipeline + Scorer - Research

**Researched:** 2026-07-02
**Domain:** Deterministic multi-evaluator scoring (pixel diffing, DOM structural checks, accessibility auditing, LLM-as-judge) behind a registry, composited into one score.
**Confidence:** HIGH

## Summary

Phase 3 is four small, mostly-independent scoring functions behind one interface, plus a weighted-mean aggregator. Three of the four evaluators are boring, deterministic library calls (`pixelmatch`, `@axe-core/playwright`, and a `page.locator().count()` loop) — the only real design problem is **D3-17**: axe and DOM-presence both need a *live* Playwright `Page`, but Phase 2's `RenderPort.screenshot()` closes the browser before returning, and `runStack()` tears the server down immediately after. The fix is a **new render capability that keeps the page open across screenshot + axe + DOM checks**, added as a sibling function in `src/render/`, never touching `core/ports.ts` (preserves D-23). PixelMatch and the Judge evaluator only need the PNG bytes, so they run outside that live-page window and work identically against stored artifacts or fresh fixtures — this is what makes the "no agent in the loop" checkpoint reachable with plain static fixtures.

The fourth evaluator (LLM judge) is the only evaluator that talks to a network API and the only place `@earendil-works/pi-ai` is imported. I inspected the actual shipped `pi-ai@0.80.3` package (types + compiled model catalog, not just the README) and found two load-bearing, non-obvious facts: **`temperature` is a real `StreamOptions` field, but `claude-opus-4-7` and `claude-opus-4-8` explicitly reject non-default temperature** (`compat.supportsTemperature: false` in the shipped catalog) — so temp=0 (D3-11, locked) rules out Opus as the judge model. `claude-sonnet-5` has no such override, is vision-capable (`input: ["text","image"]`), and is a different model family from the agent-under-test (DeepSeek 4 Pro) — recommended default. pi-ai has **no `generateObject`/structured-output API**; "structured output" is done via its TypeBox-based tool-calling (`Tool.parameters`), so the judge asks the model to call a `submit_verdict` tool and the returned `arguments` are then re-validated with zod before being trusted (satisfies D3-13's "structured + zod-validated" without inventing a second schema system). pi-ai also ships a `fauxProvider()` test double with scripted tool-call responses — this is the mechanism for testing the judge deterministically in CI with zero network calls (see Validation Architecture).

**Primary recommendation:** Add `sharp@0.35.3` and `@axe-core/playwright@4.12.1` as new production deps; add `@earendil-works/pi-ai@0.80.3` for the judge only (not `pi-coding-agent` — that's Phase 4's agent runtime dep). Default judge model: `claude-sonnet-5` via pi-ai's Anthropic provider. Keep `core/ports.ts` untouched; add one new `src/render/renderWithPage.ts` export.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pixel-diff scoring | API/Backend (Node process) | — | Pure CPU-bound buffer comparison, no browser needed once PNGs exist |
| Image normalization (resize) | API/Backend | — | `sharp` runs in-process on PNG buffers before diffing |
| DOM structural presence | API/Backend (drives headless Chromium) | Browser (the page being inspected) | Evaluator code runs in Node; it queries a live page it controls, it does not run inside the page |
| Accessibility audit | API/Backend (drives headless Chromium) | Browser (axe-core injected into the page) | `@axe-core/playwright` injects axe-core JS into the page and pulls results back to Node |
| LLM judge | API/Backend | External LLM provider (Anthropic, via pi-ai) | Node process makes one HTTP call per evaluation; no browser involvement |
| Composite scoring | API/Backend | — | Pure arithmetic over persisted raw scores + weights |
| Evaluator registry | API/Backend | — | In-process module, no I/O of its own |
| Result persistence | Database/Storage | — | `StoragePort`/SQLite, already built in Phase 1 |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVAL-01 | PixelMatch visual-similarity score | `pixelmatch@7.2.0` + `pngjs@7.0.0` + `sharp@0.35.3` normalization pipeline documented below with verified default options (threshold 0.1, includeAA false) |
| EVAL-02 | DOM structural-presence checks | `page.locator(selector).count()` loop against the live page from `renderWithPage`; scenario-declared selector list; drop-when-absent behavior specified |
| EVAL-03 | Accessibility eval via axe-core | `@axe-core/playwright@4.12.1` `AxeBuilder({page}).analyze()`; severity-weighted penalty table specified with citation |
| EVAL-04 | LLM Judge, independent model family, temp=0, images-only, structured rubric | `@earendil-works/pi-ai@0.80.3` tool-calling pattern, `claude-sonnet-5` model id verified from shipped catalog (with the Opus temperature pitfall documented), fingerprint cache design, `fauxProvider()` test strategy |
| EVAL-05 | One `Evaluator` interface + registry | Reuses existing `EvaluatorPort` (`src/core/ports.ts`) unchanged; registry design below |
| SCORE-01 | Composite from sub-scores | Weighted-mean + renormalize-on-drop algorithm specified with worked example |
| SCORE-02 | Persist raw separately from composite | Reuses existing `evaluations` table (D-20) + `runs.composite_score`/`composite_weights` (D-21) unchanged |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pixelmatch` | 7.2.0 (installed, verified `npm view pixelmatch version`) | EVAL-01 pixel diffing | Already pinned by 02-01; the de facto minimal pixel-diff lib, used by Playwright's own visual regression testing internally |
| `pngjs` | 7.0.0 (installed) | Decode/encode PNG buffers for pixelmatch | pixelmatch's own declared peer/companion; already pinned |
| `sharp` | 0.35.3 (`npm view sharp version` = 0.35.3, published 2013, 13yr-old project) | EVAL-01 viewport normalization (D3-05) | Locked in CLAUDE.md as the pre-flagged answer to the dimension-mismatch problem; libvips-backed, fastest Node image resize |
| `@axe-core/playwright` | 4.12.1 (`npm view` confirmed) | EVAL-03 accessibility eval | Official Deque/axe-core Playwright binding; wraps `axe-core@~4.12.1` injection + result collection, nothing to hand-roll |
| `@earendil-works/pi-ai` | 0.80.3 (`npm view` confirmed, published 2 days before research date — matches CLAUDE.md pin exactly) | EVAL-04 judge's LLM call | Locked: "reuse pi-ai, no second LLM SDK" — the same layer that will later report Pi SDK usage/cost |
| `zod` | 4.4.3 (installed) | Judge verdict validation (D3-13), `ScenarioSchema` extensions | Already the project's spec-validation library; `.strict()` pattern already established (D-08) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` (stdlib) | — | Judge fingerprint cache key (D3-14) | Reuse `sha256()` from `src/manifest/fingerprint.ts` verbatim — do not add a hashing library |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pi-ai tool-calling for structured judge output | A dedicated structured-output SDK (e.g. Vercel AI SDK `generateObject`) | Locked out by CONTEXT.md D3-11 ("reuse pi-ai, no second LLM SDK"); pi-ai has no native `generateObject`, but its TypeBox tool-calling + a zod re-validation pass achieves the same guarantee with zero new dependencies |
| `claude-sonnet-5` as judge default | `claude-opus-4-5`/`4-1` (vision-capable, no temperature restriction) | Opus is ~2.5x the token cost of Sonnet for a task (comparing two images against a rubric) that doesn't need frontier reasoning depth; Sonnet-5 is the leaner, equally-capable default. Configurable per D3-11, so either works — this is a recommendation, not a hard lock |
| Live `page.locator()` for DOM presence | Static HTML/DOM string parsing (`cheerio`, regex) | D3-08 explicitly requires running "against the rendered DOM, not the screenshot" — a live page is the only way to see post-hydration/JS-rendered DOM (Angular apps render client-side), so a static parser would silently under-count |

**Installation:**
```bash
npm install sharp@0.35.3 @axe-core/playwright@4.12.1 @earendil-works/pi-ai@0.80.3
```

**Version verification:** confirmed live via `npm view <pkg> version` on 2026-07-02 — all four match the versions pinned in `.claude/CLAUDE.md`. `sharp` and `@axe-core/playwright` are new production deps for this phase (pixelmatch/pngjs/zod already installed from Phase 1/2).

## Package Legitimacy Audit

> `gsd-tools query package-legitimacy check` and `classify-confidence` were unavailable in this environment ("Unknown command" — matches the known gsd-tools-is-lean-sdk gap). Fell back to manual registry verification (`npm view <pkg> time.created`, `repository.url`) as the equivalent signal set.

| Package | Registry | Age | Repo | Verdict | Disposition |
|---------|----------|-----|------|---------|-------------|
| `sharp` | npm | 13 yrs (created 2013-08-20) | github.com/lovell/sharp | OK | Approved |
| `@axe-core/playwright` | npm | 5 yrs (created 2021-06-02) | github.com/dequelabs/axe-core-npm | OK | Approved |
| `pixelmatch` | npm | 11 yrs (created 2015-10-14) | github.com/mapbox/pixelmatch | OK | Approved (already installed) |
| `pngjs` | npm | 14 yrs (created 2012-08-18) | github.com/pngjs/pngjs | OK | Approved (already installed) |
| `@earendil-works/pi-ai` | npm | Actively released (this exact 0.80.3 published 2 days before research date, part of a 27-version release history) | github.com/earendil-works/pi | OK | Approved — already the locked, canonical package per `.claude/CLAUDE.md`; verified by extracting the actual npm tarball and reading its shipped `dist/types.d.ts` and model catalog (stronger than a docs-only check) |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────┐
                        │   scenario.yaml (expectedElements,       │
                        │   evaluatorWeights) — zod-validated       │
                        └───────────────┬───────────────────────────┘
                                        │
   expected.png (mockup) ───┐          │           generated.png (Phase 2 artifact,
   from artifact store       │          │           or a fixture for the no-agent checkpoint)
                             ▼          ▼                    │
                  ┌────────────────────────────┐             │
                  │   evaluateRun() orchestrator │◄────────────┘
                  │   src/pipeline/evaluate.ts    │
                  └───┬───────────┬───────────┬───┘
                      │           │           │
        (PNGs only)   │           │           │  url + viewport
        ┌─────────────┘           │           └──────────────────┐
        ▼                         ▼                               ▼
┌───────────────┐        ┌────────────────┐          ┌──────────────────────────┐
│ PixelMatch     │        │ Judge           │          │ renderWithPage(url,vp)    │
│ Evaluator      │        │ Evaluator       │          │ src/render/renderWithPage │
│ - sharp resize │        │ - fingerprint    │          │  launches ONE browser/    │
│ - pixelmatch   │        │   cache lookup   │          │  context/page, keeps it   │
│ - writes diff  │        │ - pi-ai tool call │          │  open, returns {page,     │
│   PNG artifact │        │ - zod-validate    │          │  screenshot bytes, close} │
└───────┬───────┘        └────────┬────────┘          └────────────┬─────────────┘
        │                          │                                │
        │                          │                    ┌───────────┴───────────┐
        │                          │                    ▼                       ▼
        │                          │          ┌──────────────────┐   ┌────────────────────┐
        │                          │          │ DOM Presence      │   │ Axe Evaluator        │
        │                          │          │ Evaluator          │   │ - AxeBuilder({page})  │
        │                          │          │ - locator.count()  │   │   .analyze()          │
        │                          │          │   per selector     │   │ - severity penalty     │
        │                          │          └─────────┬─────────┘   └──────────┬───────────┘
        │                          │                    │                        │
        │                          │        (after both live evaluators finish → page.close())
        │                          │                    │                        │
        ▼                          ▼                    ▼                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  { rawScore, detail } × 4  →  evaluations table (one row per run,rep,evaluator)     │
└───────────────────────────────────┬───────────────────────────────────────────────┘
                                     ▼
                    ┌────────────────────────────────────┐
                    │  composeScore(scores, weights)        │
                    │  weighted mean, renormalize on drop    │
                    │  src/pipeline/composite.ts             │
                    └───────────────┬────────────────────┘
                                     ▼
                    runs.composite_score + runs.composite_weights
```

### Recommended Project Structure
```
src/
├── eval/
│   ├── registry.ts            # EvaluatorPort registry: name -> factory
│   ├── pixelmatchEvaluator.ts # EVAL-01
│   ├── domEvaluator.ts        # EVAL-02 (imports Playwright Page type — like playwrightRenderer.ts)
│   ├── axeEvaluator.ts        # EVAL-03 (imports Playwright Page type)
│   └── judgeEvaluator.ts      # EVAL-04 (imports pi-ai — the only file that does)
├── pipeline/
│   ├── runStack.ts            # (existing, Phase 2 — unchanged)
│   ├── evaluate.ts            # NEW: evaluateRun() orchestrator (EVAL-05 composition point)
│   └── composite.ts           # NEW: composeScore() — SCORE-01
├── render/
│   ├── playwrightRenderer.ts  # (existing, Phase 2 — unchanged, screenshot()-only callers keep working)
│   ├── renderWithPage.ts      # NEW: keeps page open for axe+DOM (D3-17)
│   └── determinism.ts         # (existing, reused as-is by renderWithPage)
├── specs/
│   └── schema.ts              # EXTEND: ScenarioSchema gains expectedElements + evaluatorWeights
```

### Pattern 1: One shared render pass exposing the live page (D3-17)

**What:** A new function alongside (not replacing) `createPlaywrightRenderer()` that performs the same navigation/determinism setup, but returns the still-open `page` plus an explicit `close()` instead of tearing down before returning.

**When to use:** Whenever an evaluator needs to query the live DOM (axe, DOM-presence). PixelMatch and the Judge never call this — they only need PNG bytes.

**Why not extend `RenderPort`/`RenderResult` (the rejected alternative):** `core/ports.ts` is a D-23 isolation seam that "must not import any concrete runtime dependency." Playwright's `Page` type is concrete. Adding `page: Page` to `RenderResult` would force `core/ports.ts` to `import type { Page } from "playwright"`, breaking the one invariant this phase is explicitly told not to redesign. Keeping `renderWithPage` as a plain function (not a `*Port` interface member) in `src/render/` sidesteps this entirely — exactly the same pattern already used by `playwrightRenderer.ts`, which is "the only file... permitted to import the playwright package" for `RenderPort`. `renderWithPage.ts` and the two live evaluators (`domEvaluator.ts`, `axeEvaluator.ts`) become the small, explicitly-named set of files also allowed to import Playwright's `Page` type for their own internal input typing — `EvaluatorPort.evaluate(input: unknown)` doesn't forbid that, it just means core doesn't know about it.

**Lifecycle:** `renderWithPage()` opens browser → context → page → navigates → takes the screenshot buffer (same determinism controls as `playwrightRenderer.ts`, reused verbatim) → returns `{ png, consoleErrors, uncaughtExceptions, failedRequests, page, close }`. The **caller** (the `evaluateRun()` orchestrator) then runs axe + DOM-presence against `page`, and only calls `close()` after both finish. This is the "page stays open until axe+DOM run, then closes" requirement from `<must_produce>`.

**Example:**
```typescript
// src/render/renderWithPage.ts — sibling to playwrightRenderer.ts, same isolation rule.
import { chromium, type Page } from "playwright";
import type { RenderInput, RenderResult } from "../core/ports.js";
import { blockExternalFonts, installDeterminismControls } from "./determinism.js";

export interface LiveRenderResult extends RenderResult {
  page: Page;
  close: () => Promise<void>;
}

export async function renderWithPage(input: RenderInput): Promise<LiveRenderResult> {
  const consoleErrors: string[] = [];
  const uncaughtExceptions: string[] = [];
  const failedRequests: string[] = [];

  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({
    viewport: input.viewport,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await installDeterminismControls(context);
  const page = await context.newPage();
  await blockExternalFonts(page);
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  context.on("weberror", (e) => uncaughtExceptions.push(String(e.error())));
  page.on("requestfailed", (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ""}`));

  await page.goto(input.url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });

  return {
    png, consoleErrors, uncaughtExceptions, failedRequests, page,
    close: async () => { await context.close(); await browser.close(); },
  };
}
```
`file://` URLs work identically to `http://` here — Playwright's `page.goto()` and axe-core's script injection both work against local file fixtures, which is what makes the "no agent, no dev server" checkpoint possible (see Validation Architecture fixtures).

**Handoff note for Phase 5:** when the orchestrator wires the real agent-built app through evaluation, `runStack()`'s current flow (screenshot → immediately `killProcessTree` in its `finally`) must call `renderWithPage()` instead of `createPlaywrightRenderer().screenshot()`, and defer teardown until axe/DOM finish. `renderWithPage`'s input/output shape was deliberately kept `RenderInput`-compatible so that swap is mechanical, not a redesign. This is out of Phase 3's scope (Phase 3 runs on fixtures) but the seam is shaped for it now.

### Pattern 2: Registry as a plain map, not a framework

**What:** `EvaluatorPort` already exists (`src/core/ports.ts`, unchanged). The "registry" is a `Record<string, () => EvaluatorPort>` (or a plain array) — no plugin loader, no dynamic discovery, because D3-16 locks "all four always run in v1."

**Example:**
```typescript
// src/eval/registry.ts
import type { EvaluatorPort } from "../core/ports.js";
import { createPixelMatchEvaluator } from "./pixelmatchEvaluator.js";
import { createDomEvaluator } from "./domEvaluator.js";
import { createAxeEvaluator } from "./axeEvaluator.js";
import { createJudgeEvaluator } from "./judgeEvaluator.js";

/** Adding a new evaluator = one more entry here (EVAL-05) — no orchestrator edit. */
export function buildRegistry(deps: {
  expectedElements: string[] | undefined; // D3-09: undefined -> DOM evaluator entry is simply omitted
  judgeModel: { provider: string; modelId: string };
}): EvaluatorPort[] {
  const evaluators: EvaluatorPort[] = [
    createPixelMatchEvaluator(),
    createAxeEvaluator(),
    createJudgeEvaluator(deps.judgeModel),
  ];
  if (deps.expectedElements && deps.expectedElements.length > 0) {
    evaluators.push(createDomEvaluator(deps.expectedElements));
  }
  return evaluators;
}
```
This is also how D3-09 ("no expected-elements list → DOM evaluator dropped, not scored") is implemented: the evaluator simply isn't in the registry for that run, so it never produces a row, and the composite step (Pattern 3) renormalizes over whoever *did* run — no special-cased "dropped" branch needed in the scorer itself for this particular case (it still needs one for the *infra-failure* drop case, D3-04).

### Pattern 3: Weighted-mean composite with renormalization (SCORE-01, D3-01..D3-04)

**What:** Composite = weighted mean over evaluators that actually produced a score. A dropped evaluator's weight is redistributed proportionally over the survivors, never treated as 0.

**Worked example:** default weights `{pixelmatch:.25, dom:.25, axe:.25, judge:.25}`, judge dropped (API error after retries): survivors get `weight / sum(survivor weights)` = `.25/.75 = .3333` each. Composite = `.3333*(pixel + dom + axe)`.

**Example:**
```typescript
// src/pipeline/composite.ts
export interface EvalResult { evaluatorName: string; rawScore: number; dropped: false }
export interface DroppedResult { evaluatorName: string; dropped: true; reason: string }
export type EvaluatorOutcome = EvalResult | DroppedResult;

export interface CompositeResult {
  compositeScore: number | null; // null only when every evaluator dropped (D3-04 escalate to eval_error)
  weightsUsed: Record<string, number>; // the RENORMALIZED weights actually applied — re-derivable (D-21)
}

export function composeScore(
  outcomes: EvaluatorOutcome[],
  defaultWeights: Record<string, number>,
): CompositeResult {
  const survivors = outcomes.filter((o): o is EvalResult => !o.dropped);
  if (survivors.length === 0) return { compositeScore: null, weightsUsed: {} };

  const survivorWeightSum = survivors.reduce((sum, s) => sum + (defaultWeights[s.evaluatorName] ?? 0), 0);
  const weightsUsed: Record<string, number> = {};
  let compositeScore = 0;
  for (const s of survivors) {
    const w = (defaultWeights[s.evaluatorName] ?? 0) / survivorWeightSum;
    weightsUsed[s.evaluatorName] = w;
    compositeScore += s.rawScore * w;
  }
  return { compositeScore, weightsUsed };
}
```
`weightsUsed` is exactly what gets written to `runs.composite_weights` — this alone (plus the raw `evaluations` rows) re-derives the composite with no re-run (D-21's requirement), and it self-documents which evaluators survived without needing a separate "which ones dropped" lookup.

### Anti-Patterns to Avoid
- **Scoring a dropped evaluator as 0:** Explicitly forbidden by D3-03/D3-04 — punishes the agent for infrastructure failure. Omit it from the weighted mean entirely (Pattern 3).
- **Giving the judge the prompt, code, or DOM:** D3-12 locks images-only. Don't thread scenario/prompt data into the judge call "for context" — that breaks the independence guarantee the whole evaluator exists to provide.
- **Trusting the judge's tool-call arguments without re-validation:** pi-ai's TypeBox tool schema validates *shape* on the wire, but an LLM can still emit e.g. `layoutFidelity: 1.4` — clamp/validate with zod (`z.number().min(0).max(1)`) before persisting, same as any other untrusted external input.
- **A new SQLite table for the judge cache:** D-20's `evaluations` table is already keyed and queryable; a fingerprint lookup is a `SELECT` over existing `evaluations WHERE evaluator_name='judge'` rows (v1 is single-rep single-run scope, so this is a small scan, not a design problem worth a new table for).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pixel-level image diffing | A custom RGBA-buffer comparison loop | `pixelmatch` | Anti-aliasing tolerance, perceptual color-distance thresholding, and diff-image generation are all subtle to get right; pixelmatch is the field-standard 200-line implementation everyone already trusts |
| PNG encode/decode | Hand-rolled PNG parsing | `pngjs` | PNG is a real binary format with compression, filtering, and chunk structure — never worth reimplementing |
| Accessibility rule checking | Custom WCAG rule checks (alt-text, contrast, ARIA) | `@axe-core/playwright` | axe-core encodes hundreds of WCAG success criteria maintained by Deque against a moving spec; a hand-rolled subset would both under- and over-report |
| Structured LLM output validation | Regex/string-parsing the model's free-text response | zod re-validation of the tool-call `arguments` pi-ai already parses | pi-ai already gives you parsed JSON via tool-calling; the only remaining job is *bounds*-checking it, which is exactly what zod is for |
| Content-addressed cache key for the judge | A custom hash/serialization scheme | `sha256()` from `src/manifest/fingerprint.ts` (already exists) | The project already solved "hash these bytes deterministically" for the run fingerprint (D-10/D-11) — reuse it verbatim rather than inventing a second hashing convention |

**Key insight:** every evaluator in this phase wraps an existing, well-audited library call. The only genuinely new code is the orchestration (registry composition, live-page lifecycle, weighted-mean renormalization) — keep that code small and boring; the temptation in a "scoring pipeline" phase is to over-build a generic plugin/rule-engine system that D3-16 explicitly says isn't needed yet (all four always run in v1).

## Common Pitfalls

### Pitfall 1: pixelmatch throws on dimension mismatch
**What goes wrong:** `pixelmatch(img1, img2, ...)` throws if `img1.length !== img2.length` or if `width`/`height` don't match both buffers — this is not a soft failure, it's an uncaught exception.
**Why it happens:** The mockup PNG (hand-designed, arbitrary export size/DPI) and the generated screenshot (captured at the exact stack viewport, DPR 1) are very unlikely to be pixel-identical dimensions unless the mockup was authored at exactly that size.
**How to avoid:** D3-05 already locks the fix — `sharp` resize **both** images to the stack's declared viewport before decoding with `pngjs` and diffing. Do this unconditionally, not just "when a mismatch is detected" — cheaper and removes a whole conditional branch.
**Warning signs:** A pixelmatch evaluator that works in a hand-picked test fixture but throws the first time a real mockup PNG (any size) is fed in.

### Pitfall 2: axe-core / DOM-presence evaluators need a page that's still open
**What goes wrong:** Calling `AxeBuilder({page}).analyze()` or `page.locator(sel).count()` after the browser/context has already closed throws ("Target page, context or browser has been closed").
**Why it happens:** `createPlaywrightRenderer().screenshot()` closes context+browser in its own `finally` block before returning — by design, for Phase 2's single-purpose use. Reusing that function for evaluation and then separately trying to "get the DOM" afterward is structurally impossible.
**How to avoid:** Use `renderWithPage()` (Pattern 1) and defer `close()` until axe + DOM-presence have both run. Order matters less than not closing early — but it's simplest to run axe and DOM-presence back-to-back against the same untouched page, then close.
**Warning signs:** Intermittent-looking axe/DOM test failures that are actually deterministic — they fail every time evaluation is decoupled from render by even one `await` too many.

### Pitfall 3: `claude-opus-4-7`/`claude-opus-4-8` reject `temperature=0`
**What goes wrong:** If the judge's default or configured model is one of the newer Opus ids, a `temperature: 0` request is rejected by the Anthropic API (surfaced through pi-ai as a stream `error` event).
**Why it happens:** Verified directly from the shipped `@earendil-works/pi-ai@0.80.3` model catalog (`dist/providers/anthropic.models.js`): `"claude-opus-4-7"` and `"claude-opus-4-8"` both carry `compat: { supportsTemperature: false }`, and `dist/types.d.ts` documents this exact behavior ("Claude Opus 4.7+ rejects non-default temperature values").
**How to avoid:** Default the judge to `claude-sonnet-5` (no such override in the catalog, vision-capable, independent family from DeepSeek 4 Pro). If a scenario/model-spec later configures a different Claude model, validate `supportsTemperature !== false` for that model at judge-construction time and fail loudly rather than silently retrying — D3-14's "bounded retry then drop" is for *transient* errors, not a structurally-guaranteed-to-fail configuration.
**Warning signs:** The judge evaluator always drops with the same API error, on every run, regardless of image content — that's a config problem, not a transient one; the retry loop would just burn 3 API calls for nothing.

### Pitfall 4: pi-ai has no forced tool-choice — the judge might just answer in prose
**What goes wrong:** Nothing in pi-ai's documented `StreamOptions`/`Tool` API forces the model to call the `submit_verdict` tool; a model can, in principle, respond with a text block instead.
**Why it happens:** Confirmed by inspecting the README's full Tools section and `dist/types.d.ts` — no `toolChoice`/`tool_choice`-equivalent option is exposed.
**How to avoid:** Write the rubric prompt to explicitly instruct "you must respond by calling `submit_verdict` with your scores — do not respond in plain text." After the call, check `response.content` for a `toolCall` block named `submit_verdict`; if absent, treat it exactly like a transient API failure (bounded retry, D3-04's "tool/infra failure → drop, renormalize, record reason").
**Warning signs:** A judge evaluator that "works" against `claude-sonnet-5` in testing but silently drops against a differently-configured model that ignores tool-use instructions more often.

### Pitfall 5: renormalization edge case — all four evaluators dropped
**What goes wrong:** If every evaluator drops (e.g. a systemic Playwright crash takes out axe+DOM, and the judge API is down simultaneously), `composeScore()` has nothing to average and a naive implementation could produce `NaN` or `0/0`.
**Why it happens:** Division by `survivorWeightSum` when `survivors.length === 0`.
**How to avoid:** Pattern 3's `composeScore()` short-circuits explicitly: zero survivors → `compositeScore: null`. This is the one case D3-04 says should "escalate to a run-level `eval_error` outcome" — the caller checks for `compositeScore === null` and sets `runs.status = 'eval_error'` instead of persisting a bogus `0`.
**Warning signs:** A composite score of exactly `0.0` (vs. `null`) on a run where the detail JSON shows every evaluator dropped — `0.0` reads as "scored terribly," `null` correctly reads as "couldn't be scored at all."

## Code Examples

### PixelMatch pipeline with sharp normalization (D3-05/D3-06)
```typescript
// src/eval/pixelmatchEvaluator.ts
// Source: pixelmatch README (github.com/mapbox/pixelmatch) — verified defaults:
// threshold default 0.1, includeAA default false (== AA-tolerant already; pass explicitly for clarity).
import sharp from "sharp";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { EvaluatorPort } from "../core/ports.js";

export interface PixelMatchInput {
  expectedPng: Buffer;
  generatedPng: Buffer;
  viewport: { width: number; height: number };
}

export function createPixelMatchEvaluator(): EvaluatorPort {
  return {
    name: "pixelmatch",
    async evaluate(rawInput: unknown) {
      const { expectedPng, generatedPng, viewport } = rawInput as PixelMatchInput;

      // D3-05: always normalize both to the stack viewport before diffing.
      const [expBuf, genBuf] = await Promise.all([
        sharp(expectedPng).resize(viewport.width, viewport.height, { fit: "fill" }).png().toBuffer(),
        sharp(generatedPng).resize(viewport.width, viewport.height, { fit: "fill" }).png().toBuffer(),
      ]);

      const expImg = PNG.sync.read(expBuf);
      const genImg = PNG.sync.read(genBuf);
      const diff = new PNG({ width: viewport.width, height: viewport.height });

      const mismatched = pixelmatch(
        expImg.data, genImg.data, diff.data,
        viewport.width, viewport.height,
        { threshold: 0.1, includeAA: false }, // D3-06: AA-tolerant
      );

      const totalPixels = viewport.width * viewport.height;
      const rawScore = 1 - mismatched / totalPixels;

      // D3-07: diff image is always generated — caller persists it as
      // screenshots.role='diff' via storage.writeArtifact(runId, "screenshot", "diff.png", PNG.sync.write(diff)).
      return { rawScore, detail: { mismatchedPixels: mismatched, totalPixels, diffPng: PNG.sync.write(diff) } };
    },
  };
}
```

### Axe severity-weighted scoring (D3-10)
```typescript
// src/eval/axeEvaluator.ts
// Source: axe-core-npm README (github.com/dequelabs/axe-core-npm, packages/playwright) —
// `new AxeBuilder({ page }).analyze()` returns AxeResults with `.violations[]`,
// each violation has `impact: "critical"|"serious"|"moderate"|"minor"` and `.nodes[]`.
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { EvaluatorPort } from "../core/ports.js";

// Penalty per violated NODE (not per rule) — a rule violated on 5 elements is
// worse than the same rule violated once. Weights chosen so 2 critical-impact
// node violations alone floor the score at 0 (critical issues should dominate).
const IMPACT_PENALTY: Record<string, number> = {
  critical: 0.5,
  serious: 0.25,
  moderate: 0.1,
  minor: 0.05,
};

export function createAxeEvaluator(): EvaluatorPort {
  return {
    name: "axe",
    async evaluate(rawInput: unknown) {
      const { page } = rawInput as { page: Page };
      const results = await new AxeBuilder({ page }).analyze();

      let penalty = 0;
      const byImpact: Record<string, number> = {};
      for (const violation of results.violations) {
        const weight = IMPACT_PENALTY[violation.impact ?? "minor"] ?? IMPACT_PENALTY.minor;
        const nodeCount = violation.nodes.length;
        penalty += weight * nodeCount;
        byImpact[violation.impact ?? "minor"] = (byImpact[violation.impact ?? "minor"] ?? 0) + nodeCount;
      }

      const rawScore = Math.max(0, 1 - penalty);
      return { rawScore, detail: { violationCount: results.violations.length, byImpact, penalty } };
    },
  };
}
```
**Per-node vs per-violation rationale:** the requirements ask for "start at 1.0, subtract weighted penalties by impact, floored at 0" without specifying granularity. Per-node is recommended over per-violation-rule because a single `color-contrast` rule failing on 20 elements is a materially worse app than the same rule failing on 1 element — per-rule scoring would treat those identically. `Math.max(0, ...)` satisfies the floor.

### DOM structural presence (D3-08/D3-09)
```typescript
// src/eval/domEvaluator.ts
import type { Page } from "playwright";
import type { EvaluatorPort } from "../core/ports.js";

export function createDomEvaluator(expectedElements: string[]): EvaluatorPort {
  return {
    name: "dom",
    async evaluate(rawInput: unknown) {
      const { page } = rawInput as { page: Page };
      let found = 0;
      const missing: string[] = [];
      for (const selector of expectedElements) {
        const count = await page.locator(selector).count();
        if (count > 0) found++; else missing.push(selector);
      }
      return { rawScore: found / expectedElements.length, detail: { found, declared: expectedElements.length, missing } };
    },
  };
}
```
`expectedElements` is plain CSS selector strings (e.g. `[role="navigation"]`, `.dashboard-card`, `button[type="submit"]`) — ARIA roles are expressed as CSS attribute selectors rather than inventing a separate role-matching mini-language; Playwright's `page.locator()` already handles both natively.

### Judge evaluator: tool-call structured output + fingerprint cache + faux-provider testability (D3-11..D3-14)
```typescript
// src/eval/judgeEvaluator.ts — the only file (besides tests) that imports pi-ai.
// Source: @earendil-works/pi-ai@0.80.3 README §Tools, §Image Input, §Quick Start
// (verified against the actual shipped package, not training data).
import { z } from "zod";
import { Type, type Context, type Models, type Tool } from "@earendil-works/pi-ai";
import type { EvaluatorPort } from "../core/ports.js";
import { sha256 } from "../manifest/fingerprint.js";

const RUBRIC_VERSION = "v1"; // bump this if the rubric prompt/schema ever changes — invalidates old cache entries

const VerdictSchema = z.object({
  layoutFidelity: z.number().min(0).max(1),
  componentPresence: z.number().min(0).max(1),
  visualStylingFidelity: z.number().min(0).max(1),
  rationale: z.string(),
});

const submitVerdictTool: Tool = {
  name: "submit_verdict",
  description: "Submit your rubric scores for how closely the generated screenshot matches the expected mockup.",
  parameters: Type.Object({
    layoutFidelity: Type.Number({ minimum: 0, maximum: 1 }),
    componentPresence: Type.Number({ minimum: 0, maximum: 1 }),
    visualStylingFidelity: Type.Number({ minimum: 0, maximum: 1 }),
    rationale: Type.String(),
  }),
};

const MAX_RETRIES = 2; // D3-04: bounded retry, then drop

export interface JudgeInput { expectedPng: Buffer; generatedPng: Buffer }

export function createJudgeEvaluator(
  models: Models,
  modelSpec: { provider: string; modelId: string },
  lookupCachedVerdict: (fingerprint: string) => Promise<{ rawScore: number; detail: unknown } | null>,
): EvaluatorPort {
  return {
    name: "judge",
    async evaluate(rawInput: unknown) {
      const { expectedPng, generatedPng } = rawInput as JudgeInput;

      // D3-14: cache by input fingerprint — identical images -> free re-run.
      const fingerprint = sha256(Buffer.concat([expectedPng, generatedPng, Buffer.from(RUBRIC_VERSION)]));
      const cached = await lookupCachedVerdict(fingerprint);
      if (cached) return { rawScore: cached.rawScore, detail: { ...(cached.detail as object), cached: true } };

      const model = models.getModel(modelSpec.provider, modelSpec.modelId);
      if (!model) return { rawScore: 0, detail: { dropped: true, reason: `unknown model ${modelSpec.provider}/${modelSpec.modelId}` } };

      const context: Context = {
        systemPrompt:
          "You are an impartial visual QA judge. Compare the two images: the first is the expected design " +
          "mockup, the second is a generated implementation. Score three dimensions from 0 to 1 and always " +
          "respond by calling submit_verdict — never respond in plain text.",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Expected mockup:" },
            { type: "image", data: expectedPng.toString("base64"), mimeType: "image/png" },
            { type: "text", text: "Generated implementation:" },
            { type: "image", data: generatedPng.toString("base64"), mimeType: "image/png" },
          ],
          timestamp: Date.now(),
        }],
        tools: [submitVerdictTool],
      };

      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // D3-11: temperature=0. D3-12: images-only, no prompt/code/DOM given to the judge.
          const response = await models.complete(model, context, { temperature: 0 });
          const toolCall = response.content.find((b) => b.type === "toolCall" && b.name === "submit_verdict");
          if (!toolCall || toolCall.type !== "toolCall") throw new Error("Judge did not call submit_verdict");

          const parsed = VerdictSchema.parse(toolCall.arguments); // untrusted LLM output -> zod boundary
          const rawScore = (parsed.layoutFidelity + parsed.componentPresence + parsed.visualStylingFidelity) / 3; // D3-13
          return {
            rawScore,
            detail: {
              ...parsed, fingerprint, cached: false,
              usage: response.usage, // input/output tokens + cost.total, for later telemetry reuse
            },
          };
        } catch (err) {
          lastError = err;
          if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        }
      }
      // D3-04: tool/infra failure -> drop, don't punish the agent.
      return { rawScore: 0, detail: { dropped: true, reason: String(lastError) } };
    },
  };
}
```
**Note on the return shape:** `EvaluatorPort.evaluate()` returns `{ rawScore, detail }` with no separate "dropped" flag in the interface itself (D-23 keeps the interface minimal) — the orchestrator (`composeScore` input mapping, Pattern 3) treats `detail.dropped === true` as the signal to exclude this evaluator from the weighted mean and renormalize, regardless of whatever numeric `rawScore` was returned alongside it.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| LLM SDK-native structured output (`response_format: json_schema`, OpenAI-style) | pi-ai's tool-calling + external zod validation | Confirmed as of pi-ai 0.80.3 (2026-07) — no native `generateObject` shipped | The judge evaluator must use the tool-call pattern, not a `json_schema` response-format param, when going through pi-ai |
| Anthropic API accepting `temperature` on every model | Newer Opus tiers (4.7+) reject non-default `temperature` | Confirmed in the 0.80.3 catalog's `compat.supportsTemperature` flags | Directly constrains judge model choice under a hard `temperature=0` lock (D3-11) |

**Deprecated/outdated:** none specific to this phase beyond the above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Per-node (not per-rule) axe penalty weighting is the intended interpretation of D3-10 | Code Examples / Axe severity-weighted scoring | If the intended semantics were per-rule, a page with one rule violated on many elements would be over-penalized relative to intent; low risk — either interpretation satisfies "start at 1.0, weighted penalty, floor at 0," and the `detail.byImpact` breakdown makes both auditable and adjustable post-hoc without a schema change |
| A2 | `claude-sonnet-5` (not `claude-opus-*` or `claude-sonnet-4-5`) is the best default judge model | Standard Stack / Pitfall 3 | Low risk — this is explicitly "configurable via a model spec" (D3-11); if wrong, it's a one-line config change, not a redesign. Verified via the actual shipped model catalog that Sonnet-5 supports `temperature` and vision input, which the two most obvious alternatives (Opus-4.7/4.8, which reject temperature) do not |
| A3 | CSS selector strings (not a separate ARIA-role DSL) are sufficient for `scenario.yaml`'s `expectedElements` | Code Examples / DOM structural presence | Low risk — CSS attribute selectors already express ARIA roles (`[role="button"]`); if scenario authors want role-based matching without knowing CSS syntax, this could be revisited, but inventing a parallel DSL now would be premature abstraction per D3-16's "keep it simple, all four always run" framing |

**If this table is empty:** N/A — see entries above; all are low-risk, config-reversible choices, not compliance/security-relevant claims.

## Open Questions

1. **Exact retry count/backoff for the judge (D3-04's "bounded retry")**
   - What we know: D3-04 locks the *behavior* (bounded retry, then drop) but not the exact count.
   - What's unclear: whether 2 retries (3 total attempts) with 250ms/500ms backoff is generous enough, or whether a real Anthropic outage needs more.
   - Recommendation: Ship with `MAX_RETRIES = 2` (Code Examples above) as a named constant, easy to tune later; this is not a schema/architecture decision, just a knob.

2. **Phase 5 wiring of `renderWithPage` into `runStack()`**
   - What we know: Phase 3 introduces `renderWithPage()` as a superset-compatible sibling of `createPlaywrightRenderer().screenshot()`, specifically shaped so it can later replace the screenshot call inside `runStack()` without a redesign.
   - What's unclear: whether Phase 5's orchestrator calls evaluators *from inside* `runStack()` (before its `finally`/teardown) or `runStack()` itself grows an optional "keep alive for evaluation" mode.
   - Recommendation: Out of Phase 3 scope by ROADMAP definition ("Depends on Phase 1... consumes Phase 2 output at wire-up" — wire-up is later). Flagging here so the Phase 5 planner reads this note before touching `runStack.ts`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All of Phase 3 | ✓ | v24.13.1 (via nvm) | — |
| Playwright Chromium | axe/DOM live-page evaluators | ✓ | 1.61.1 (installed, Phase 2) | — |
| Network access to api.anthropic.com | Judge evaluator (live path only) | Not probed — CI-dependent | — | Unit tests use `fauxProvider()` (no network); a live judge test is `test.skipIf(!process.env.ANTHROPIC_API_KEY)` |

**Missing dependencies with no fallback:** none — the fixture-driven checkpoint (this phase's actual success criterion) needs no network access at all.
**Missing dependencies with fallback:** Anthropic API access — covered by the faux-provider unit test path; only the optional live integration test needs a real key.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 (already configured, two-tier) |
| Config file | `vitest.config.ts` (unit) / `vitest.integration.config.ts` (integration/live-browser) |
| Quick run command | `npm test` (== `vitest run`, uses `vitest.config.ts`, excludes `*.integration.test.ts` / `*.selftest.test.ts`) |
| Full suite command | `npx vitest run --config vitest.integration.config.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVAL-01 | Identical images score 1.0; a deliberately-shifted fixture scores lower; dimension mismatch is normalized, never throws | unit | `npx vitest run tests/pixelmatchEvaluator.test.ts` | ❌ Wave 0 |
| EVAL-01 | Diff image is always written as `screenshots.role='diff'` | unit | `npx vitest run tests/pixelmatchEvaluator.test.ts` | ❌ Wave 0 |
| EVAL-02 | Fraction-present scoring against a live page with known elements | integration (needs Chromium) | `npx vitest run --config vitest.integration.config.ts tests/domEvaluator.integration.test.ts` | ❌ Wave 0 |
| EVAL-02 | No `expectedElements` declared → evaluator omitted from registry, composite renormalizes | unit | `npx vitest run tests/registry.test.ts` | ❌ Wave 0 |
| EVAL-03 | A fixture with a known a11y violation (e.g. `<img>` missing `alt`) scores below 1.0; a clean fixture scores 1.0 | integration | `npx vitest run --config vitest.integration.config.ts tests/axeEvaluator.integration.test.ts` | ❌ Wave 0 |
| EVAL-04 | Judge parses a scripted `submit_verdict` tool call into a valid `[0,1]` score via zod | unit (faux provider, no network) | `npx vitest run tests/judgeEvaluator.test.ts` | ❌ Wave 0 |
| EVAL-04 | Identical fingerprint hits the cache and skips a second faux call | unit | `npx vitest run tests/judgeEvaluator.test.ts` | ❌ Wave 0 |
| EVAL-04 | A malformed/missing tool call retries `MAX_RETRIES` times then drops with `detail.dropped=true` | unit (faux provider scripted to fail) | `npx vitest run tests/judgeEvaluator.test.ts` | ❌ Wave 0 |
| EVAL-04 | Live model call end-to-end (optional, gated) | integration, `test.skipIf(!process.env.ANTHROPIC_API_KEY)` | `npx vitest run --config vitest.integration.config.ts tests/judgeEvaluator.live.test.ts` | ❌ Wave 0 |
| EVAL-05 | Registering a new evaluator requires zero orchestrator/core edits | unit | `npx vitest run tests/registry.test.ts` | ❌ Wave 0 |
| SCORE-01 | Weighted mean with all 4 present; renormalization with 1-3 dropped; all-4-dropped → `compositeScore: null` | unit | `npx vitest run tests/composite.test.ts` | ❌ Wave 0 |
| SCORE-02 | Raw sub-scores persist as separate `evaluations` rows; composite/weights persist separately on `runs` | unit (against real `better-sqlite3`, in-memory or temp file, same pattern as existing `storagePort.test.ts`) | `npx vitest run tests/evaluationsPersistence.test.ts` | ❌ Wave 0 |
| ROADMAP SC5 | Full pipeline green end-to-end on fixture screenshots, no agent | integration | `npx vitest run --config vitest.integration.config.ts tests/evalPipeline.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (unit tier — pixelmatch, composite, registry, judge-with-faux-provider; all fast, no browser/network)
- **Per wave merge:** `npx vitest run --config vitest.integration.config.ts` (full suite, including live-browser axe/DOM tests and the end-to-end fixture pipeline)
- **Phase gate:** full suite green before `/gsd-verify-work`, matching the existing Phase 2 pattern (`runStack.integration.test.ts`, `isolation.selftest.test.ts`)

### Wave 0 Gaps
- [ ] `tests/fixtures/eval/expected.png` + `tests/fixtures/eval/generated-match.png` — a matched pair (near-identical, small deliberate diff) for EVAL-01/EVAL-04 fixtures. Can be generated procedurally with `sharp`/`pngjs` in a setup script rather than checked-in binary art.
- [ ] `tests/fixtures/eval/generated-degraded.png` — a mostly-blank/broken image, for the "agent-caused degradation" path (D3-04): proves pixel/judge scores genuinely tank rather than being silently dropped.
- [ ] `tests/fixtures/eval/app.html` — static HTML fixture with a handful of elements matching a sample `expectedElements` list, plus one deliberate accessibility violation (e.g., an `<img>` with no `alt`), loaded via `page.goto('file://...')` in `renderWithPage` — no dev server needed, satisfies "no agent in the loop."
- [ ] `tests/fixtures/eval/app-clean.html` — same shape but accessibility-clean, for the EVAL-03 "clean fixture scores near-1.0" case.
- [ ] A scenario fixture with `expectedElements` **omitted** — exercises D3-09's drop-and-renormalize path without needing a live page at all (the evaluator is never constructed).
- [ ] `ScenarioSchema` extension (`expectedElements`, `evaluatorWeights`) in `src/specs/schema.ts` — currently absent; needed before any scenario-driven test can declare the above fixtures.
- [ ] Framework install: `npm install sharp@0.35.3 @axe-core/playwright@4.12.1 @earendil-works/pi-ai@0.80.3` — none of the three are in `package.json` yet.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase has no user-facing auth surface — local CLI benchmark tool, single operator |
| V3 Session Management | No | No sessions in this phase |
| V4 Access Control | No | No multi-tenant/multi-user boundary in v1 |
| V5 Input Validation | Yes | `zod` `.strict()` on `ScenarioSchema` extensions (`expectedElements`, `evaluatorWeights`) — matches the existing D-08 pattern. **Also applies to the judge's own output**: the LLM's tool-call `arguments` are untrusted external input crossing a trust boundary (an LLM can emit out-of-range numbers or malformed shapes despite the tool schema) — `VerdictSchema.parse()` (zod, `.min(0).max(1)`) is the validation gate before any judge score is persisted or composited |
| V6 Cryptography | Yes (reuse only) | The judge's fingerprint cache key reuses the existing `sha256()` (`node:crypto`, stdlib) from `src/manifest/fingerprint.ts` — no new cryptographic code is introduced, and none should be; this is a cache key, not a security boundary, but "never hand-roll a hash" still applies |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/adversarial LLM tool-call output (an LLM is not a trusted input source, even your own judge model) | Tampering | zod schema validation with explicit numeric bounds (`.min(0).max(1)`) before the verdict is trusted or persisted (see `VerdictSchema` above) |
| A generated app's page triggers unbounded/hanging JS during the live render pass (`renderWithPage`), stalling the evaluation pipeline | Denial of Service | Already mitigated at the render layer by the existing `NAVIGATION_BUDGET_MS`/timeout race pattern in `playwrightRenderer.ts` — `renderWithPage` should reuse the same bounded-navigation pattern, not `waitUntil: "networkidle"` unbounded |
| Judge API key leakage into logs/detail JSON | Information Disclosure | Never log full request/response payloads for the judge call; `detail.usage` (token counts, cost) is fine to persist, raw request headers/auth are not — pi-ai's `apiKey` option is never itself part of the `Context`/response object, so this is a "don't add it" discipline item rather than something requiring new code |

## Sources

### Primary (HIGH confidence — verified by direct package/registry inspection)
- `npm view <pkg> version / time.created / repository.url` for `pixelmatch`, `pngjs`, `sharp`, `@axe-core/playwright`, `@earendil-works/pi-ai` — run 2026-07-02, confirms all pinned versions match `.claude/CLAUDE.md` exactly.
- `@earendil-works/pi-ai@0.80.3` npm tarball, extracted and read directly: `README.md` (Quick Start, Tools, Image Input, Providers and Models, Provider-Specific Options, Faux Provider for Tests sections), `dist/types.d.ts` (`StreamOptions.temperature`, `AnthropicMessagesCompat.supportsTemperature`), `dist/providers/anthropic.models.js` (full Claude model catalog including `claude-sonnet-5`'s `input: ["text","image"]` and the absence of a `supportsTemperature: false` override, vs. `claude-opus-4-7`/`4-8`'s explicit override).
- Existing repo source: `src/core/ports.ts`, `src/storage/schema.sql.ts`, `src/render/playwrightRenderer.ts`, `src/render/determinism.ts`, `src/pipeline/runStack.ts`, `src/manifest/fingerprint.ts`, `src/specs/schema.ts`, `src/storage/storagePort.ts`, `vitest.config.ts`, `vitest.integration.config.ts`, `package.json` — read in full before writing any recommendation, per the mandatory-initial-read/untrusted-input-boundary rules.

### Secondary (MEDIUM confidence — official docs fetched this session)
- `github.com/dequelabs/axe-core-npm` `packages/playwright/README.md` (via WebFetch) — `new AxeBuilder({ page }).analyze()` construction pattern.
- `github.com/mapbox/pixelmatch` `README.md` (via WebFetch) — function signature, full options table (`threshold` default 0.1, `includeAA` default false), dimension-equality requirement.
- axe-core impact levels (`critical`/`serious`/`moderate`/`minor`) and `violations[].nodes` — cross-checked via WebSearch against multiple axe-core/Playwright accessibility-testing guides; this is stable, well-established axe-core API surface (matches the exact wording already used in CONTEXT.md's D3-10).

### Tertiary (LOW confidence)
- None — every load-bearing claim in this document was either verified against the shipped package source or an official docs page fetched this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all five phase-3 packages confirmed on the live npm registry with exact version match to the locked CLAUDE.md stack.
- Architecture (render-seam extension, D3-17): HIGH — grounded directly in the actual current `RenderPort`/`RenderResult`/`playwrightRenderer.ts` source, not assumed API shapes.
- Judge model/API shape (D3-11..D3-14): HIGH — grounded in the actual shipped `pi-ai@0.80.3` tarball (types + compiled model catalog), including a specific, non-obvious pitfall (Opus temperature rejection) that would not have surfaced from documentation alone.
- Pitfalls: HIGH — each pitfall traces to a concrete verified fact (pixelmatch's documented throw behavior, Playwright's page-lifecycle semantics already visible in the existing codebase, the Opus catalog flag, pi-ai's absent tool-choice option).

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (30 days) — shorter revalidation window recommended specifically for the `@earendil-works/pi-ai` model catalog (new Claude model ids ship frequently; re-check `getBuiltinModels('anthropic')` before Phase 3 execution if more than a couple weeks have passed).

## RESEARCH COMPLETE
