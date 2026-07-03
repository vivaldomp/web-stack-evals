// Drives `runSession` entirely from a scripted fake Pi session (zero network,
// zero cost). Covers every <behavior> bullet of Plan 04-05 Task 2: live streaming,
// single mockup-only prompt, byte-exact mockup, key-never-in-events, agent_error
// terminal on fatal / rejected prompt, natural-end no-terminal, input narrowing,
// and seqless drafts (storage owns seq, D4-26).
import { describe, it, expect } from "vitest";
import { runSession } from "../src/agent/piAgentAdapter.js";
import type { PiEvent } from "../src/agent/mapEvent.js";
import type { AgentInput } from "../src/agent/types.js";
import type { AgentEventDraft } from "../src/core/events.js";
import { fakeFactory } from "./_fakes/fakeSession.js";

const now = () => 1_000;

const MOCKUP = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0xff]);

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    runId: "run-1",
    workspacePath: "/tmp/run-1/angular",
    promptText: "Build the dashboard.",
    preamble: "Angular 22 workspace.",
    mockupBytes: MOCKUP,
    mockupMimeType: "image/png",
    skillPaths: [],
    model: { provider: "deepseek", modelId: "deepseek-chat", temperature: 0 },
    budget: { maxWallClockMs: 1200000, maxCostUsd: 5, maxTurns: 50 },
    ...overrides,
  };
}

function usageTurnEnd(stopReason: string): PiEvent {
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
        cost: { total: 0.0021 },
      },
    },
  };
}

const naturalScript: PiEvent[] = [
  { type: "agent_start" },
  { type: "message_update", assistantMessageEvent: { type: "text_delta" } },
  usageTurnEnd("stop"),
  { type: "agent_end" },
];

async function collect(iter: AsyncIterable<AgentEventDraft>): Promise<AgentEventDraft[]> {
  const out: AgentEventDraft[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

describe("runSession (AGENT-02/04)", () => {
  it("yields the mapper drafts for a natural run and NO benchmark_finished terminal", async () => {
    const { createSession } = fakeFactory(naturalScript);
    const drafts = await collect(runSession(makeInput(), { createSession, now }));
    expect(drafts.map((d) => d.type)).toEqual([
      "session_started",
      "first_token",
      "unknown",
      "usage",
      "unknown",
    ]);
    expect(drafts.some((d) => d.type === "benchmark_finished")).toBe(false);
  });

  it("fires exactly one prompt: preamble + \\n\\n + promptText, mockup-only flat image", async () => {
    const { createSession, calls } = fakeFactory(naturalScript);
    const input = makeInput();
    await collect(runSession(input, { createSession, now }));
    expect(calls.prompts.length).toBe(1);
    const { text, opts } = calls.prompts[0];
    expect(text).toBe(input.preamble + "\n\n" + input.promptText);
    expect(opts.images).toHaveLength(1);
    expect(opts.images[0]).toEqual({
      type: "image",
      data: MOCKUP.toString("base64"),
      mimeType: "image/png",
    });
    // Byte-exact round trip (D4-07 verbatim mockup).
    expect(Buffer.from(opts.images[0].data, "base64").equals(MOCKUP)).toBe(true);
  });

  it("streams drafts live — the first draft arrives before prompt settles", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    const { createSession } = fakeFactory(naturalScript, { gate, gateAfter: 1 });
    const iter = runSession(makeInput(), { createSession, now })[Symbol.asyncIterator]();
    // If runSession awaited prompt() to completion before yielding, this would
    // hang on the closed gate and the test would time out — proving live streaming.
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.type).toBe("session_started");
    openGate();
    const rest: AgentEventDraft[] = [];
    for (let r = await iter.next(); !r.done; r = await iter.next()) rest.push(r.value);
    expect([first.value!, ...rest].map((d) => d.type)).toEqual([
      "session_started",
      "first_token",
      "unknown",
      "usage",
      "unknown",
    ]);
  });

  it("never leaks the provider key into the emitted event stream (D4-19)", async () => {
    const SENTINEL = "sk-SENTINEL-must-never-appear-1234567890";
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = SENTINEL;
    try {
      const { createSession } = fakeFactory(naturalScript);
      const drafts = await collect(runSession(makeInput(), { createSession, now }));
      expect(JSON.stringify(drafts)).not.toContain(SENTINEL);
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = prev;
    }
  });

  it("ends a fatal turn_end (stopReason:error) with benchmark_finished{agent_error}", async () => {
    const fatalScript: PiEvent[] = [{ type: "agent_start" }, usageTurnEnd("error")];
    const { createSession } = fakeFactory(fatalScript);
    const drafts = await collect(runSession(makeInput(), { createSession, now }));
    const last = drafts[drafts.length - 1];
    expect(last).toEqual({
      runId: "run-1",
      ts: 1_000,
      type: "benchmark_finished",
      status: "agent_error",
      failedStage: null,
    });
  });

  it("ends a rejected prompt with benchmark_finished{agent_error}", async () => {
    const { createSession } = fakeFactory([{ type: "agent_start" }], {
      rejectPromptWith: new Error("provider 500"),
    });
    const drafts = await collect(runSession(makeInput(), { createSession, now }));
    const last = drafts[drafts.length - 1];
    expect(last.type).toBe("benchmark_finished");
    expect((last as { status: string }).status).toBe("agent_error");
  });

  it("throws from assertAgentInput on a non-AgentInput before any session is created", async () => {
    const { createSession, calls } = fakeFactory(naturalScript);
    await expect(collect(runSession({}, { createSession, now }))).rejects.toThrow();
    expect(calls.prompts.length).toBe(0);
    await expect(
      collect(runSession(makeInput({ mockupBytes: undefined as unknown as Buffer }), { createSession, now })),
    ).rejects.toThrow();
  });

  it("no yielded draft carries an own seq property (storage owns seq, D4-26)", async () => {
    const { createSession } = fakeFactory(naturalScript);
    const drafts = await collect(runSession(makeInput(), { createSession, now }));
    for (const d of drafts) {
      expect(Object.prototype.hasOwnProperty.call(d, "seq")).toBe(false);
    }
  });
});
