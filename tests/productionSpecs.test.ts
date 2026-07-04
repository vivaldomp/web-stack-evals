import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadModel, loadScenario } from "../src/specs/load.js";

// Paths resolve relative to process.cwd() = repo root, matching the D5-02
// named-flag resolution in the `run` command.

describe("production model spec", () => {
  it("loadModel('models/deepseek4pro.json') resolves and validates", () => {
    const model = loadModel("models/deepseek4pro.json");
    expect(model.provider).toBe("deepseek");
    expect(model.modelId).toBe("deepseek-v4-pro");
    expect(model.params.temperature).toBe(0.2);
  });
});

// Every directory under scenarios/ is a production scenario (dirs starting
// with "_" hold shared assets, e.g. the compiled Tailwind theme).
const scenarioNames = readdirSync("scenarios", { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .map((e) => e.name);

describe("production scenario specs", () => {
  it("finds at least the six curated scenarios", () => {
    expect(scenarioNames).toEqual(
      expect.arrayContaining(["dashboard", "login", "table-page", "kanban-board", "settings", "contact-form"]),
    );
  });

  describe.each(scenarioNames)("scenarios/%s", (name) => {
    const dir = join("scenarios", name);

    it("parses under the real schema with the standard viewport", () => {
      const scenario = loadScenario(join(dir, `${name}.yaml`));
      expect(scenario.expected.path).toBe("expected.png");
      expect(scenario.viewport).toEqual({ width: 1280, height: 800 });
      expect(scenario.skills).toEqual([]);
    });

    it("resolves expected.png at the scenario-relative expected.path (non-empty)", () => {
      const scenario = loadScenario(join(dir, `${name}.yaml`));
      const bytes = readFileSync(join(dir, scenario.expected.path));
      expect(bytes.length).toBeGreaterThan(0);
    });

    it("has a non-empty mockup.png the orchestrator reads at join(scenarioDir, 'mockup.png')", () => {
      const bytes = readFileSync(join(dir, "mockup.png"));
      expect(bytes.length).toBeGreaterThan(0);
    });
  });
});
