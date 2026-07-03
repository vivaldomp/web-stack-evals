import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, appendEvent, readEvents } from "../src/storage/db.js";
import type { AgentEvent, AgentEventDraft } from "../src/core/events.js";

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
  // Drafts (no seq) — storage stamps the per-run monotonic seq (D4-26).
  const drafts: AgentEventDraft[] = [
    { type: "unknown", runId: "run-1", ts: 0, piType: "x", raw: { a: 1 } },
    { type: "tool_call", runId: "run-1", ts: 10, toolName: "bash", argsSummary: "ls", isError: false },
    { type: "file_mutation", runId: "run-1", ts: 20, op: "create", path: "a.ts", linesAdded: 1, linesRemoved: 0 },
    { type: "stage_started", runId: "run-1", ts: 30, stage: "install" },
    { type: "stage_completed", runId: "run-1", ts: 40, stage: "install", durationMs: 10, exitCode: 0 },
    { type: "stage_failed", runId: "run-1", ts: 50, stage: "build", durationMs: 10, exitCode: 1 },
    { type: "benchmark_finished", runId: "run-1", ts: 60, status: "completed", failedStage: null },
  ];

  it("stamps seq 0..N-1 in append order and reads each event back deep-equal to its draft", () => {
    const db = openDb(tmpDbFile());
    for (const e of drafts) {
      appendEvent(db, e);
    }

    const result = readEvents(db, "run-1");
    // Storage assigns seq in append order; the rest of each event equals its draft.
    const expected: AgentEvent[] = drafts.map((d, i) => ({ ...d, seq: i }) as AgentEvent);
    expect(result).toEqual(expected);
    expect(result.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    db.close();
  });

  it("appending the same draft twice succeeds — storage assigns distinct consecutive seq (no PK clash)", () => {
    const db = openDb(tmpDbFile());
    appendEvent(db, drafts[0]);
    expect(() => appendEvent(db, drafts[0])).not.toThrow();

    const result = readEvents(db, "run-1");
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.seq)).toEqual([0, 1]);
    db.close();
  });
});
