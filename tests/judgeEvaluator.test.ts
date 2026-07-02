// EVAL-04/D3-11/D3-12/D3-13/D3-14 coverage: all via pi-ai's fauxProvider()
// test double -- zero network calls. Covers a valid verdict, an out-of-range
// dimension rejected by VerdictSchema, exhausted retries on a plain-text-only
// model, a fingerprint cache hit skipping the model entirely, and a
// construction-time throw for a model that rejects temperature=0.
import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createJudgeEvaluator, type JudgeInput } from "../src/eval/judgeEvaluator.js";

const expectedPng = Buffer.from("expected-fixture-bytes");
const generatedPng = Buffer.from("generated-fixture-bytes");

function setupFaux() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models, modelSpec: { provider: faux.provider.id, modelId: faux.getModel().id } };
}

describe("createJudgeEvaluator (EVAL-04)", () => {
  it("returns the mean-of-three rawScore and rationale on a valid submit_verdict call", async () => {
    const { faux, models, modelSpec } = setupFaux();
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
    const evaluator = createJudgeEvaluator(models, modelSpec, async () => null);

    const result = await evaluator.evaluate({ expectedPng, generatedPng } satisfies JudgeInput);

    expect(result.rawScore).toBeCloseTo((0.9 + 0.8 + 0.7) / 3, 10);
    expect((result.detail as { rationale: string }).rationale).toBe("close match");
  });

  it("never persists an out-of-range dimension as a score -- zod bound-check drops it like a missing tool call", async () => {
    const { faux, models, modelSpec } = setupFaux();
    const invalid = fauxAssistantMessage(
      [
        fauxToolCall("submit_verdict", {
          layoutFidelity: 1.4,
          componentPresence: 0.8,
          visualStylingFidelity: 0.7,
          rationale: "out of range",
        }),
      ],
      { stopReason: "toolUse" },
    );
    faux.setResponses([invalid, invalid, invalid]);
    const evaluator = createJudgeEvaluator(models, modelSpec, async () => null);

    const result = await evaluator.evaluate({ expectedPng, generatedPng } satisfies JudgeInput);

    expect((result.detail as { dropped?: boolean }).dropped).toBe(true);
  });

  it("returns detail.dropped=true with a reason after MAX_RETRIES when the model only answers in plain text, never throws", async () => {
    const { faux, models, modelSpec } = setupFaux();
    const plainText = fauxAssistantMessage([fauxText("It looks fine to me.")]);
    faux.setResponses([plainText, plainText, plainText]);
    const evaluator = createJudgeEvaluator(models, modelSpec, async () => null);

    const result = await evaluator.evaluate({ expectedPng, generatedPng } satisfies JudgeInput);

    expect((result.detail as { dropped: boolean }).dropped).toBe(true);
    expect(typeof (result.detail as { reason: string }).reason).toBe("string");
  });

  it("skips a second model call entirely on a fingerprint cache hit (D3-14)", async () => {
    const { faux, models, modelSpec } = setupFaux();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("submit_verdict", {
            layoutFidelity: 0.9,
            componentPresence: 0.9,
            visualStylingFidelity: 0.9,
            rationale: "great",
          }),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    let cachedResult: { rawScore: number; detail: unknown } | null = null;
    const evaluator = createJudgeEvaluator(models, modelSpec, async () => cachedResult);

    const first = await evaluator.evaluate({ expectedPng, generatedPng } satisfies JudgeInput);
    cachedResult = { rawScore: first.rawScore, detail: first.detail };
    const second = await evaluator.evaluate({ expectedPng, generatedPng } satisfies JudgeInput);

    expect(second.rawScore).toBe(first.rawScore);
    expect(faux.state.callCount).toBe(1);
  });

  it("throws synchronously at construction for a model whose catalog reports compat.supportsTemperature === false", () => {
    const models = createModels();
    models.setProvider(anthropicProvider());

    expect(() =>
      createJudgeEvaluator(models, { provider: "anthropic", modelId: "claude-opus-4-7" }, async () => null),
    ).toThrow();
  });
});
