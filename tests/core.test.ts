import { describe, it, expect, vi } from "vitest";
import { newRunId } from "../src/core/ids.js";
import type { AgentEvent, UnknownEvent } from "../src/core/events.js";

describe("newRunId", () => {
  it("matches the sortable run-id format", () => {
    const id = newRunId();
    expect(id).toMatch(/^run-\d{14}-[0-9a-f]{6}$/);
  });

  it("produces distinct ids for calls in the same second", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
  });

  it("sorts lexically in chronological order", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:00:00.000Z"));
    const earlier = newRunId();
    vi.setSystemTime(new Date("2026-07-01T10:00:05.000Z"));
    const later = newRunId();
    vi.useRealTimers();

    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

describe("AgentEvent", () => {
  it("round-trips UnknownEvent piType and raw payload", () => {
    const raw = { foo: "bar" };
    const event: UnknownEvent = {
      type: "unknown",
      runId: "run-1",
      seq: 1,
      ts: Date.now(),
      piType: "some_pi_event",
      raw,
    };
    expect(event.piType).toBe("some_pi_event");
    expect(event.raw).toBe(raw);
  });

  it("exhaustively narrows every known variant type in a switch", () => {
    const samples: AgentEvent[] = [
      { type: "unknown", runId: "r", seq: 0, ts: 0, piType: "x", raw: null },
      { type: "tool_call", runId: "r", seq: 1, ts: 0, toolName: "bash", argsSummary: "ls", isError: false },
      { type: "file_mutation", runId: "r", seq: 2, ts: 0, op: "create", path: "a.ts", linesAdded: 1, linesRemoved: 0 },
      { type: "stage_started", runId: "r", seq: 3, ts: 0, stage: "install" },
      { type: "stage_completed", runId: "r", seq: 4, ts: 0, stage: "install", durationMs: 10, exitCode: 0 },
      { type: "stage_failed", runId: "r", seq: 5, ts: 0, stage: "build", durationMs: 10, exitCode: 1 },
      { type: "benchmark_finished", runId: "r", seq: 6, ts: 0, status: "completed", failedStage: null },
    ];

    function describeEvent(e: AgentEvent): string {
      switch (e.type) {
        case "unknown":
          return `unknown:${e.piType}`;
        case "tool_call":
          return `tool_call:${e.toolName}`;
        case "file_mutation":
          return `file_mutation:${e.op}`;
        case "stage_started":
          return `stage_started:${e.stage}`;
        case "stage_completed":
          return `stage_completed:${e.stage}`;
        case "stage_failed":
          return `stage_failed:${e.stage}`;
        case "benchmark_finished":
          return `benchmark_finished:${e.status}`;
      }
    }

    for (const sample of samples) {
      expect(describeEvent(sample)).toBeTruthy();
    }
  });

  it("accepts lint and test stage values on StageCompletedEvent (compile-time check)", () => {
    const lintEvent: AgentEvent = {
      type: "stage_completed",
      runId: "r",
      seq: 0,
      ts: 0,
      stage: "lint",
      durationMs: 10,
      exitCode: 0,
    };
    const testEvent: AgentEvent = {
      type: "stage_completed",
      runId: "r",
      seq: 1,
      ts: 0,
      stage: "test",
      durationMs: 10,
      exitCode: 0,
    };
    expect(lintEvent.stage).toBe("lint");
    expect(testEvent.stage).toBe("test");
  });
});
