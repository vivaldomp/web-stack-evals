import type { DurationMs, EpochMs } from "./units.js";

/** Base fields every AgentEvent carries (D-04): append-order seq + wall-clock ts. */
export interface BaseEvent {
  runId: string;
  /** Monotonic per-run sequence number; append order is authoritative. */
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

/** Build/serve lifecycle stages (D-06). Lint/test are non-fatal metric stages (D2-14). */
export type Stage = "install" | "build" | "lint" | "test" | "start";

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
  | BenchmarkFinishedEvent;
