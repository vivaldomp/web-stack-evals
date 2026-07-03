// D-23 isolation seam: plain interfaces only. This module MUST NOT import any
// concrete runtime dependency (Pi SDK / better-sqlite3 / Playwright) — only
// type-only imports of other core contracts are allowed. Concrete adapters
// live in their own modules and depend inward on these interfaces.
import type { AgentEvent, AgentEventDraft } from "./events.js";

/** AGENT-01 seam: the only shape the rest of the system knows about the agent.
 * Producers yield seqless drafts (D4-26) — storage stamps the monotonic per-run
 * `seq` at append time, so two producers can share one run's log without a
 * coordinated counter. */
export interface AgentPort {
  runSession(input: unknown): AsyncIterable<AgentEventDraft>;
}

/** EVAL-05 seam: an evaluator registry entry. */
export interface EvaluatorPort {
  name: string;
  evaluate(input: unknown): Promise<{ rawScore: number; detail: unknown }>;
}

/** Storage seam: the event log + artifact store + manifest persistence.
 * `appendEvent` takes a seqless draft and stamps the next per-run monotonic
 * `seq` atomically (D4-26); `readEvents` returns fully-formed events (seq present). */
export interface StoragePort {
  appendEvent(e: AgentEventDraft): void;
  readEvents(runId: string): AgentEvent[];
  writeArtifact(runId: string, kind: string, filename: string, bytes: Buffer): string;
  getArtifactPath(id: string): string | null;
  persistManifest(m: unknown): void;
}

/** Screenshot target: page URL + fixed viewport (D2-21). */
export interface RenderInput {
  url: string;
  viewport: { width: number; height: number };
}

/** Screenshot bytes + page error signals captured during render (D2-21). */
export interface RenderResult {
  png: Buffer;
  consoleErrors: string[];
  uncaughtExceptions: string[];
  failedRequests: string[];
}

/**
 * RENDER-01 seam (D2-21): the only shape the pipeline knows about Playwright.
 * deviceScaleFactor/reducedMotion/browser-channel are NOT input params here —
 * they are fixed platform choices (D2-12) the concrete implementation hardcodes.
 */
export interface RenderPort {
  screenshot(input: RenderInput): Promise<RenderResult>;
}
