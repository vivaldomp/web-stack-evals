import { describe, it, expect } from "vitest";
import { loadStack, loadScenario, loadModel } from "../src/specs/load.js";
import { StackSchema } from "../src/specs/schema.js";

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
