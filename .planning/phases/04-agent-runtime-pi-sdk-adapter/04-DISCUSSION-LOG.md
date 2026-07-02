# Phase 4: Agent Runtime (Pi SDK adapter) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 4-Agent Runtime (Pi SDK adapter)
**Areas discussed:** Run budget/stop, Prompt assembly, Event mapping, Failure handling, Skills injection, Model+auth config, Agent-vs-platform build, runSession input shape, Agent temperature, Single-prompt vs steering, Event seq ownership, Workspace confinement, Abort+teardown, Assistant-text persistence, Live-vs-batched events, Iteration granularity, Per-tool timeout, Image encoding, Provider selection

---

## Run budget / stop condition

| Option | Description | Selected |
|--------|-------------|----------|
| Wall-clock timeout | Elapsed-time cap | ✓ |
| Cost cap (USD) | Abort on cumulative cost threshold | ✓ |
| Turn/iteration cap | Abort after N turns | ✓ |

**User's choice:** All three ceilings, first-to-trip aborts.
**On hit:** `timeout` status, **keep partial work** (build/score the partial app).
**Budget source:** `scenario.yaml` (fair per-task caps across models/stacks).

---

## Prompt assembly

| Option | Description | Selected |
|--------|-------------|----------|
| Verbatim task + thin env preamble | Prompt+image verbatim, minimal workspace grounding | ✓ |
| Fully verbatim, zero wrapping | Prompt+image only | |
| Rich platform scaffolding | Detailed platform instructions | |

**User's choice:** Verbatim task + thin preamble; preamble is **stack-authored in `stack.yaml`**.
**Also locked:** agent sees **mockup only** (never the expected screenshot); mockup sent **base64 PNG verbatim**.

---

## Event mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal set | `session_started` + `usage` event; rest `UnknownEvent` | ✓ |
| Vision-named set | Add session_started/prompt_sent/assistant_message | |
| You decide | Planner picks | |

**User's choice:** Minimal set. **TTFT** via a lightweight **first-token event** (ts − session_started). Iteration = one Pi agent turn. Assistant text persisted **full/verbatim**. Events stream **live**.

---

## Failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Retry w/ backoff, capped → agent_error | Retry 429/5xx, attribute backoff (TEL-03), cap then fail | ✓ |
| Fail fast, no retry | Any error → agent_error | |

**User's choice:** Retry transient with backoff, non-transient fails fast. **Usage captured even on aborted/errored turns.**

---

## Skills injection

**User's choice:** `scenario.yaml` paths → committed repo `skills/` dir → Pi `DefaultResourceLoader` skillsOverride; fingerprinted (D-10).

---

## Model + auth config

**User's choice:** All model params (incl. `thinkingLevel`, temperature default 0) from `models/*.json`. Provider **API key from env var, orchestrator process only** — never in stripped subprocess env, never persisted/fingerprinted. Provider via Pi `getModel(provider, id)`, no extra abstraction.

---

## Agent-vs-platform build

**User's choice:** Agent **may run build/lint to self-correct** (captured as tool_calls); `runStack` remains the authoritative build/serve/screenshot.

---

## runSession input shape

**User's choice:** Orchestrator hands a fully-resolved typed `AgentInput`; adapter stays a pure `AgentPort` (D-23).

---

## Agent temperature

**User's choice:** Model-spec field, **default 0** for v1 (reproducibility-first), overridable.

---

## Single-prompt vs steering

**User's choice:** **Single prompt, run to `agent_end`**, no platform mid-course steering.

---

## Event seq ownership

**User's choice:** **Storage assigns `seq` on append** (atomic, no writer collision). Revisits the Phase-1 caller-sets-seq contract — flagged as a required contract change (D4-26).

---

## Workspace confinement

**User's choice:** **cwd-locked + path-contained** to `tmp/<run_id>/angular/` (reuse D2-06 guard); isolation verified, not trusted.

---

## Abort + child teardown

**User's choice:** **Abort session + process-tree kill** (reuse Phase 2 execa teardown); no orphaned process/port survives.

---

## Assistant text persistence

**User's choice:** **Full text, verbatim** in UnknownEvent payload (feeds HTML report + debugging).

---

## Live vs batched events

**User's choice:** **Live** — append as they occur (crash leaves faithful partial log).

---

## Iteration granularity

**User's choice:** **One Pi agent turn = one iteration** (= one usage event); correction density folds from repeated file_mutations.

---

## Per-tool timeout

**User's choice:** **No custom per-tool timeout** in v1 — rely on Pi built-in + overall wall-clock.

---

## Image encoding

**User's choice:** **Base64 PNG, verbatim** — no resize/re-encode.

---

## Provider selection

**User's choice:** **From model spec via Pi `getModel()`** — no custom provider abstraction.

---

## Claude's Discretion

- Exact zod/TS shapes and field names for `AgentInput` / `usage` / `first_token` / `session_started`.
- Retry count, backoff curve, transient-vs-non-transient error classification.
- Exact Pi call wiring (`createAgentSession`/`prompt`/`subscribe`) and event→variant mapping.
- Default ceiling values in the `scenario.yaml` schema + fallbacks.
- The env-var name for the provider key.

## Deferred Ideas

- MCP injection (`scenario.yaml mcps:`) — out for v1 row (native tools only); v2 via `pi-mcp-adapter` spike.
- Custom per-tool-call timeout — deferred; wall-clock suffices.
- Platform steering / follow-up prompts — permanently excluded by design (fairness), not a future feature.
- Matrix breadth, Docker isolation, concurrent-row `get-port` — v2 (already Out of Scope).
