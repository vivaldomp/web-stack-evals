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
import type { AgentInput } from "./types.js";
import type { PiEvent } from "./mapEvent.js";

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
