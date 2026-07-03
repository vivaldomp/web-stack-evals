import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadModel, loadScenario } from "../src/specs/load.js";

// Paths resolve relative to process.cwd() = repo root, matching the D5-02
// named-flag resolution in the `run` command.

describe("production model spec", () => {
  it("loadModel('models/deepseek4pro.json') resolves and validates", () => {
    const model = loadModel("models/deepseek4pro.json");
    expect(model.provider).toBe("deepseek");
    expect(model.modelId).toBe("deepseek-4-pro");
    expect(model.params.temperature).toBe(0.2);
  });
});

describe("production scenario spec", () => {
  it("loadScenario('scenarios/dashboard/dashboard.yaml') parses under the real schema", () => {
    const scenario = loadScenario("scenarios/dashboard/dashboard.yaml");
    expect(scenario.expected.path).toBe("expected.png");
    expect(scenario.viewport).toEqual({ width: 1280, height: 800 });
    expect(scenario.skills).toEqual([]);
  });

  it("resolves expected.png at the scenario-relative expected.path (non-empty)", () => {
    const scenario = loadScenario("scenarios/dashboard/dashboard.yaml");
    const bytes = readFileSync(join("scenarios/dashboard", scenario.expected.path));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("has a non-empty mockup.png the orchestrator reads at join(scenarioDir, 'mockup.png')", () => {
    const bytes = readFileSync("scenarios/dashboard/mockup.png");
    expect(bytes.length).toBeGreaterThan(0);
  });
});
