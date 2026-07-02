// SCORE-01/D3-01/D3-03/D3-04 coverage: composeScore is a weighted mean over
// survivors, renormalized so a dropped evaluator is never counted as 0, and
// short-circuits to null (never 0/NaN) when every evaluator drops (Pitfall 5).
import { describe, expect, it } from "vitest";
import { composeScore, DEFAULT_EVALUATOR_WEIGHTS, type EvaluatorOutcome } from "../src/pipeline/composite.js";

describe("composeScore (SCORE-01)", () => {
  it("computes the plain weighted mean when all four evaluators survive at equal default weights", () => {
    const outcomes: EvaluatorOutcome[] = [
      { evaluatorName: "pixelmatch", rawScore: 1.0, dropped: false },
      { evaluatorName: "dom", rawScore: 0.5, dropped: false },
      { evaluatorName: "axe", rawScore: 0.8, dropped: false },
      { evaluatorName: "judge", rawScore: 0.6, dropped: false },
    ];

    const result = composeScore(outcomes);

    expect(result.compositeScore).toBeCloseTo(0.725, 10);
    expect(result.weightsUsed).toEqual(DEFAULT_EVALUATOR_WEIGHTS);
  });

  it("renormalizes survivor weights when judge drops, matching the research worked example", () => {
    const outcomes: EvaluatorOutcome[] = [
      { evaluatorName: "pixelmatch", rawScore: 1.0, dropped: false },
      { evaluatorName: "dom", rawScore: 0.5, dropped: false },
      { evaluatorName: "axe", rawScore: 0.8, dropped: false },
      { evaluatorName: "judge", dropped: true, reason: "API error after retries" },
    ];

    const result = composeScore(outcomes);

    expect(result.weightsUsed.pixelmatch).toBeCloseTo(1 / 3, 10);
    expect(result.weightsUsed.dom).toBeCloseTo(1 / 3, 10);
    expect(result.weightsUsed.axe).toBeCloseTo(1 / 3, 10);
    expect(result.weightsUsed.judge).toBeUndefined();
    expect(result.compositeScore).toBeCloseTo((1.0 + 0.5 + 0.8) / 3, 10);
  });

  it("returns null (never 0 or NaN) when every evaluator drops", () => {
    const outcomes: EvaluatorOutcome[] = [
      { evaluatorName: "pixelmatch", dropped: true, reason: "render failed" },
      { evaluatorName: "dom", dropped: true, reason: "render failed" },
      { evaluatorName: "axe", dropped: true, reason: "render failed" },
      { evaluatorName: "judge", dropped: true, reason: "API error after retries" },
    ];

    const result = composeScore(outcomes);

    expect(result.compositeScore).toBeNull();
    expect(result.weightsUsed).toEqual({});
  });

  it("honors a scenario-supplied custom weight map over the default", () => {
    const outcomes: EvaluatorOutcome[] = [
      { evaluatorName: "pixelmatch", rawScore: 1.0, dropped: false },
      { evaluatorName: "dom", rawScore: 0.5, dropped: false },
      { evaluatorName: "axe", rawScore: 0.8, dropped: false },
      { evaluatorName: "judge", rawScore: 0.6, dropped: false },
    ];
    const customWeights = { pixelmatch: 0.7, dom: 0.1, axe: 0.1, judge: 0.1 };

    const defaultResult = composeScore(outcomes);
    const customResult = composeScore(outcomes, customWeights);

    expect(customResult.compositeScore).not.toBeCloseTo(defaultResult.compositeScore as number, 5);
    expect(customResult.compositeScore).toBeCloseTo(1.0 * 0.7 + 0.5 * 0.1 + 0.8 * 0.1 + 0.6 * 0.1, 10);
  });
});
