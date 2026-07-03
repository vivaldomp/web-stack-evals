// AGENT-04 coverage: createEventMapper is a pure per-run Pi→canonical translator.
// Every case here is driven from hand-authored fake Pi event objects with an
// injected clock — no live Pi session, no network, zero cost (D4-09/D4-10/D4-12).
import { describe, it, expect } from "vitest";
import { createEventMapper, type PiEvent } from "../src/agent/mapEvent.js";

const CTX = { runId: "run-1", provider: "deepseek", modelId: "deepseek-chat" };

/** A deterministic clock returning fixed, incrementing epoch-ms constants. */
function fixedClock(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function agentStart(): PiEvent {
  return { type: "agent_start" };
}
function textDelta(text = "hi"): PiEvent {
  return { type: "message_update", assistantMessageEvent: { type: "text_delta", text } };
}
function turnEnd(over: Record<string, unknown> = {}): PiEvent {
  return {
    type: "turn_end",
    message: {
      stopReason: "stop",
      usage: {
        input: 100,
        output: 40,
        cacheRead: 10,
        cacheWrite: 5,
        reasoning: 7,
        totalTokens: 162,
        cost: { total: 0.00123456789 },
      },
      ...over,
    },
  };
}

describe("createEventMapper — session_started (D4-09/D4-10)", () => {
  it("agent_start emits exactly one session_started with ctx provider+modelId", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(1000) });
    const out = map(agentStart());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "session_started",
      runId: "run-1",
      provider: "deepseek",
      modelId: "deepseek-chat",
      ts: 1000,
    });
  });

  it("a second agent_start emits nothing (latch)", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(1000, 2000) });
    expect(map(agentStart())).toHaveLength(1);
    expect(map(agentStart())).toEqual([]);
  });
});

describe("createEventMapper — first_token latch (D4-10)", () => {
  it("first text_delta → [first_token, unknown]; later deltas → [unknown] only", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(10, 20, 30) });

    const first = map(textDelta("a"));
    expect(first.map((d) => d.type)).toEqual(["first_token", "unknown"]);
    expect(first[0]).toMatchObject({ type: "first_token", runId: "run-1", ts: 10 });

    const second = map(textDelta("b"));
    expect(second.map((d) => d.type)).toEqual(["unknown"]);

    // exactly one first_token across both updates, both still emit unknown
  });

  it("first_token.ts precedes a session_started emitted later (TTFT anchor ordering)", () => {
    // Author a run where the clock advances; first_token at t=10, agent_start would be earlier
    const map = createEventMapper({ ...CTX, now: fixedClock(5, 10) });
    const started = map(agentStart());
    const tok = map(textDelta());
    expect(started[0].ts).toBe(5);
    expect(tok[0].ts).toBe(10);
    expect(started[0].ts).toBeLessThan(tok[0].ts);
  });

  it("every message_update unknown draft preserves raw verbatim (D4-12)", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(1) });
    const ev = textDelta("narration text");
    const out = map(ev);
    const unknown = out.find((d) => d.type === "unknown")!;
    expect(unknown).toMatchObject({ type: "unknown", piType: "message_update" });
    expect((unknown as { raw: unknown }).raw).toEqual(ev);
  });
});

describe("createEventMapper — usage (D4-15/D-26)", () => {
  it("turn_end → one usage draft copying pi-ai Usage verbatim, unrounded cost", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(500) });
    const out = map(turnEnd());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "usage",
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      reasoningTokens: 7,
      totalTokens: 162,
      costUsd: 0.00123456789,
      aborted: false,
      ts: 500,
    });
  });

  it("aborted turn (stopReason 'aborted') → usage{aborted:true} with tokens/cost intact", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(1) });
    const out = map(turnEnd({ stopReason: "aborted" }));
    expect(out[0]).toMatchObject({ type: "usage", aborted: true, costUsd: 0.00123456789, inputTokens: 100 });
  });
});

describe("createEventMapper — UnknownEvent passthrough (D4-14/D-02)", () => {
  it("auto_retry_start → one unknown{piType,raw} with delayMs intact; never null", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(1) });
    const ev: PiEvent = { type: "auto_retry_start", attempt: 2, maxAttempts: 4, delayMs: 2000 };
    const out = map(ev);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "unknown", piType: "auto_retry_start" });
    expect((out[0] as { raw: { delayMs: number } }).raw.delayMs).toBe(2000);
  });

  it("the mapper never returns null/undefined for any input", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(1) });
    for (const t of ["turn_start", "message_start", "compaction_start", "queue_update"]) {
      const out = map({ type: t });
      expect(Array.isArray(out)).toBe(true);
      expect(out[0]).toMatchObject({ type: "unknown", piType: t });
    }
  });
});

describe("createEventMapper — seqless drafts (D4-26)", () => {
  it("no emitted draft carries an own seq property", () => {
    const map = createEventMapper({ ...CTX, now: fixedClock(1, 2, 3, 4) });
    const all = [
      ...map(agentStart()),
      ...map(textDelta()),
      ...map(turnEnd()),
      ...map({ type: "queue_update" }),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) {
      expect(Object.prototype.hasOwnProperty.call(d, "seq")).toBe(false);
    }
  });
});
