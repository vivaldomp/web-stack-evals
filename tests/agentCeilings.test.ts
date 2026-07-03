// Deterministic proof of the three-ceiling budget monitor (AGENT-05, D4-01/02/11):
// turns, cumulative-USD, and wall-clock each independently trip first-to-abort,
// call session.abort(), keep partial work, and end the stream with
// benchmark_finished{status:"timeout"} reusing the existing D-19 enum. Every case
// runs from a scripted fake session (zero network, zero paid tokens); the wall
// case uses vi.useFakeTimers() so it fires with NO events flowing.
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { runSession } from "../src/agent/piAgentAdapter.js";
import type { PiEvent } from "../src/agent/mapEvent.js";
import type { AgentInput } from "../src/agent/types.js";
import type { AgentEventDraft } from "../src/core/events.js";
import { fakeFactory } from "./_fakes/fakeSession.js";

const now = () => 1_000;
const MOCKUP = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function makeInput(budget: Partial<AgentInput["budget"]> = {}): AgentInput {
  return {
    runId: "run-1",
    workspacePath: "/tmp/run-1/angular",
    promptText: "Build the dashboard.",
    preamble: "Angular 22 workspace.",
    mockupBytes: MOCKUP,
    mockupMimeType: "image/png",
    skillPaths: [],
    model: { provider: "deepseek", modelId: "deepseek-chat", temperature: 0 },
    budget: { maxWallClockMs: 1_200_000, maxCostUsd: 5, maxTurns: 50, ...budget },
  };
}

function turnEnd(cost = 0.0021): PiEvent {
  return {
    type: "turn_end",
    message: {
      stopReason: "stop",
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 150,
        cost: { total: cost },
      },
    },
  };
}

async function collect(iter: AsyncIterable<AgentEventDraft>): Promise<AgentEventDraft[]> {
  const out: AgentEventDraft[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

const terminals = (drafts: AgentEventDraft[]) =>
  drafts.filter((d) => d.type === "benchmark_finished");

describe("runSession three-ceiling budget monitor (AGENT-05, D4-01/02/11)", () => {
  it("trips the TURNS ceiling: aborts and ends with benchmark_finished{timeout}", async () => {
    const script: PiEvent[] = [{ type: "agent_start" }, turnEnd(), turnEnd()];
    const { createSession, calls } = fakeFactory(script);
    const drafts = await collect(runSession(makeInput({ maxTurns: 2 }), { createSession, now }));

    const last = drafts[drafts.length - 1];
    expect(last).toEqual({
      runId: "run-1",
      ts: 1_000,
      type: "benchmark_finished",
      status: "timeout",
      failedStage: null,
    });
    expect(terminals(drafts)).toHaveLength(1); // exactly one tripped reason
    expect(calls.abortCount).toBeGreaterThanOrEqual(1);
  });

  it("trips the USD ceiling before maxTurns: aborts and ends with timeout", async () => {
    // costPerTurn drives getSessionStats().cost; crosses maxCostUsd on turn 2.
    const script: PiEvent[] = [{ type: "agent_start" }, turnEnd(), turnEnd(), turnEnd()];
    const { createSession, calls } = fakeFactory(script, { costPerTurn: 0.003 });
    const drafts = await collect(
      runSession(makeInput({ maxCostUsd: 0.005, maxTurns: 50 }), { createSession, now }),
    );

    expect(terminals(drafts)).toHaveLength(1);
    expect((terminals(drafts)[0] as { status: string }).status).toBe("timeout");
    expect(calls.abortCount).toBeGreaterThanOrEqual(1);
  });

  it("trips the WALL ceiling with NO events flowing (hung agent, fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const { createSession, calls } = fakeFactory([{ type: "agent_start" }], { hang: true });
      const iter = runSession(makeInput({ maxWallClockMs: 1_000 }), { createSession, now });
      const pending = collect(iter);
      // No events after agent_start — only the wall-clock setTimeout can end this run.
      await vi.advanceTimersByTimeAsync(1_000);
      const drafts = await pending;

      expect(terminals(drafts)).toHaveLength(1);
      expect((terminals(drafts)[0] as { status: string }).status).toBe("timeout");
      expect(calls.abortCount).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("first-to-trip: a natural, non-fatal run yields NO benchmark_finished terminal", async () => {
    const script: PiEvent[] = [{ type: "agent_start" }, turnEnd(), { type: "agent_end" }];
    const { createSession } = fakeFactory(script);
    const drafts = await collect(runSession(makeInput(), { createSession, now }));
    expect(terminals(drafts)).toHaveLength(0);
  });

  it("keeps partial work: the adapter never deletes the workspace on a trip", () => {
    const raw = readFileSync("src/agent/piAgentAdapter.ts", "utf8");
    const code = raw
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(code).not.toContain("rmSync(");
    expect(code).not.toContain("cleanupWorkspace(");
  });
});
