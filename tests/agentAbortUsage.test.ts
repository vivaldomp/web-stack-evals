// Deterministic proof of usage reconciliation on abort (D4-15) and guaranteed-once
// teardown (D4-24). Σ of yielded usage.costUsd must equal Pi's authoritative
// getSessionStats().cost via a single trailing usage{aborted:true} delta; a balanced
// run emits no extra draft; and session.dispose() runs exactly once with
// session.abort() at least once on natural / ceiling-trip / fatal exits. All from a
// scripted fake session — zero network, zero paid tokens.
import { describe, it, expect } from "vitest";
import { runSession } from "../src/agent/piAgentAdapter.js";
import type { PiEvent } from "../src/agent/mapEvent.js";
import type { AgentInput } from "../src/agent/types.js";
import type { AgentEventDraft, UsageEvent } from "../src/core/events.js";
import { fakeFactory } from "./_fakes/fakeSession.js";

const now = () => 1_000;
const MOCKUP = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PER_TURN = 0.0021;

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

function turnEnd(stopReason = "stop"): PiEvent {
  return {
    type: "turn_end",
    message: {
      stopReason,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 150,
        cost: { total: PER_TURN },
      },
    },
  };
}

const natural2Turns: PiEvent[] = [
  { type: "agent_start" },
  turnEnd(),
  turnEnd(),
  { type: "agent_end" },
];

async function collect(iter: AsyncIterable<AgentEventDraft>): Promise<AgentEventDraft[]> {
  const out: AgentEventDraft[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

const usages = (drafts: AgentEventDraft[]) =>
  drafts.filter((d): d is UsageEvent => d.type === "usage");

describe("runSession usage reconciliation on abort (D4-15)", () => {
  it("emits ONE usage{aborted:true} delta so Σ usage == getSessionStats().cost", async () => {
    const finalCost = 0.01; // > Σ per-turn (2 × 0.0021 = 0.0042)
    const { createSession } = fakeFactory(natural2Turns, { cost: finalCost });
    const drafts = await collect(runSession(makeInput(), { createSession, now }));

    const u = usages(drafts);
    expect(u).toHaveLength(3); // two per-turn + one reconciling delta
    const delta = u[u.length - 1];
    expect(delta.aborted).toBe(true);
    expect(delta.costUsd).toBeCloseTo(finalCost - 2 * PER_TURN, 10);
    const sum = u.reduce((acc, x) => acc + x.costUsd, 0);
    expect(sum).toBeCloseTo(finalCost, 10);
  });

  it("emits NO extra usage draft when Σ per-turn already equals getSessionStats().cost", async () => {
    const { createSession } = fakeFactory(natural2Turns, { cost: 2 * PER_TURN });
    const drafts = await collect(runSession(makeInput(), { createSession, now }));

    const u = usages(drafts);
    expect(u).toHaveLength(2); // only the per-turn drafts
    expect(u.every((x) => x.aborted === false)).toBe(true);
  });
});

describe("runSession guaranteed-once teardown (D4-24)", () => {
  it("disposes exactly once and aborts at least once on a NATURAL completion", async () => {
    const { createSession, calls } = fakeFactory(natural2Turns);
    await collect(runSession(makeInput(), { createSession, now }));
    expect(calls.disposeCount).toBe(1);
    expect(calls.abortCount).toBeGreaterThanOrEqual(1);
    expect(calls.statsCount).toBeGreaterThanOrEqual(1); // getSessionStats read before dispose
  });

  it("disposes exactly once and aborts on a CEILING-TRIP run", async () => {
    const script: PiEvent[] = [{ type: "agent_start" }, turnEnd()];
    const { createSession, calls } = fakeFactory(script);
    await collect(runSession(makeInput({ maxTurns: 1 }), { createSession, now }));
    expect(calls.disposeCount).toBe(1);
    expect(calls.abortCount).toBeGreaterThanOrEqual(1);
  });

  it("disposes exactly once and aborts on a FATAL-error run", async () => {
    const script: PiEvent[] = [{ type: "agent_start" }, turnEnd("error")];
    const { createSession, calls } = fakeFactory(script);
    await collect(runSession(makeInput(), { createSession, now }));
    expect(calls.disposeCount).toBe(1);
    expect(calls.abortCount).toBeGreaterThanOrEqual(1);
  });
});
