// EVAL-02/D3-08/D3-09: DOM structural-presence evaluator. Runs against the live
// Playwright Page renderWithPage() hands back (03-02-PLAN.md) -- never navigates
// or manages browser lifecycle itself. Scoring is a gradient (found/declared),
// never pass/fail, per D3-08.
import type { Page } from "playwright";
import type { EvaluatorPort } from "../core/ports.js";

export function createDomEvaluator(expectedElements: string[]): EvaluatorPort {
  return {
    name: "dom",
    async evaluate(rawInput: unknown) {
      const { page } = rawInput as { page: Page };
      let found = 0;
      const missing: string[] = [];
      for (const selector of expectedElements) {
        const count = await page.locator(selector).count();
        if (count > 0) found++;
        else missing.push(selector);
      }
      return {
        rawScore: found / expectedElements.length,
        detail: { found, declared: expectedElements.length, missing },
      };
    },
  };
}
