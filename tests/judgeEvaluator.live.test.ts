// EVAL-04 live proof: calls the real claude-sonnet-5 model with two tiny real
// PNGs. Gated on ANTHROPIC_API_KEY -- skips cleanly (not fails) in this
// environment and in CI without a key, per 03-03-PLAN.md.
import { describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createJudgeEvaluator, DEFAULT_JUDGE_MODEL, type JudgeInput } from "../src/eval/judgeEvaluator.js";
import { makeExpectedPng, makeGeneratedMatchPng } from "./fixtures/eval/pngFixtures.js";

describe("createJudgeEvaluator live integration (EVAL-04)", () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    "returns a valid [0,1] score from the real claude-sonnet-5 model",
    async () => {
      const models = createModels();
      models.setProvider(anthropicProvider());
      const evaluator = createJudgeEvaluator(models, DEFAULT_JUDGE_MODEL, async () => null);

      const result = await evaluator.evaluate({
        expectedPng: makeExpectedPng(),
        generatedPng: makeGeneratedMatchPng(),
      } satisfies JudgeInput);

      expect(result.rawScore).toBeGreaterThanOrEqual(0);
      expect(result.rawScore).toBeLessThanOrEqual(1);
    },
    60_000,
  );
});
