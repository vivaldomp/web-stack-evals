# Stack Research

**Domain:** Node.js/TypeScript CLI benchmark/eval platform for AI coding agents (agent orchestration + headless build/render + visual/DOM/a11y/LLM evaluation + telemetry + SQLite persistence)
**Researched:** 2026-07-01
**Confidence:** HIGH (all versions verified against the live npm registry; Pi SDK API verified against its published docs)

> Scope: this is the stack to **build the benchmark platform**, not the web frameworks (Angular/React/…) being benchmarked. Those are supplied as declarative `stack.yaml` templates and driven through the generic build/run pipeline.

---

## Pi SDK — Reality Check (the one high-risk dependency)

**Verified.** "Pi SDK" is the **Pi coding agent** by Mario Zechner, now maintained under the `earendil-works` org.

- **Canonical package:** `@earendil-works/pi-coding-agent` @ **0.80.3** (published 2026-06-30). The old `@mariozechner/pi-coding-agent` (0.73.1) is **deprecated** — its npm page literally says *"please use @earendil-works/pi-coding-agent instead going forward"*. Do **not** install the `@mariozechner/*` scope.
- **Unified LLM layer:** `@earendil-works/pi-ai` @ **0.80.3** — the multi-provider LLM API Pi is built on; this is where `Usage`/cost live.
- **Repo/docs:** `github.com/earendil-works/pi` (formerly `badlogic/pi-mono`), monorepo `packages/coding-agent` with `docs/sdk.md`, `docs/rpc.md`, `docs/sessions.md`, and `examples/sdk/`.

### API surface the Agent Runtime module needs (all confirmed from `docs/sdk.md`)

| Requirement (from vision) | Pi SDK API | Confidence |
|---|---|---|
| Start a session programmatically | `const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory(), authStorage, modelRegistry })` → returns `AgentSession` | HIGH |
| Send prompt | `await session.prompt(text, options?)` | HIGH |
| **Inject mockup image (multimodal)** | `session.prompt(text, { images: [{ type: "image", source: { type: "base64", mediaType: "image/png", data } }] })` — `PromptOptions.images: ImageContent[]` | HIGH |
| Load skills / prompt templates | `new DefaultResourceLoader({ skillsOverride, promptsOverride })`, `await loader.reload()`, pass `resourceLoader` to `createAgentSession`; read via `loader.getSkills()` / `loader.getPrompts()` | HIGH |
| Switch model | `getModel(provider, id)` + `session.setModel(model)` / `session.cycleModel()`; `scopedModels` and `thinkingLevel` at session create | HIGH |
| Tool-call events | `session.subscribe(event => …)` → `tool_execution_start` (`event.toolName`), `tool_execution_end` (`event.isError`), `message_update` (`text_delta`), `agent_end`. Returns an unsubscribe fn. | HIGH |
| **Token telemetry** | `AssistantMessage.usage` → `.input`, `.output`, cache read/write counts, and `.cost.total` (USD). Cost is computed from each model's pricing metadata `cost: { input, output, cacheRead, cacheWrite }`. Present on both streaming (`await s.result()`) and non-streaming paths, even on aborted turns. | HIGH |

### Pi SDK risks the roadmap MUST account for

1. **No native MCP support — flagged.** Pi *deliberately* excludes MCP (its design thesis is that MCP bloats the context window). The vision requires loading MCP servers (`filesystem`, `playwright`). Options, in order of laziness:
   - **Reuse Pi Skills / built-in tools** instead of MCP where possible (Pi ships `read`/`write`/`edit`/`bash`; filesystem MCP is largely redundant). *Prefer this for v1.*
   - Use the community **`pi-mcp-adapter`** (npm) to bridge MCP servers into Pi via `directTools`.
   - Write a Pi TypeScript extension that adds MCP.
   - **Roadmap implication:** treat "MCP loading" as its own de-risking spike; do NOT assume `scenario.yaml → mcps:` maps to a one-line SDK call. For the v1 Angular/dashboard row, you likely don't need MCP at all — Pi's native tools cover file I/O.
2. **TTFT not a first-class field.** `usage` has no TTFT. Derive it: timestamp the `prompt()` call and the first `message_update` (`text_delta`) event; delta = TTFT. Low effort, but it's *your* code, not a Pi field.
3. **Fast-moving version.** 0.80.x, ~weekly releases. Pin an exact version and encapsulate everything behind the Agent Runtime module (the vision already mandates this) so a bump never leaks past one file.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24 LTS | Runtime | Project constraint. Native `fetch`, `node:test`, stable ESM, `node:sqlite` (still experimental). |
| TypeScript | 6.0.3 | Language | Project constraint; current major. Use `"module": "nodenext"`, strict mode. |
| `@earendil-works/pi-coding-agent` | 0.80.3 | Agent runtime (the ONLY path to the agent) | Verified SDK: sessions, image prompts, skills, model switching, event stream, usage/cost. See reality-check above. |
| `@earendil-works/pi-ai` | 0.80.3 | LLM layer (transitive via Pi) | Source of `Usage`/`cost.total`; **reuse it directly for the LLM Judge** (vision model call + zod-validated verdict) — no second LLM SDK. |
| `playwright` | 1.61.1 | Headless build render + screenshotting | Industry standard headless browser automation; deterministic viewport screenshots; hosts axe-core injection and DOM presence checks. Use `playwright` (library), not `@playwright/test`, for a non-test CLI. |
| `better-sqlite3` | 12.11.1 | Results database | Battle-tested, **synchronous** API (ideal for a CLI/orchestrator — no async ceremony), rich features, prebuilt binaries. Chosen over `node:sqlite` because the results DB is the product's canonical output and `node:sqlite` still emits `ExperimentalWarning` ("might change at any time"). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pixelmatch` | 7.2.0 | Pixel-diff visual similarity % | Core visual evaluator. Requires equal-dimension RGBA buffers. |
| `pngjs` | 7.0.0 | Decode/encode PNG buffers for pixelmatch | Always (pixelmatch's companion; read expected + actual screenshots, write the diff image). |
| `sharp` | 0.35.3 | Normalize/resize screenshots before diffing | Only if expected vs actual dimensions can differ (e.g. DPR/scroll). Playwright at a fixed viewport usually makes them match — add only when a size mismatch actually bites. |
| `@axe-core/playwright` | 4.12.1 | Accessibility eval (axe-core injected into the page) | v1 a11y evaluator. `new AxeBuilder({ page }).analyze()` → violations. |
| `zod` | 4.4.3 | Schema validation for `stack.yaml`/`scenario.yaml`/`models/*.json` + LLM-Judge output | Always. Parse YAML → validate → typed config. Also validates the Judge's JSON verdict. |
| `yaml` | 2.9.0 | YAML parsing (eemeli/yaml) | Always (declarative specs). Parse to plain object, then hand to zod. |
| `commander` | 15.0.0 | CLI framework (`run`, `report`, `compare` subcommands) | Mature, boring, zero-drama subcommand parsing. |
| `execa` | 9.6.1 | Spawn/manage `npm install`/`build`/`start` in the temp workspace | Promise-based child_process with **reliable process-tree teardown** — critical because dev servers spawn children that orphan under native `spawn`. |
| `get-port` | 7.2.0 | Allocate a free port per run | Only if you don't pin the port from `stack.yaml`. Avoids collisions when v2 runs rows concurrently. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` (4.22.4) | Run TS directly (dev + shipped CLI entry) | No bundler for v1 — `tsx src/cli/run.ts`. Skip a build step until distribution actually demands it. |
| `typescript` (6.0.3) `tsc --noEmit` | Type-checking gate | Typecheck in CI/pre-commit; runtime is `tsx`. |
| `vitest` (4.1.9) | Test runner | ESM-native, fast, good mocking for stubbing the Pi SDK and pixelmatch scoring. Native `node:test` is the zero-dep alternative if you want to avoid the dep. |

---

## Installation

```bash
# Core
npm install @earendil-works/pi-coding-agent playwright better-sqlite3

# Evaluation + config
npm install pixelmatch pngjs @axe-core/playwright zod yaml

# CLI + process control
npm install commander execa get-port

# Optional (add only when needed)
npm install sharp                 # screenshot normalization
npm install playwright-lighthouse # Lighthouse a11y/perf (deferred, see below)

# Dev
npm install -D typescript tsx vitest @types/node @types/pngjs @types/better-sqlite3

# One-time: browser binary
npx playwright install chromium
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `better-sqlite3` | `node:sqlite` (built-in, Node 24) | Once `node:sqlite` sheds its experimental status. APIs are near-identical (`DatabaseSync`/`StatementSync`, synchronous) so migration is cheap. Choose it if you must avoid a native-addon build entirely. |
| `commander` | `citty` (0.2.2) / native `node:util parseArgs` | `citty` for an unjs-native/ESM-first feel; `parseArgs` if the CLI stays to one flat command with no subcommands (ultra-lazy, zero dep). |
| `vitest` | `node:test` + `node:assert` | Zero-dep native testing; pick it if you want no test framework dependency and don't need snapshot/rich mocking. |
| `execa` | native `node:child_process spawn` | Fine for a single, well-behaved process; switch back to native only if you never spawn long-lived dev servers (you do). |
| `tsx` (run TS) | `tsdown`/`tsup` bundle, or `tsc` emit | Only when you need to distribute a compiled artifact (npm publish / standalone binary). Not needed for v1. |
| Playwright DOM checks | dedicated DOM-diff lib | The vision's "DOM diff" is really structural-presence checks (button/sidebar/cards exist?). Do it with Playwright locators/`page.evaluate` — no library needed. |
| axe-core (v1) | `lighthouse` 13.4.0 via `playwright-lighthouse` 4.0.0 | Add Lighthouse in a later milestone for perf + best-practices + SEO scores. Heavier (drives its own Chrome run); axe-core covers WCAG for v1. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@mariozechner/pi-coding-agent` | **Deprecated**; upstream says migrate | `@earendil-works/pi-coding-agent` |
| A second LLM SDK for the Judge | Redundant — Pi already bundles `@earendil-works/pi-ai` with multimodal + cost tracking | Reuse `@earendil-works/pi-ai` for the vision-model Judge |
| Assuming `scenario.yaml → mcps:` is a one-call Pi feature | Pi has **no native MCP**; this will silently no-op or need an adapter | Prefer Pi Skills/native tools for v1; spike `pi-mcp-adapter` only if a scenario truly needs an external MCP |
| `sqlite3` (async, node-sqlite3) | Callback/async API is clumsy for a synchronous orchestrator; slower for this workload | `better-sqlite3` (sync) |
| `js-yaml` | Older API; `yaml` (eemeli) has better spec compliance and richer parsing | `yaml` 2.9.0 |
| `puppeteer` | Narrower (Chromium-only), weaker a11y/screenshot ecosystem for this use | `playwright` |
| A bundler in v1 | Build step with no payoff for an internal CLI | Run TS with `tsx` |
| Storing results as JSON only | Vision explicitly wants queryable cost/correction/file metrics without reprocessing | `better-sqlite3` |

---

## Stack Patterns by Variant

**If a scenario genuinely needs an external MCP server (v2+):**
- Use `pi-mcp-adapter` with `directTools` to promote only the tools you need.
- Because Pi has no native MCP and full MCP proxying reintroduces the context bloat Pi avoids.

**If expected vs generated screenshots can differ in size:**
- Insert `sharp` to resize both to the `stack.yaml` viewport before `pixelmatch`.
- Because `pixelmatch` throws on mismatched dimensions.

**If v2 runs multiple matrix rows concurrently:**
- Use `get-port` per run + `execa` process-tree kill on teardown; one SQLite file with WAL mode (`PRAGMA journal_mode=WAL`) tolerates concurrent readers.
- Because parallel dev servers collide on fixed ports and orphan child processes.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@earendil-works/pi-coding-agent@0.80.3` | `@earendil-works/pi-ai@0.80.3` | Keep the two Pi packages on the **same version**; they're released in lockstep from one monorepo. Pin exact versions (fast-moving). |
| `pixelmatch@7` | `pngjs@7` | Pngjs provides the RGBA `data` buffer + `width`/`height` pixelmatch needs. |
| `@axe-core/playwright@4.12` | `playwright@1.61` | Peer of Playwright; injects `axe-core@4.12` into the page. |
| `better-sqlite3@12` | Node 24 | Native addon — ships prebuilt binaries for Node 24 on common platforms; needs a C++ toolchain only if prebuilt is missing. |
| `node:sqlite` | Node 24 | Available but **experimental** (`ExperimentalWarning` on require); exports `DatabaseSync,StatementSync,Session,backup`. |
| `zod@4` | `yaml@2` | Parse YAML → `zod.parse()`. Zod 4 has breaking changes vs 3 — write schemas against the v4 API. |

---

## Sources

- npm registry (`npm view … version`), 2026-07-01 — authoritative current versions for every package above (HIGH).
- `github.com/earendil-works/pi` `packages/coding-agent/README.md` + `docs/sdk.md` — verified `createAgentSession`, `session.prompt({images})`, `DefaultResourceLoader`, `getModel`/`setModel`/`cycleModel`, `session.subscribe` events (HIGH).
- `github.com/earendil-works/pi` `packages/ai/README.md` — verified `AssistantMessage.usage.{input,output,cost.total}` and model pricing metadata (HIGH).
- npm deprecation notice on `@mariozechner/pi-coding-agent` — confirms migration to `@earendil-works` scope (HIGH).
- pi.dev + community docs (my-pi, pi-mcp-adapter) — confirm Pi's deliberate no-native-MCP stance and the adapter workaround (MEDIUM).
- Local check: `node -e "require('node:sqlite')"` on Node 24.13.1 — confirms availability + experimental warning (HIGH).

---
*Stack research for: Node.js/TypeScript AI-agent benchmark platform*
*Researched: 2026-07-01*
