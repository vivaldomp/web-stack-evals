import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/storage/db.js";
import { createStoragePort } from "../src/storage/storagePort.js";
import type { AgentEventDraft } from "../src/core/events.js";

// D4-26 proof: two independent producers (the agent adapter + runStack) append
// to ONE run's log. seq is storage-owned, so no coordinated counter is needed —
// the resulting seq must be gap-free, collision-free, strictly increasing in
// append order, and independent per run.

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setupPort() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-seqowner-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  return { db, port: createStoragePort(db) };
}

/** Draft from "writer A" — a tool_call (agent-adapter-shaped). */
function draftA(runId: string, i: number): AgentEventDraft {
  return { type: "tool_call", runId, ts: i, toolName: "bash", argsSummary: `a${i}`, isError: false };
}

/** Draft from "writer B" — an unknown passthrough (runStack/other-shaped). */
function draftB(runId: string, i: number): AgentEventDraft {
  return { type: "unknown", runId, ts: i, piType: "b", raw: { i } };
}

describe("seq ownership (D4-26) — interleaved two-writer appends", () => {
  it("stamps gap-free, strictly-increasing seq under alternating writers on one run", () => {
    const { db, port } = setupPort();
    const runId = "run-shared";
    const N = 20;

    for (let i = 0; i < N; i++) {
      port.appendEvent(i % 2 === 0 ? draftA(runId, i) : draftB(runId, i));
    }

    const events = port.readEvents(runId);
    const seqs = events.map((e) => e.seq);

    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i)); // 0..N-1, no gaps
    expect(new Set(seqs).size).toBe(N); // no duplicates
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1); // strictly increasing by 1
    }
    // Append order authoritative (D-04): even indices are writer A (tool_call).
    for (let i = 0; i < N; i++) {
      expect(events[i].type).toBe(i % 2 === 0 ? "tool_call" : "unknown");
    }
    db.close();
  });

  it("keeps seq per-run independent when a second run is interleaved (per-run, not global)", () => {
    const { db, port } = setupPort();
    const runA = "run-A";
    const runB = "run-B";

    // Interleave two runs: every iteration appends to A; even iterations also to B.
    for (let i = 0; i < 10; i++) {
      port.appendEvent(draftA(runA, i));
      if (i % 2 === 0) port.appendEvent(draftB(runB, i));
    }

    const seqsA = port.readEvents(runA).map((e) => e.seq);
    const seqsB = port.readEvents(runB).map((e) => e.seq);

    expect(seqsA).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // A: 0..9
    expect(seqsB).toEqual([0, 1, 2, 3, 4]); // B restarts at 0, independent of A
    db.close();
  });
});
