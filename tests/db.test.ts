import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, appendEvent, readEvents } from "../src/storage/db.js";
import type { AgentEvent } from "../src/core/events.js";

const SC4_TABLES = [
  "runs",
  "stacks",
  "models",
  "scenarios",
  "artifacts",
  "events",
  "metrics",
  "screenshots",
  "tool_calls",
  "iterations",
  "evaluations",
];

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function tmpDbFile(): string {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-db-test-"));
  return join(dir, "results.sqlite");
}

describe("openDb", () => {
  it("enables WAL mode on a fresh DB", () => {
    const db = openDb(tmpDbFile());
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
    db.close();
  });

  it("creates every SC#4 table", () => {
    const db = openDb(tmpDbFile());
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const table of SC4_TABLES) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it("is idempotent — re-opening an existing DB does not throw or duplicate tables", () => {
    const file = tmpDbFile();
    const first = openDb(file);
    first.close();

    expect(() => {
      const second = openDb(file);
      const rows = second
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const names = rows.map((r) => r.name);
      for (const table of SC4_TABLES) {
        expect(names).toContain(table);
      }
      second.close();
    }).not.toThrow();
  });
});

describe("appendEvent / readEvents", () => {
  const samples: AgentEvent[] = [
    { type: "unknown", runId: "run-1", seq: 0, ts: 0, piType: "x", raw: { a: 1 } },
    { type: "tool_call", runId: "run-1", seq: 1, ts: 10, toolName: "bash", argsSummary: "ls", isError: false },
    { type: "file_mutation", runId: "run-1", seq: 2, ts: 20, op: "create", path: "a.ts", linesAdded: 1, linesRemoved: 0 },
    { type: "stage_started", runId: "run-1", seq: 3, ts: 30, stage: "install" },
    { type: "stage_completed", runId: "run-1", seq: 4, ts: 40, stage: "install", durationMs: 10, exitCode: 0 },
    { type: "stage_failed", runId: "run-1", seq: 5, ts: 50, stage: "build", durationMs: 10, exitCode: 1 },
    { type: "benchmark_finished", runId: "run-1", seq: 6, ts: 60, status: "completed", failedStage: null },
  ];

  it("reads back every appended event, seq-ordered and deep-equal to the original", () => {
    const db = openDb(tmpDbFile());
    // append out of seq order to prove ORDER BY seq, not insertion order
    for (const e of [...samples].reverse()) {
      appendEvent(db, e);
    }

    const result = readEvents(db, "run-1");
    expect(result).toEqual(samples);
    db.close();
  });

  it("rejects a second event with a duplicate (run_id, seq) — append order is authoritative", () => {
    const db = openDb(tmpDbFile());
    appendEvent(db, samples[0]);
    expect(() => appendEvent(db, samples[0])).toThrow();
    db.close();
  });
});
