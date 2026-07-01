import { describe, it, expect } from "vitest";
import { loadStack, loadScenario, loadModel } from "../src/specs/load.js";

const FIXTURES = "tests/fixtures";

describe("loadStack", () => {
  it("returns a typed Stack with port 4200 for a valid fixture", () => {
    const stack = loadStack(`${FIXTURES}/stacks/angular.yaml`);
    expect(stack.port).toBe(4200);
    expect(stack.template).toBe("angular");
  });

  it("throws naming the offending key and the file path for a malformed fixture", () => {
    const path = `${FIXTURES}/stacks/angular.bad.yaml`;
    expect(() => loadStack(path)).toThrow();
    try {
      loadStack(path);
      throw new Error("expected loadStack to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(path);
      expect(message).toContain("widht");
    }
  });
});

describe("loadScenario", () => {
  it("returns a Scenario with expected.provenance.source defined", () => {
    const scenario = loadScenario(`${FIXTURES}/scenarios/dashboard/dashboard.yaml`);
    expect(scenario.expected.provenance.source).toBeDefined();
    expect(scenario.expected.provenance.source).toBe("hand-designed");
  });
});

describe("loadModel", () => {
  it("returns a ModelConfig with provider and modelId", () => {
    const model = loadModel(`${FIXTURES}/models/deepseek4pro.json`);
    expect(model.provider).toBe("deepseek");
    expect(model.modelId).toBe("deepseek-4-pro");
  });
});
