// EVAL-02 coverage: createDomEvaluator() against a real (headless, file://)
// Playwright page from renderWithPage() -- no mocked Page object (D3-08/D3-09).
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderWithPage } from "../src/render/renderWithPage.js";
import { createDomEvaluator } from "../src/eval/domEvaluator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = `file://${join(__dirname, "fixtures/eval/app.html")}`;
const viewport = { width: 400, height: 300 };

describe("createDomEvaluator (EVAL-02)", () => {
  it("scores a gradient with missing selectors reported in detail.missing", async () => {
    const result = await renderWithPage({ url: fixtureUrl, viewport });
    try {
      const evaluator = createDomEvaluator([
        "nav[role='navigation']",
        ".dashboard-card",
        "button[type='submit']",
        ".does-not-exist",
      ]);
      const { rawScore, detail } = await evaluator.evaluate({ page: result.page });
      expect(rawScore).toBe(0.75);
      expect((detail as { missing: string[] }).missing).toEqual([".does-not-exist"]);
    } finally {
      await result.close();
    }
  }, 30_000);

  it("scores 1 when every declared selector matches at least one element", async () => {
    const result = await renderWithPage({ url: fixtureUrl, viewport });
    try {
      const evaluator = createDomEvaluator(["nav[role='navigation']", ".dashboard-card", "button[type='submit']"]);
      const { rawScore } = await evaluator.evaluate({ page: result.page });
      expect(rawScore).toBe(1);
    } finally {
      await result.close();
    }
  }, 30_000);
});
