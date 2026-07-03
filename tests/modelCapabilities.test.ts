// D5-01/D5-14 capability probe: `modelAcceptsImage` answers "does the resolved
// Pi model accept image input?" via `model.input?.includes("image")`. These cases
// inject an INLINE fake resolver (mirrors the SessionFactory fake pattern), so the
// predicate is exercised with zero real ModelRegistry / network / registry call.
import { describe, it, expect } from "vitest";
import { modelAcceptsImage } from "../src/agent/modelCapabilities.js";
import type { AgentModelSpec } from "../src/agent/types.js";

const spec: AgentModelSpec = { provider: "deepseek", modelId: "deepseek-4-pro", temperature: 0 };

describe("modelAcceptsImage (D5-01/D5-14 capability probe)", () => {
  it("returns true when the resolved model's input list includes \"image\"", () => {
    expect(modelAcceptsImage(spec, () => ({ input: ["text", "image"] }))).toBe(true);
  });

  it("returns false when the resolved model is text-only", () => {
    expect(modelAcceptsImage(spec, () => ({ input: ["text"] }))).toBe(false);
  });

  it("returns false when the model does not resolve (undefined)", () => {
    expect(modelAcceptsImage(spec, () => undefined)).toBe(false);
  });
});
