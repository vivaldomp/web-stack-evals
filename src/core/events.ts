import type { DurationMs, EpochMs, UsdCost } from "./units.js";

/** Base fields every AgentEvent carries (D-04): append-order seq + wall-clock ts. */
export interface BaseEvent {
  runId: string;
  /** Storage-assigned, monotonic per run (D4-26); append order is authoritative. */
  seq: number;
  ts: EpochMs;
}

/**
 * Passthrough for unrecognized Pi SDK events (D-02): never dropped, never
 * errored — preserves the original Pi `type` string plus the raw payload so
 * the append-only log stays a faithful, complete record.
 */
export interface UnknownEvent extends BaseEvent {
  type: "unknown";
  piType: string;
  raw: unknown;
}

/** One event per individual tool call (D-03) — no per-turn aggregation. */
export interface ToolCallEvent extends BaseEvent {
  type: "tool_call";
  toolName: string;
  argsSummary: string;
  isError: boolean;
}

/** A single file mutation (D-05): op + path + lines added/removed. */
export interface FileMutationEvent extends BaseEvent {
  type: "file_mutation";
  op: "create" | "edit" | "delete";
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

/** Build/serve lifecycle stages (D-06). Lint/test are non-fatal metric stages (D2-14).
 * `render` (D5-13/TEL-03) times the screenshot pass; it lives inside `payload JSON`,
 * so widening it needs no DDL and SCHEMA_VERSION stays 1. */
export type Stage = "install" | "build" | "lint" | "test" | "start" | "render";

export interface StageStartedEvent extends BaseEvent {
  type: "stage_started";
  stage: Stage;
}

export interface StageCompletedEvent extends BaseEvent {
  type: "stage_completed";
  stage: Stage;
  durationMs: DurationMs;
  exitCode: number;
}

export interface StageFailedEvent extends BaseEvent {
  type: "stage_failed";
  stage: Stage;
  durationMs: DurationMs;
  exitCode: number;
}

/** Terminal run outcome (D-19). */
export type RunStatus =
  | "completed"
  | "build_failed"
  | "start_failed"
  | "agent_error"
  | "eval_error"
  | "timeout";

export interface BenchmarkFinishedEvent extends BaseEvent {
  type: "benchmark_finished";
  status: RunStatus;
  failedStage: string | null;
}

/**
 * t0 anchor for the agent turn (D4-10): emitted once on Pi `agent_start`.
 * All relative timings (e.g. TTFT) are measured from this event's `ts`.
 */
export interface SessionStartedEvent extends BaseEvent {
  type: "session_started";
  provider: string;
  modelId: string;
}

/**
 * Emitted once on the first streamed assistant text (D4-10, TEL-03).
 * TTFT = first_token.ts − session_started.ts, folded in Phase 5.
 */
export interface FirstTokenEvent extends BaseEvent {
  type: "first_token";
}

/**
 * One event per Pi `turn_end` (D4-09), carrying verbatim pi-ai `Usage` —
 * token counts and `costUsd` are never pre-rounded (D-26). Also emitted for
 * aborted turns, flagged via `aborted` (D4-15).
 */
export interface UsageEvent extends BaseEvent {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  costUsd: UsdCost;
  aborted: boolean;
}

/**
 * The canonical event union (D-01), keyed by `type`. Every phase downstream
 * imports this and nothing else to describe what happened during a run.
 */
export type AgentEvent =
  | UnknownEvent
  | ToolCallEvent
  | FileMutationEvent
  | StageStartedEvent
  | StageCompletedEvent
  | StageFailedEvent
  | BenchmarkFinishedEvent
  | SessionStartedEvent
  | FirstTokenEvent
  | UsageEvent;

/** Distributive Omit: a bare `Omit<Union, K>` collapses to the union's *common*
 * keys, destroying discriminant narrowing (`e.type === "tool_call"` loses
 * `toolName`). Distributing over each member preserves every variant's fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * Producer-side event shape: everything an `AgentEvent` carries except `seq`,
 * which storage stamps at append time (D4-26). The adapter and runStack yield
 * drafts; the append boundary assigns the monotonic per-run `seq`.
 */
export type AgentEventDraft = DistributiveOmit<AgentEvent, "seq">;
