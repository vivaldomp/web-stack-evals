// AGENT-01 / D-23: THIS FILE IS THE SOLE IMPORTER of the Pi coding-agent SDK.
// Nothing else under `src/**` may import `@earendil-works/pi-coding-agent` — the
// whole point of this adapter is to encapsulate Pi so the rest of the system
// never knows it exists (ports-and-adapters). `tests/importBoundary.test.ts`
// structurally enforces this invariant and will fail if a second importer appears.
//
// The concrete Pi wiring lives behind the injectable `SessionFactory` seam so the
// adapter's whole event-stream behaviour is validated from a scripted fake session
// with zero network and zero cost (no paid tokens are spent by any Phase-4 test).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { createEventMapper } from "./mapEvent.js";
import type { AgentInput } from "./types.js";
import type { PiEvent } from "./mapEvent.js";
import type { AgentEventDraft } from "../core/events.js";
import type { AgentPort } from "../core/ports.js";
import type { EpochMs } from "../core/units.js";

/** Flat pi-ai `ImageContent` (D4-07): raw base64 + mime, never re-encoded. */
type ImageAttachment = { type: "image"; data: string; mimeType: string };

/**
 * The narrow structural surface the adapter uses from a Pi `AgentSession`. Keeping
 * it structural is the seam that lets a scripted fake stand in for the real
 * session. `abort`/`getSessionStats` are included now — this plan never calls them,
 * but Plan 04-06 (ceilings / teardown / usage reconciliation) needs them, and
 * defining the full seam here avoids reshaping the interface later.
 */
export interface SessionLike {
  subscribe(listener: (e: PiEvent) => void): () => void;
  prompt(text: string, opts: { images: ImageAttachment[] }): Promise<void>;
  abort(): Promise<void>;
  getSessionStats(): { cost: number };
  dispose(): void;
}

/** Injectable session factory (default = {@link createPiSession}). */
export type SessionFactory = (input: AgentInput) => Promise<SessionLike>;

/**
 * The ONLY function that touches the Pi SDK: builds an in-memory-auth,
 * cwd-locked Pi session with the resolved model, skills, and configured built-in
 * retry, then wraps the concrete `AgentSession` as a {@link SessionLike}.
 */
export async function createPiSession(input: AgentInput): Promise<SessionLike> {
  // (1) Auth (D4-19, high severity): key enters process memory ONLY here and is
  // passed ONLY to setRuntimeApiKey over an IN-MEMORY backend — no auth.json on
  // disk, no return value, no log, no subprocess. Fail fast before any paid call.
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set — refusing to start a paid Pi session (D4-19).");
  }
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(input.model.provider, apiKey);
  // ponytail: v1 is deepseek-only, so the env var name is fixed to DEEPSEEK_API_KEY
  // (RESEARCH). Generalise to a `${PROVIDER}_API_KEY` lookup when the matrix grows.

  // (2) Model lookup through Pi's own registry (D4-20) — no platform provider layer.
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.find(input.model.provider, input.model.modelId);
  if (!model) {
    throw new Error(
      `Model not found in Pi registry: ${input.model.provider}/${input.model.modelId}`,
    );
  }

  // (3) Skills via additionalSkillPaths (D4-16). agentDir sits OUTSIDE the angular
  // build tree but inside the run tmp, so it is torn down with the workspace and
  // never pollutes what the agent builds.
  const agentDir = resolve(input.workspacePath, "..", ".pi-agent");
  mkdirSync(agentDir, { recursive: true });

  // Built-in bounded retry (D4-14), configured through SettingsManager — never
  // hand-rolled. In-memory settings so nothing is written to disk.
  // ponytail: retry maxRetries:4 / baseDelayMs:1000 are ASSUMED (RESEARCH A1) — tune after the first live run.
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: true, maxRetries: 4, baseDelayMs: 1000 },
  });

  const loader = new DefaultResourceLoader({
    cwd: input.workspacePath,
    agentDir,
    additionalSkillPaths: input.skillPaths, // D4-16: additionalSkillPaths, NOT skillsOverride
    noContextFiles: true, // benchmark fairness: no ambient AGENTS.md leakage
    settingsManager,
  });
  await loader.reload();
  const skillErrors = loader.getSkills().diagnostics.filter((d) => d.type === "error");
  if (skillErrors.length > 0) {
    // A bad skill path must fail loudly, not silently drop a skill (fairness).
    throw new Error(`Skill load failed: ${skillErrors.map((d) => d.message).join("; ")}`);
  }

  // (4) Session (D4-23 cwd-lock / D4-21 default native tools / D4-14 retry). No
  // `tools`/`noTools` allowlist: the defaults (read, bash, edit, write, grep,
  // find, ls) are exactly AGENT-03/D4-21, so the agent can self-correct via bash.
  const { session } = await createAgentSession({
    cwd: input.workspacePath,
    agentDir,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: input.model.thinkingLevel,
    sessionManager: SessionManager.inMemory(input.workspacePath),
    settingsManager,
    resourceLoader: loader,
  });
  // (5) Temperature resolution (D4-18, RESEARCH OQ1): input.model.temperature is
  // deliberately NOT passed to createAgentSession/prompt.
  // ponytail: temperature not settable via public Pi SDK 0.80.3 (RESEARCH OQ1); v1 accepts the provider default — upgrade path is ModelRegistry.registerProvider with a streamSimple wrapper injecting temperature:0 if benchmark reproducibility demands a hard temp.

  // (6) Wrap the concrete AgentSession behind the SessionLike seam. Casting the
  // real event type to PiEvent here keeps the mapper (and this module's callers)
  // free of any runtime Pi type import.
  return {
    subscribe: (listener) => session.subscribe((e) => listener(e as unknown as PiEvent)),
    prompt: (text, opts) => session.prompt(text, opts),
    abort: () => session.abort(),
    getSessionStats: () => session.getSessionStats(),
    dispose: () => session.dispose(),
  };
}

/** Injectable run dependencies — default `createSession` is {@link createPiSession}. */
export interface RunSessionDeps {
  createSession?: SessionFactory;
  now?: () => EpochMs;
}

/**
 * Callback → async-iterator push-queue: Pi's `subscribe` callback pushes drafts;
 * `stream()` yields them the instant they arrive (never buffered until the run
 * ends, D4-13). `finish()` closes the stream after the prompt settles.
 * ponytail: this is the ~20-line stdlib-Promise bridge; a library would be overkill.
 */
interface EventBridge {
  push(d: AgentEventDraft): void;
  finish(): void;
  stream(): AsyncGenerator<AgentEventDraft>;
}

function eventBridge(): EventBridge {
  const queue: AgentEventDraft[] = [];
  let done = false;
  let resolveNext: (() => void) | null = null;
  const wake = () => {
    const r = resolveNext;
    if (r) {
      resolveNext = null;
      r();
    }
  };
  return {
    push(d) {
      queue.push(d);
      wake();
    },
    finish() {
      done = true;
      wake();
    },
    async *stream() {
      while (true) {
        while (queue.length > 0) yield queue.shift()!;
        if (done) return;
        await new Promise<void>((r) => {
          resolveNext = r;
        });
      }
    },
  };
}

/**
 * The ONLY place `input: unknown` becomes a typed `AgentInput` (D4-22 trust
 * boundary). Defensive structural narrow — not zod, since `AgentInput` is an
 * internal type, not a spec file. Malformed input is rejected before any (paid)
 * session is created.
 */
export function assertAgentInput(input: unknown): AgentInput {
  const isStr = (v: unknown): v is string => typeof v === "string";
  const o = input as Record<string, unknown>;
  const model = o?.model as Record<string, unknown> | undefined;
  if (
    input === null ||
    typeof input !== "object" ||
    !isStr(o.runId) ||
    !isStr(o.workspacePath) ||
    !isStr(o.promptText) ||
    !isStr(o.preamble) ||
    !Buffer.isBuffer(o.mockupBytes) ||
    !isStr(o.mockupMimeType) ||
    !Array.isArray(o.skillPaths) ||
    typeof model !== "object" ||
    model === null ||
    !isStr(model.provider) ||
    !isStr(model.modelId) ||
    typeof o.budget !== "object" ||
    o.budget === null
  ) {
    throw new Error("runSession: input is not a valid AgentInput (D4-22 trust boundary).");
  }
  return input as AgentInput;
}

/**
 * A non-transient / retry-exhausted fatal terminal (D4-14): a `turn_end` whose
 * assistant message stopped on `error`, or an `auto_retry_end` that gave up with a
 * final error. Transient `auto_retry_*` mid-run are NOT fatal — they ride
 * `UnknownEvent` (mapped by 04-04) and the run continues.
 */
export function isFatalTerminal(piEvent: PiEvent): boolean {
  if (piEvent.type === "turn_end") {
    const message = piEvent.message as { stopReason?: string } | undefined;
    return message?.stopReason === "error";
  }
  if (piEvent.type === "auto_retry_end") {
    return piEvent.success === false && Boolean(piEvent.finalError);
  }
  return false;
}

/**
 * The `AgentPort.runSession` implementation (D4-13): narrows the orchestrator's
 * untyped input, creates one cwd-locked Pi session, fires a single mockup-bearing
 * prompt, and live-yields every canonical draft the 04-04 mapper produces. A fatal
 * agent failure ends the stream with `benchmark_finished{agent_error}`; a natural
 * completion yields NO terminal (that whole-run terminal is owned by runStack, D4-21).
 */
export async function* runSession(
  input: unknown,
  deps: RunSessionDeps = {},
): AsyncIterable<AgentEventDraft> {
  const agentInput = assertAgentInput(input);
  const createSession = deps.createSession ?? createPiSession;
  const session = await createSession(agentInput);

  // Three-ceiling budget monitor (D4-01/02/11): wall-clock, cumulative USD, and
  // turn count each bound the paid run; the FIRST to trip aborts and maps to the
  // existing "timeout" terminal (no new enum). Partial work is KEPT (D4-02).
  let turns = 0;
  let tripped: "wall" | "usd" | "turns" | null = null;
  // ponytail: global setTimeout is fake-timer-friendly (vi.useFakeTimers) — no injectable clock dep needed.
  const wallTimer = setTimeout(() => {
    tripped ??= "wall";
    void session.abort();
  }, agentInput.budget.maxWallClockMs);

  const mapEvent = createEventMapper({
    runId: agentInput.runId,
    provider: agentInput.model.provider,
    modelId: agentInput.model.modelId,
    now: deps.now,
  });
  const bridge = eventBridge();
  let sawFatalError = false;

  const unsubscribe = session.subscribe((piEvent) => {
    for (const d of mapEvent(piEvent)) {
      bridge.push(d);
      // ponytail: first-to-trip via ??=; turn = usage event (D4-11); all three ceilings -> "timeout" (existing D-19 enum, no new value).
      if (d.type === "usage") {
        turns += 1;
        if (turns >= agentInput.budget.maxTurns) {
          tripped ??= "turns";
          void session.abort();
        } else if (session.getSessionStats().cost >= agentInput.budget.maxCostUsd) {
          tripped ??= "usd";
          void session.abort();
        }
      }
    }
    if (isFatalTerminal(piEvent)) sawFatalError = true;
  });

  // Fire the SINGLE prompt WITHOUT awaiting it before draining (D4-13). A rejected
  // prompt is a fatal agent error (D4-14); `finally` guarantees the stream closes.
  const settled = session
    .prompt(agentInput.preamble + "\n\n" + agentInput.promptText, {
      images: [
        {
          type: "image",
          data: agentInput.mockupBytes.toString("base64"),
          mimeType: agentInput.mockupMimeType,
        },
      ],
    })
    .then(
      () => {},
      () => {
        sawFatalError = true;
      },
    )
    .finally(() => {
      unsubscribe();
      bridge.finish();
    });

  // Drain live: yield each draft the moment the callback pushes it.
  for await (const draft of bridge.stream()) yield draft;
  await settled;
  clearTimeout(wallTimer);

  const clock = deps.now ?? Date.now;
  // tripped wins: an abort-induced prompt rejection is a timeout, not an agent_error (D4-01/02).
  if (tripped) {
    yield {
      runId: agentInput.runId,
      ts: clock(),
      type: "benchmark_finished",
      status: "timeout",
      failedStage: null,
    };
  } else if (sawFatalError) {
    yield {
      runId: agentInput.runId,
      ts: clock(),
      type: "benchmark_finished",
      status: "agent_error",
      failedStage: null,
    };
  }
  // A natural completion yields NO terminal — the orchestrator (Phase 5) then runs the authoritative runStack build (D4-21).

  session.dispose();
}

/** Default `AgentPort` binding the rest of the system consumes (D-23 seam). */
export const piAgentAdapter: AgentPort = { runSession };
