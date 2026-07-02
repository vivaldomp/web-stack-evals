// EVAL-03/D3-10: axe-core accessibility evaluator. Runs against the live
// Playwright Page renderWithPage() hands back -- never navigates or manages
// browser lifecycle itself. Scoring starts at 1.0 and subtracts a
// severity-weighted penalty PER VIOLATED NODE (not per rule -- A1), floored at 0.
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { EvaluatorPort } from "../core/ports.js";

// Weights chosen so 2 critical-impact node violations alone floor the score at 0.
export const IMPACT_PENALTY: Record<string, number> = {
  critical: 0.5,
  serious: 0.25,
  moderate: 0.1,
  minor: 0.05,
};

export function createAxeEvaluator(): EvaluatorPort {
  return {
    name: "axe",
    async evaluate(rawInput: unknown) {
      const { page } = rawInput as { page: Page };
      const results = await new AxeBuilder({ page }).analyze();

      let penalty = 0;
      const byImpact: Record<string, number> = {};
      for (const violation of results.violations) {
        const impact = violation.impact ?? "minor";
        const weight = IMPACT_PENALTY[impact] ?? IMPACT_PENALTY.minor;
        const nodeCount = violation.nodes.length;
        penalty += weight * nodeCount;
        byImpact[impact] = (byImpact[impact] ?? 0) + nodeCount;
      }

      return {
        rawScore: Math.max(0, 1 - penalty),
        detail: { violationCount: results.violations.length, byImpact, penalty },
      };
    },
  };
}
