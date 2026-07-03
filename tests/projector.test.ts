import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, appendEvent } from "../src/storage/db.js";
import { projectMetrics } from "../src/telemetry/projectMetrics.js";
import type Database from "better-sqlite3";
import type { AgentEventDraft } from "../src/core/events.js";

// Mirror tests/db.test.ts: tmp-file DB via openDb, cleaned up afterEach.
let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
function freshDb(): Database.Database {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-projector-test-"));
  return openDb(join(dir, "results.sqlite"));
}
function appendAll(db: Database.Database, drafts: AgentEventDraft[]): void {
  for (const d of drafts) appendEvent(db, d);
}

interface MetricRow {
  value: number;
  unit: string;
}
function metric(db: Database.Database, runId: string, name: string): MetricRow | undefined {
  return db
    .prepare("SELECT value, unit FROM metrics WHERE run_id = @r AND name = @n")
    .get({ r: runId, n: name }) as MetricRow | undefined;
}
interface ToolRow {
  call_count: number;
  error_count: number;
}
function tool(db: Database.Database, runId: string, name: string): ToolRow | undefined {
  return db
    .prepare("SELECT call_count, error_count FROM tool_calls WHERE run_id = @r AND tool_name = @n")
    .get({ r: runId, n: name }) as ToolRow | undefined;
}
interface IterRow {
  iteration_index: number;
  correction_count: number;
}
function iterations(db: Database.Database, runId: string): IterRow[] {
  return db
    .prepare(
      "SELECT iteration_index, correction_count FROM iterations WHERE run_id = @r ORDER BY iteration_index ASC",
    )
    .all({ r: runId }) as IterRow[];
}

function usage(runId: string, ts: number, cost: number, tokens: Partial<Record<
  "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalTokens",
  number
>> = {}): AgentEventDraft {
  return {
    type: "usage",
    runId,
    ts,
    inputTokens: tokens.inputTokens ?? 0,
    outputTokens: tokens.outputTokens ?? 0,
    cacheReadTokens: tokens.cacheReadTokens ?? 0,
    cacheWriteTokens: tokens.cacheWriteTokens ?? 0,
    totalTokens: tokens.totalTokens ?? 0,
    costUsd: cost,
    aborted: false,
  };
}

describe("projectMetrics — TEL-03 performance golden fixture", () => {
  it("folds ttft/start/build/render/wall/cost/tokens to the exact VALIDATION values", () => {
    const db = freshDb();
    const r = "perf";
    appendAll(db, [
      { type: "session_started", runId: r, ts: 1000, provider: "deepseek", modelId: "m" },
      { type: "first_token", runId: r, ts: 1200 },
      { type: "stage_completed", runId: r, ts: 1300, stage: "start", durationMs: 150, exitCode: 0 },
      { type: "stage_completed", runId: r, ts: 5300, stage: "build", durationMs: 4000, exitCode: 0 },
      { type: "stage_completed", runId: r, ts: 5900, stage: "render", durationMs: 600, exitCode: 0 },
      usage(r, 2000, 0.01, {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        totalTokens: 165,
      }),
      usage(r, 3000, 0.02, {
        inputTokens: 200,
        outputTokens: 60,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
        totalTokens: 280,
      }),
      { type: "benchmark_finished", runId: r, ts: 9000, status: "completed", failedStage: null },
    ]);
    projectMetrics(db, r);

    expect(metric(db, r, "ttft_ms")).toEqual({ value: 200, unit: "ms" });
    // start_ms + render_ms prove the data-driven <stage>_ms fold covers the
    // TEL-03 startup (D5-13) + render stages 05-01 emits, not just build.
    expect(metric(db, r, "start_ms")).toEqual({ value: 150, unit: "ms" });
    expect(metric(db, r, "build_ms")).toEqual({ value: 4000, unit: "ms" });
    expect(metric(db, r, "render_ms")).toEqual({ value: 600, unit: "ms" });
    expect(metric(db, r, "wall_ms")).toEqual({ value: 8000, unit: "ms" });
    // Cost verbatim, unrounded (D-26): 0.01 + 0.02 = 0.03.
    expect(metric(db, r, "cost_usd")).toEqual({ value: 0.03, unit: "usd" });
    expect(metric(db, r, "input_tokens")).toEqual({ value: 300, unit: "tokens" });
    expect(metric(db, r, "output_tokens")).toEqual({ value: 110, unit: "tokens" });
    expect(metric(db, r, "cache_read_tokens")).toEqual({ value: 30, unit: "tokens" });
    expect(metric(db, r, "cache_write_tokens")).toEqual({ value: 5, unit: "tokens" });
    expect(metric(db, r, "total_tokens")).toEqual({ value: 445, unit: "tokens" });
    db.close();
  });
});

describe("projectMetrics — TEL-03 backoff (D5-12)", () => {
  it("sums paired auto_retry start/end deltas into backoff_wait_ms", () => {
    const db = freshDb();
    const r = "backoff";
    appendAll(db, [
      { type: "unknown", runId: r, ts: 1000, piType: "auto_retry_start", raw: {} },
      { type: "unknown", runId: r, ts: 1500, piType: "auto_retry_end", raw: {} },
      { type: "unknown", runId: r, ts: 2000, piType: "auto_retry_start", raw: {} },
      { type: "unknown", runId: r, ts: 2800, piType: "auto_retry_end", raw: {} },
    ]);
    projectMetrics(db, r);
    expect(metric(db, r, "backoff_wait_ms")).toEqual({ value: 1300, unit: "ms" });
    db.close();
  });
});

describe("projectMetrics — TEL-04 engineering", () => {
  it("folds files_created/edited + lines_added/removed", () => {
    const db = freshDb();
    const r = "eng";
    appendAll(db, [
      { type: "file_mutation", runId: r, ts: 1, op: "create", path: "A", linesAdded: 10, linesRemoved: 0 },
      { type: "file_mutation", runId: r, ts: 2, op: "edit", path: "A", linesAdded: 3, linesRemoved: 1 },
      { type: "file_mutation", runId: r, ts: 3, op: "create", path: "B", linesAdded: 5, linesRemoved: 0 },
    ]);
    projectMetrics(db, r);
    expect(metric(db, r, "files_created")?.value).toBe(2);
    expect(metric(db, r, "files_edited")?.value).toBe(1);
    expect(metric(db, r, "lines_added")?.value).toBe(18);
    expect(metric(db, r, "lines_removed")?.value).toBe(1);
    db.close();
  });
});

describe("projectMetrics — TEL-05 iterations + correction density (D5-11)", () => {
  it("counts iterations by usage and attributes corrections by seq", () => {
    const db = freshDb();
    const r = "corr";
    // seq: create A, usage, edit A, edit A, usage, create B
    appendAll(db, [
      { type: "file_mutation", runId: r, ts: 1, op: "create", path: "A", linesAdded: 1, linesRemoved: 0 },
      usage(r, 2, 0),
      { type: "file_mutation", runId: r, ts: 3, op: "edit", path: "A", linesAdded: 1, linesRemoved: 0 },
      { type: "file_mutation", runId: r, ts: 4, op: "edit", path: "A", linesAdded: 1, linesRemoved: 0 },
      usage(r, 5, 0),
      { type: "file_mutation", runId: r, ts: 6, op: "create", path: "B", linesAdded: 1, linesRemoved: 0 },
    ]);
    projectMetrics(db, r);
    expect(metric(db, r, "iteration_count")?.value).toBe(2);
    expect(metric(db, r, "correction_density")).toEqual({ value: 1.0, unit: "ratio" });
    // A written 3× → 2 corrections, both during iterationIndex 1; B → 0.
    expect(iterations(db, r)).toEqual([
      { iteration_index: 0, correction_count: 0 },
      { iteration_index: 1, correction_count: 2 },
    ]);
    db.close();
  });
});

describe("projectMetrics — TEL-06 tool calls", () => {
  it("groups tool_call by toolName with error counts", () => {
    const db = freshDb();
    const r = "tools";
    appendAll(db, [
      { type: "tool_call", runId: r, ts: 1, toolName: "bash", argsSummary: "", isError: false },
      { type: "tool_call", runId: r, ts: 2, toolName: "bash", argsSummary: "", isError: false },
      { type: "tool_call", runId: r, ts: 3, toolName: "bash", argsSummary: "", isError: true },
      { type: "tool_call", runId: r, ts: 4, toolName: "read", argsSummary: "", isError: false },
      { type: "tool_call", runId: r, ts: 5, toolName: "read", argsSummary: "", isError: false },
      { type: "tool_call", runId: r, ts: 6, toolName: "write", argsSummary: "", isError: false },
    ]);
    projectMetrics(db, r);
    expect(tool(db, r, "bash")).toEqual({ call_count: 3, error_count: 1 });
    expect(tool(db, r, "read")).toEqual({ call_count: 2, error_count: 0 });
    expect(tool(db, r, "write")).toEqual({ call_count: 1, error_count: 0 });
    db.close();
  });
});

describe("projectMetrics — partial log never crashes (D5-05)", () => {
  it("folds what exists without session_started; wall_ms falls back to max-min ts", () => {
    const db = freshDb();
    const r = "partial";
    appendAll(db, [
      { type: "stage_failed", runId: r, ts: 1000, stage: "build", durationMs: 4000, exitCode: 1 },
      usage(r, 1200, 0.05),
      { type: "benchmark_finished", runId: r, ts: 3000, status: "build_failed", failedStage: "build" },
    ]);
    expect(() => projectMetrics(db, r)).not.toThrow();
    expect(metric(db, r, "build_ms")?.value).toBe(4000);
    expect(metric(db, r, "cost_usd")?.value).toBe(0.05);
    expect(metric(db, r, "wall_ms")?.value).toBe(2000); // 3000 - 1000
    expect(metric(db, r, "ttft_ms")).toBeUndefined(); // no first_token/session_started
    db.close();
  });
});

describe("projectMetrics — determinism / idempotence property", () => {
  it("running twice yields byte-identical rows (no double-insert)", () => {
    const db = freshDb();
    const r = "perf";
    appendAll(db, [
      { type: "session_started", runId: r, ts: 1000, provider: "d", modelId: "m" },
      { type: "first_token", runId: r, ts: 1200 },
      { type: "stage_completed", runId: r, ts: 5300, stage: "build", durationMs: 4000, exitCode: 0 },
      usage(r, 2000, 0.01, { inputTokens: 100, totalTokens: 100 }),
      { type: "benchmark_finished", runId: r, ts: 9000, status: "completed", failedStage: null },
    ]);
    projectMetrics(db, r);
    const snap = () =>
      db
        .prepare("SELECT name, value, unit FROM metrics WHERE run_id = @r ORDER BY name")
        .all({ r });
    const first = snap();
    projectMetrics(db, r);
    const second = snap();
    expect(second).toEqual(first);
    db.close();
  });
});

describe("projectMetrics — sum-conservation property", () => {
  it("Σ per-iteration corrections == density × count == standalone recount", () => {
    const db = freshDb();
    const r = "corr";
    appendAll(db, [
      { type: "file_mutation", runId: r, ts: 1, op: "create", path: "A", linesAdded: 1, linesRemoved: 0 },
      usage(r, 2, 0),
      { type: "file_mutation", runId: r, ts: 3, op: "edit", path: "A", linesAdded: 1, linesRemoved: 0 },
      { type: "file_mutation", runId: r, ts: 4, op: "edit", path: "A", linesAdded: 1, linesRemoved: 0 },
      usage(r, 5, 0),
      { type: "file_mutation", runId: r, ts: 6, op: "create", path: "B", linesAdded: 1, linesRemoved: 0 },
    ]);
    projectMetrics(db, r);
    const rows = iterations(db, r);
    const sumRows = rows.reduce((a, x) => a + x.correction_count, 0);
    const density = metric(db, r, "correction_density")!.value;
    const count = metric(db, r, "iteration_count")!.value;
    // Independent standalone recount: 2nd+ write per path over the log.
    const standalone = 2; // A written 3× → 2, B once → 0
    expect(sumRows).toBe(standalone);
    expect(density * count).toBe(standalone);
    db.close();
  });
});

describe("projectMetrics — order-invariance / seq-keying property (D5-11)", () => {
  it("keys corrections off seq, not ts (later seq carries earlier ts)", () => {
    const db = freshDb();
    const r = "seq";
    // ts is NOT monotonic with append/seq order: the two edits carry earlier ts
    // than the create, yet by seq they are the 2nd/3rd write to A → 2 corrections.
    appendAll(db, [
      { type: "file_mutation", runId: r, ts: 100, op: "create", path: "A", linesAdded: 1, linesRemoved: 0 },
      usage(r, 200, 0),
      { type: "file_mutation", runId: r, ts: 50, op: "edit", path: "A", linesAdded: 1, linesRemoved: 0 },
      { type: "file_mutation", runId: r, ts: 60, op: "edit", path: "A", linesAdded: 1, linesRemoved: 0 },
    ]);
    projectMetrics(db, r);
    expect(metric(db, r, "iteration_count")?.value).toBe(1);
    expect(metric(db, r, "correction_density")?.value).toBe(2); // 2 corrections / 1 turn
    // Corrections land after the last turn → clamped onto the final row (index 0).
    expect(iterations(db, r)).toEqual([{ iteration_index: 0, correction_count: 2 }]);
    db.close();
  });
});
