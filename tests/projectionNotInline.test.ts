import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, appendEvent } from "../src/storage/db.js";
import { projectMetrics } from "../src/telemetry/projectMetrics.js";
import type Database from "better-sqlite3";
import type { AgentEventDraft } from "../src/core/events.js";

// TEL-02 / D-24: metrics are PROJECTIONS folded AFTER the run — nothing is
// computed inline during the append stream. The checkable evidence: the three
// projection tables are empty until projectMetrics runs, populated after.

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
function freshDb(): Database.Database {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-notinline-test-"));
  return openDb(join(dir, "results.sqlite"));
}

function count(db: Database.Database, table: string, runId: string): number {
  // Table name is a hard-coded literal from the closed set below, never user input.
  const row = db
    .prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id = @r`)
    .get({ r: runId }) as { n: number };
  return row.n;
}

const TABLES = ["metrics", "tool_calls", "iterations"] as const;

describe("projection-not-inline invariant (TEL-02 / D-24)", () => {
  it("projection tables are empty until projectMetrics populates them", () => {
    const db = freshDb();
    const r = "run-1";
    const log: AgentEventDraft[] = [
      { type: "session_started", runId: r, ts: 1000, provider: "d", modelId: "m" },
      {
        type: "usage",
        runId: r,
        ts: 1100,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        costUsd: 0.01,
        aborted: false,
      },
      { type: "tool_call", runId: r, ts: 1200, toolName: "bash", argsSummary: "", isError: false },
      { type: "file_mutation", runId: r, ts: 1300, op: "create", path: "A", linesAdded: 3, linesRemoved: 0 },
      { type: "stage_completed", runId: r, ts: 1400, stage: "build", durationMs: 500, exitCode: 0 },
      { type: "benchmark_finished", runId: r, ts: 2000, status: "completed", failedStage: null },
    ];
    for (const e of log) appendEvent(db, e);

    // BEFORE projectMetrics: nothing populated the projection tables inline.
    for (const t of TABLES) expect(count(db, t, r)).toBe(0);

    projectMetrics(db, r);

    // AFTER: this pass is the only writer of the projection tables.
    for (const t of TABLES) expect(count(db, t, r)).toBeGreaterThan(0);
    db.close();
  });
});
