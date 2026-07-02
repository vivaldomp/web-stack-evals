// EVAL-01/D3-05/D3-06/D3-07 coverage: identical images score 1.0; a
// dimension-mismatched near-identical pair scores between 0 and 1 without
// throwing (Pitfall 1); a genuinely degraded pair scores well below the
// matched pair (D3-04's "agent-caused degradation counts"); a diff PNG is
// always produced.
import { describe, expect, it } from "vitest";
import { createPixelMatchEvaluator, type PixelMatchInput } from "../src/eval/pixelmatchEvaluator.js";
import {
  makeExpectedPng,
  makeGeneratedDegradedPng,
  makeGeneratedMatchPng,
} from "./fixtures/eval/pngFixtures.js";

const viewport = { width: 40, height: 30 };

describe("createPixelMatchEvaluator (EVAL-01)", () => {
  it("scores 1.0 with zero mismatched pixels for an identical buffer pair", async () => {
    const expectedPng = makeExpectedPng();
    const evaluator = createPixelMatchEvaluator();

    const result = await evaluator.evaluate({
      expectedPng,
      generatedPng: expectedPng,
      viewport,
    } satisfies PixelMatchInput);

    expect(result.rawScore).toBe(1);
    expect((result.detail as { mismatchedPixels: number }).mismatchedPixels).toBe(0);
  });

  it("does not throw on a dimension mismatch and scores strictly between 0 and 1 for a near-identical pair", async () => {
    const evaluator = createPixelMatchEvaluator();

    const result = await evaluator.evaluate({
      expectedPng: makeExpectedPng(),
      generatedPng: makeGeneratedMatchPng(),
      viewport,
    } satisfies PixelMatchInput);

    expect(result.rawScore).toBeGreaterThan(0);
    expect(result.rawScore).toBeLessThan(1);
  });

  it("scores a genuinely degraded generated app well below the matched pair (agent-caused degradation counts)", async () => {
    const evaluator = createPixelMatchEvaluator();

    const matched = await evaluator.evaluate({
      expectedPng: makeExpectedPng(),
      generatedPng: makeGeneratedMatchPng(),
      viewport,
    } satisfies PixelMatchInput);

    const degraded = await evaluator.evaluate({
      expectedPng: makeExpectedPng(),
      generatedPng: makeGeneratedDegradedPng(),
      viewport,
    } satisfies PixelMatchInput);

    expect(degraded.rawScore).toBeLessThan(matched.rawScore);
  });

  it("always produces a non-empty diff PNG buffer", async () => {
    const evaluator = createPixelMatchEvaluator();

    const result = await evaluator.evaluate({
      expectedPng: makeExpectedPng(),
      generatedPng: makeGeneratedDegradedPng(),
      viewport,
    } satisfies PixelMatchInput);

    const diffPng = (result.detail as { diffPng: Buffer }).diffPng;
    expect(Buffer.isBuffer(diffPng)).toBe(true);
    expect(diffPng.length).toBeGreaterThan(0);
  });
});
