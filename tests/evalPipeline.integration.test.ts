// ROADMAP Phase 3 Success Criterion 5 proof: every real piece this phase
// built -- renderWithPage() (03-02), the four real evaluators (03-03/03-04),
// buildRegistry() (03-06), and evaluateRun() (03-05) -- wired together with
// NO mocks. The judge evaluator's Models instance still uses pi-ai's
// fauxProvider() test double (same pattern as tests/judgeEvaluator.test.ts
// and tests/registry.test.ts) so this test never requires ANTHROPIC_API_KEY
// and never makes a live network call. No dev server, no Pi SDK, no agent.
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { openDb } from "../src/storage/db.js";
import { renderWithPage } from "../src/render/renderWithPage.js";
import { buildRegistry } from "../src/eval/registry.js";
import { DEFAULT_JUDGE_MODEL } from "../src/eval/judgeEvaluator.js";
import { evaluateRun } from "../src/pipeline/evaluate.js";
import { DEFAULT_EVALUATOR_WEIGHTS } from "../src/pipeline/composite.js";
import { makeExpectedPng, makeGeneratedMatchPng } from "./fixtures/eval/pngFixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = `file://${join(__dirname, "fixtures/eval/app.html")}`;
const viewport = { width: 400, height: 300 };
const runId = "run-eval-pipeline-integration";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  rmSync(resolve("results", runId), { recursive: true, force: true });
});

describe("evaluation pipeline end-to-end (ROADMAP Phase 3 SC1/SC4/SC5)", () => {
  it("renders once, scores through all four real evaluators, and persists raw scores + a re-derivable composite", async () => {
    dir = mkdtempSync(join(tmpdir(), "web-stack-evals-eval-pipeline-integration-"));
    const db = openDb(join(dir, "results.sqlite"));
    db.prepare("INSERT INTO runs (run_id) VALUES (?)").run(runId);

    // Faux provider registered under DEFAULT_JUDGE_MODEL's own provider/model
    // ids, so buildRegistry can be called with the real DEFAULT_JUDGE_MODEL
    // constant while still resolving to a zero-network test double.
    const faux = fauxProvider({
      provider: DEFAULT_JUDGE_MODEL.provider,
      models: [{ id: DEFAULT_JUDGE_MODEL.modelId, input: ["text", "image"] }],
    });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("submit_verdict", {
            layoutFidelity: 0.9,
            componentPresence: 0.8,
            visualStylingFidelity: 0.7,
            rationale: "close match",
          }),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);

    const liveRender = await renderWithPage({ url: fixtureUrl, viewport });

    try {
      const registry = buildRegistry({
        db,
        models,
        expectedElements: ["nav[role='navigation']", ".dashboard-card", "button[type='submit']"],
        judgeModel: DEFAULT_JUDGE_MODEL,
      });

      const result = await evaluateRun({
        db,
        runId,
        repIndex: 0,
        expectedPng: makeExpectedPng(),
        generatedPng: makeGeneratedMatchPng(),
        viewport,
        page: liveRender.page,
        registry,
        defaultWeights: DEFAULT_EVALUATOR_WEIGHTS,
      });

      const rows = db
        .prepare("SELECT evaluator_name, raw_score FROM evaluations WHERE run_id = ? ORDER BY evaluator_name")
        .all(runId) as { evaluator_name: string; raw_score: number | null }[];

      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.evaluator_name)).toEqual(["axe", "dom", "judge", "pixelmatch"]);
      for (const row of rows) {
        expect(row.raw_score).not.toBeNull();
        expect(row.raw_score as number).toBeGreaterThanOrEqual(0);
        expect(row.raw_score as number).toBeLessThanOrEqual(1);
      }

      expect(result.compositeScore).not.toBeNull();
      const runRow = db.prepare("SELECT composite_score, composite_weights FROM runs WHERE run_id = ?").get(runId) as {
        composite_score: number | null;
        composite_weights: string | null;
      };
      expect(runRow.composite_score).not.toBeNull();
      expect(runRow.composite_score as number).toBeGreaterThanOrEqual(0);
      expect(runRow.composite_score as number).toBeLessThanOrEqual(1);

      const weights = JSON.parse(runRow.composite_weights as string) as Record<string, number>;
      const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(weightSum).toBeCloseTo(1, 10);

      const diffScreenshot = db
        .prepare(
          `SELECT role FROM screenshots WHERE artifact_id = (
             SELECT id FROM artifacts WHERE run_id = ? AND kind = 'screenshot' ORDER BY id DESC LIMIT 1
           )`,
        )
        .get(runId) as { role: string } | undefined;
      expect(diffScreenshot?.role).toBe("diff");

      // D3-17: the page survived being shared by dom + axe inside evaluateRun's
      // loop -- only this top-level caller closes it, only once, after both
      // evaluators (and everything else in the loop) have finished.
      expect(liveRender.page.isClosed()).toBe(false);
    } finally {
      await liveRender.close();
    }

    expect(liveRender.page.isClosed()).toBe(true);
    db.close();
  }, 30_000);
});
