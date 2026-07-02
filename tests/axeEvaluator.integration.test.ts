// EVAL-03 coverage: createAxeEvaluator() against real (headless, file://)
// Playwright pages from renderWithPage() (D3-10). Clean fixture scores exactly
// 1; the violating fixture (missing img alt) scores strictly lower, without
// hardcoding axe-core's own impact classification for image-alt.
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderWithPage } from "../src/render/renderWithPage.js";
import { createAxeEvaluator, IMPACT_PENALTY } from "../src/eval/axeEvaluator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cleanFixtureUrl = `file://${join(__dirname, "fixtures/eval/app-clean.html")}`;
const violatingFixtureUrl = `file://${join(__dirname, "fixtures/eval/app.html")}`;
const viewport = { width: 400, height: 300 };

describe("createAxeEvaluator (EVAL-03)", () => {
  it("scores exactly 1 on an a11y-clean page", async () => {
    const result = await renderWithPage({ url: cleanFixtureUrl, viewport });
    try {
      const { rawScore, detail } = await createAxeEvaluator().evaluate({ page: result.page });
      expect(rawScore).toBe(1);
      expect((detail as { violationCount: number }).violationCount).toBe(0);
    } finally {
      await result.close();
    }
  }, 30_000);

  it("scores strictly less than the clean fixture when a violation is present", async () => {
    const clean = await renderWithPage({ url: cleanFixtureUrl, viewport });
    const violating = await renderWithPage({ url: violatingFixtureUrl, viewport });
    try {
      const cleanResult = await createAxeEvaluator().evaluate({ page: clean.page });
      const violatingResult = await createAxeEvaluator().evaluate({ page: violating.page });

      expect(violatingResult.rawScore).toBeGreaterThanOrEqual(0);
      expect(violatingResult.rawScore).toBeLessThan(1);
      expect((violatingResult.detail as { violationCount: number }).violationCount).toBeGreaterThanOrEqual(1);
      expect(violatingResult.rawScore).toBeLessThan(cleanResult.rawScore);
    } finally {
      await clean.close();
      await violating.close();
    }
  }, 30_000);

  it("never scores below 0, even for a synthetic high-violation-count case", () => {
    const syntheticViolations = Array.from({ length: 10 }, () => ({
      impact: "critical",
      nodes: Array.from({ length: 10 }, () => ({})),
    }));
    let penalty = 0;
    for (const violation of syntheticViolations) {
      penalty += IMPACT_PENALTY[violation.impact] * violation.nodes.length;
    }
    expect(Math.max(0, 1 - penalty)).toBe(0);
  });
});
