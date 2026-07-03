import type Database from "better-sqlite3";
import { readEvents } from "../storage/db.js";
import type { Stage } from "../core/events.js";

// Projections folded from the append-only event log AFTER a run (TEL-02 / D-24):
// metrics / tool_calls / iterations are never computed inline. This function is
// the only writer of those three tables and takes only (db, runId) — no session,
// timer, or live-run state — so it cannot compute a metric inline by construction.
// Bound named params only (T-05-04-SQL / T-1-SQL-01), mirroring evaluations.ts.

const DELETE_METRICS = `DELETE FROM metrics WHERE run_id = @run_id`;
const DELETE_TOOL_CALLS = `DELETE FROM tool_calls WHERE run_id = @run_id`;
const DELETE_ITERATIONS = `DELETE FROM iterations WHERE run_id = @run_id`;

const INSERT_METRIC = `
  INSERT INTO metrics (run_id, name, value, unit)
  VALUES (@run_id, @name, @value, @unit)
`;
const INSERT_TOOL_CALL = `
  INSERT INTO tool_calls (run_id, tool_name, call_count, error_count)
  VALUES (@run_id, @tool_name, @call_count, @error_count)
`;
const INSERT_ITERATION = `
  INSERT INTO iterations (run_id, iteration_index, correction_count)
  VALUES (@run_id, @iteration_index, @correction_count)
`;

interface MetricRow {
  name: string;
  value: number;
  unit: string;
}
interface ToolRow {
  toolName: string;
  callCount: number;
  errorCount: number;
}
interface IterRow {
  index: number;
  corrections: number;
}

/**
 * Folds a run's persisted event log into the metrics / tool_calls / iterations
 * projection tables. Reads `readEvents` (already seq-ordered — D-04) once, folds
 * in a single pass, then delete-then-inserts inside one transaction so re-running
 * is idempotent (the tables carry no UNIQUE key). Partial logs never throw (D5-05).
 */
export function projectMetrics(db: Database.Database, runId: string): void {
  const events = readEvents(db, runId);

  // --- single-pass accumulators (all keyed off seq order, never ts) ---
  const stageMs = new Map<Stage, number>(); // last stage_completed/failed wins
  let sessionTs: number | undefined;
  let firstTokenTs: number | undefined;
  let finishedTs: number | undefined;
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let usageCount = 0;
  let sawUsage = false;

  let backoffMs = 0;
  let sawRetry = false;
  let pendingRetryStart: number | undefined;

  let filesCreated = 0;
  let filesEdited = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let sawMutation = false;
  const createdPaths = new Set<string>();
  const editedPaths = new Set<string>();

  const tools = new Map<string, ToolRow>();

  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const e of events) {
    if (e.ts < minTs) minTs = e.ts;
    if (e.ts > maxTs) maxTs = e.ts;
    switch (e.type) {
      case "session_started":
        sessionTs = e.ts;
        break;
      case "first_token":
        firstTokenTs = e.ts;
        break;
      case "benchmark_finished":
        finishedTs = e.ts;
        break;
      case "stage_completed":
      case "stage_failed":
        stageMs.set(e.stage, e.durationMs);
        break;
      case "usage":
        sawUsage = true;
        usageCount += 1;
        costUsd += e.costUsd; // verbatim, unrounded (D-26); incl. aborted (D4-15)
        inputTokens += e.inputTokens;
        outputTokens += e.outputTokens;
        cacheReadTokens += e.cacheReadTokens;
        cacheWriteTokens += e.cacheWriteTokens;
        totalTokens += e.totalTokens;
        break;
      case "file_mutation":
        sawMutation = true;
        linesAdded += e.linesAdded;
        linesRemoved += e.linesRemoved;
        if (e.op === "create") createdPaths.add(e.path);
        if (e.op === "edit") editedPaths.add(e.path);
        break;
      case "tool_call": {
        const t = tools.get(e.toolName) ?? { toolName: e.toolName, callCount: 0, errorCount: 0 };
        t.callCount += 1;
        if (e.isError) t.errorCount += 1;
        tools.set(e.toolName, t);
        break;
      }
      case "unknown":
        // backoff_wait_ms (D5-12): pair each retry-start with the next retry-end
        // in seq order; sum (end.ts − start.ts). Timestamp-derived (A2) so it
        // survives Pi field renames.
        if (e.piType === "auto_retry_start") {
          pendingRetryStart = e.ts;
          sawRetry = true;
        } else if (e.piType === "auto_retry_end" && pendingRetryStart !== undefined) {
          backoffMs += e.ts - pendingRetryStart;
          pendingRetryStart = undefined;
        }
        break;
    }
  }
  filesCreated = createdPaths.size;
  filesEdited = editedPaths.size;

  // --- corrections + iterations (D5-11): seq-ordered walk, clamp to final turn ---
  const iterationCount = usageCount;
  const perIterCorrections = new Map<number, number>();
  const writeCount = new Map<string, number>();
  let iterationIndex = 0;
  for (const e of events) {
    if (e.type === "usage") {
      iterationIndex += 1;
    } else if (e.type === "file_mutation") {
      const c = (writeCount.get(e.path) ?? 0) + 1;
      writeCount.set(e.path, c);
      if (c > 1 && iterationCount > 0) {
        // Clamp so a correction after the last turn still lands on the final row
        // and Σ is conserved (sum-conservation property).
        const target = Math.min(iterationIndex, iterationCount - 1);
        perIterCorrections.set(target, (perIterCorrections.get(target) ?? 0) + 1);
      }
    }
  }
  let totalCorrections = 0;
  for (const v of perIterCorrections.values()) totalCorrections += v;

  // --- assemble metric rows (absent inputs simply omit their row) ---
  const metrics: MetricRow[] = [];
  for (const [stage, ms] of stageMs) metrics.push({ name: `${stage}_ms`, value: ms, unit: "ms" });
  if (sessionTs !== undefined && firstTokenTs !== undefined) {
    metrics.push({ name: "ttft_ms", value: firstTokenTs - sessionTs, unit: "ms" });
  }
  const wallMs =
    sessionTs !== undefined && finishedTs !== undefined
      ? finishedTs - sessionTs
      : events.length > 0
        ? maxTs - minTs
        : undefined;
  if (wallMs !== undefined) metrics.push({ name: "wall_ms", value: wallMs, unit: "ms" });
  if (sawUsage) {
    metrics.push({ name: "cost_usd", value: costUsd, unit: "usd" });
    metrics.push({ name: "input_tokens", value: inputTokens, unit: "tokens" });
    metrics.push({ name: "output_tokens", value: outputTokens, unit: "tokens" });
    metrics.push({ name: "cache_read_tokens", value: cacheReadTokens, unit: "tokens" });
    metrics.push({ name: "cache_write_tokens", value: cacheWriteTokens, unit: "tokens" });
    metrics.push({ name: "total_tokens", value: totalTokens, unit: "tokens" });
  }
  if (sawRetry) metrics.push({ name: "backoff_wait_ms", value: backoffMs, unit: "ms" });
  if (sawMutation) {
    metrics.push({ name: "files_created", value: filesCreated, unit: "count" });
    metrics.push({ name: "files_edited", value: filesEdited, unit: "count" });
    metrics.push({ name: "lines_added", value: linesAdded, unit: "count" });
    metrics.push({ name: "lines_removed", value: linesRemoved, unit: "count" });
  }
  metrics.push({ name: "iteration_count", value: iterationCount, unit: "count" });
  metrics.push({
    name: "correction_density",
    value: iterationCount > 0 ? totalCorrections / iterationCount : 0,
    unit: "ratio",
  });

  const iterRows: IterRow[] = [];
  for (let i = 0; i < iterationCount; i++) {
    iterRows.push({ index: i, corrections: perIterCorrections.get(i) ?? 0 });
  }

  // --- delete-then-insert in one transaction → idempotent re-run ---
  const delMetrics = db.prepare(DELETE_METRICS);
  const delTools = db.prepare(DELETE_TOOL_CALLS);
  const delIters = db.prepare(DELETE_ITERATIONS);
  const insMetric = db.prepare(INSERT_METRIC);
  const insTool = db.prepare(INSERT_TOOL_CALL);
  const insIter = db.prepare(INSERT_ITERATION);

  db.transaction(() => {
    delMetrics.run({ run_id: runId });
    delTools.run({ run_id: runId });
    delIters.run({ run_id: runId });
    for (const m of metrics) {
      insMetric.run({ run_id: runId, name: m.name, value: m.value, unit: m.unit });
    }
    for (const t of tools.values()) {
      insTool.run({
        run_id: runId,
        tool_name: t.toolName,
        call_count: t.callCount,
        error_count: t.errorCount,
      });
    }
    for (const it of iterRows) {
      insIter.run({ run_id: runId, iteration_index: it.index, correction_count: it.corrections });
    }
  })();
}
