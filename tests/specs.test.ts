import { describe, it, expect } from "vitest";
import { loadStack, loadScenario, loadModel } from "../src/specs/load.js";
import { StackSchema, ScenarioSchema } from "../src/specs/schema.js";

const FIXTURES = "tests/fixtures";

const VALID_STACK = {
  template: "angular",
  install: "npm ci",
  build: "npm run build",
  start: "npm start",
  port: 4200,
  viewport: { width: 1280, height: 800 },
};

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

describe("StackSchema lint/test + timeout overrides", () => {
  it("accepts the base fixture with no lint/test/timeout overrides", () => {
    expect(StackSchema.safeParse(VALID_STACK).success).toBe(true);
  });

  it("accepts lint/test command strings and a timeout override together", () => {
    const result = StackSchema.safeParse({
      ...VALID_STACK,
      lint: "npm run lint",
      test: "npm test",
      buildTimeoutMs: 1000,
    });
    expect(result.success).toBe(true);
  });

  it("still rejects unknown keys (.strict() preserved)", () => {
    const result = StackSchema.safeParse({ ...VALID_STACK, somethingUnknown: true });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive timeout override", () => {
    const result = StackSchema.safeParse({ ...VALID_STACK, buildTimeoutMs: -1 });
    expect(result.success).toBe(false);
  });
});

describe("loadScenario", () => {
  it("returns a Scenario with expected.provenance.source defined", () => {
    const scenario = loadScenario(`${FIXTURES}/scenarios/dashboard/dashboard.yaml`);
    expect(scenario.expected.provenance.source).toBeDefined();
    expect(scenario.expected.provenance.source).toBe("hand-designed");
  });
});

const VALID_SCENARIO = {
  prompt: "Build a dashboard.",
  expected: {
    path: "expected.png",
    provenance: {
      source: "hand-designed",
      tool: "figma",
      version: "1.0",
      date: "2026-06-15",
    },
  },
  viewport: { width: 1280, height: 800 },
  skills: [],
};

describe("ScenarioSchema expectedElements + evaluatorWeights (D3-08, D3-02)", () => {
  it("still parses a scenario with no expectedElements/evaluatorWeights keys (dashboard fixture shape)", () => {
    const scenario = loadScenario(`${FIXTURES}/scenarios/dashboard/dashboard.yaml`);
    expect(ScenarioSchema.safeParse(scenario).success).toBe(true);
  });

  it("accepts expectedElements and round-trips the array", () => {
    const expectedElements = ["nav[role=navigation]", ".dashboard-card"];
    const result = ScenarioSchema.safeParse({ ...VALID_SCENARIO, expectedElements });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expectedElements).toEqual(expectedElements);
    }
  });

  it("accepts evaluatorWeights and round-trips the record", () => {
    const evaluatorWeights = { pixelmatch: 0.4, dom: 0.2, axe: 0.2, judge: 0.2 };
    const result = ScenarioSchema.safeParse({ ...VALID_SCENARIO, evaluatorWeights });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evaluatorWeights).toEqual(evaluatorWeights);
    }
  });

  it("still rejects an unrelated unknown top-level key (.strict() preserved)", () => {
    const result = ScenarioSchema.safeParse({ ...VALID_SCENARIO, notAField: true });
    expect(result.success).toBe(false);
  });
});

describe("loadModel", () => {
  it("returns a ModelConfig with provider and modelId", () => {
    const model = loadModel(`${FIXTURES}/models/deepseek4pro.json`);
    expect(model.provider).toBe("deepseek");
    expect(model.modelId).toBe("deepseek-4-pro");
  });
});

describe("loadStack (production stacks/angular.yaml)", () => {
  it("parses the real Angular stack spec and matches the declared field values", () => {
    const stack = loadStack("stacks/angular.yaml");
    expect(stack.template).toBe("stacks/angular/template");
    expect(stack.install).toBe("npm ci --ignore-scripts");
    expect(stack.build).toBe("npm run build");
    expect(stack.lint).toBe("npm run lint");
    expect(stack.test).toBe("npm test");
    expect(stack.start).toBe("npm start");
    expect(stack.port).toBe(4200);
    expect(stack.viewport).toEqual({ width: 1280, height: 800 });
  });
});
