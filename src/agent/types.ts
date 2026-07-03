import type { DurationMs, UsdCost } from "../core/units.js";

// This module is the D4-22 AgentPort boundary and MUST stay Pi-free (no Pi SDK
// import) so the adapter behind it stays swappable (D-23).

/**
 * Resolved run ceilings (D4-01/D4-03) — first to trip aborts the run. The
 * orchestrator converts `scenario.yaml` `budget.maxMinutes` to ms (× 60_000)
 * and passes `maxUsd` / `maxTurns` through. Enforcement lands in the adapter
 * (Plans 04-07/08); this is the fully-resolved shape it monitors against.
 */
export interface AgentBudget {
  maxWallClockMs: DurationMs;
  maxCostUsd: UsdCost;
  maxTurns: number;
}

/**
 * Resolved model selection. `provider` / `modelId` come from `models/*.json`
 * (D4-20); `temperature` is D4-18 (defaults to 0 for the v1 row, resolved
 * upstream by the orchestrator).
 */
export interface AgentModelSpec {
  provider: string;
  modelId: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  temperature: number;
}

/**
 * The D4-22 fully-resolved input the orchestrator hands the adapter. Built from
 * the zod-validated stack / scenario / model specs plus `copyWorkspace`; the
 * adapter never reaches into the spec loaders. Carries no secret material — the
 * provider API key stays in the orchestrator's AuthStorage (D4-19).
 */
export interface AgentInput {
  runId: string;
  /** `copyWorkspace` dir `tmp/<runId>/angular/` — the agent's cwd (D4-23). */
  workspacePath: string;
  /** Scenario prompt, verbatim (D4-04). */
  promptText: string;
  /** Stack-authored environmental grounding (D4-05), prepended to the prompt. */
  preamble: string;
  /** Raw mockup PNG bytes (D4-07). */
  mockupBytes: Buffer;
  /** Mockup MIME type, e.g. `"image/png"` (D4-07). */
  mockupMimeType: string;
  /** Committed `skills/<name>/` dirs → Pi `additionalSkillPaths` (D4-16). */
  skillPaths: string[];
  /**
   * D5-01/D5-14 image gate. When `false` the adapter sends the prompt WITHOUT the
   * mockup image — the resolved model does not accept image input, so paying for
   * image tokens it discards is wasteful. Default (undefined) / `true` = inject.
   * `mockupBytes` is still required regardless; this flag only gates whether it is sent.
   */
  injectImage?: boolean;
  model: AgentModelSpec;
  budget: AgentBudget;
}
