import { describe, it, expect } from "vitest";
import type { AgentInput } from "../src/agent/types.js";

// The primary gate is `tsc --noEmit` accepting this literal against AgentInput
// (all nine fields, correct types). The runtime asserts prove it is well-formed.
describe("AgentInput contract (D4-22)", () => {
  const input: AgentInput = {
    runId: "run-1",
    workspacePath: "tmp/run-1/angular/",
    promptText: "Build a dashboard.",
    preamble: "An Angular skeleton exists in the workspace.",
    mockupBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mockupMimeType: "image/png",
    skillPaths: ["skills/a11y/", "skills/responsive/"],
    model: { provider: "deepseek", modelId: "deepseek-4-pro", temperature: 0 },
    budget: { maxWallClockMs: 1_200_000, maxCostUsd: 5, maxTurns: 50 },
  };

  it("constructs a well-formed AgentInput literal", () => {
    expect(Buffer.isBuffer(input.mockupBytes)).toBe(true);
    expect(input.skillPaths).toEqual(["skills/a11y/", "skills/responsive/"]);
    expect(input.budget.maxTurns).toBe(50);
    expect(input.mockupMimeType).toBe("image/png");
    expect(input.model.temperature).toBe(0);
  });
});
