// EVAL-04/D3-11/D3-12/D3-13/D3-14: LLM judge evaluator via pi-ai tool-calling.
// The ONLY production file (besides its own tests) permitted to import
// @earendil-works/pi-ai -- keeps the "no agent, no network" checkpoint (SC5)
// reachable in CI via the fauxProvider() test double. The judge sees only the
// two images plus fixed rubric instructions (D3-12) -- never the scenario's
// prompt, generated code, or DOM.
import { Type, type Context, type Models, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { z } from "zod";
import type { EvaluatorPort } from "../core/ports.js";
import { sha256 } from "../manifest/fingerprint.js";

/** Bump on any rubric/schema change -- folded into the cache fingerprint, invalidating old cache entries. */
export const RUBRIC_VERSION = "v1";

export interface JudgeModelSpec {
  provider: string;
  modelId: string;
}

/** D3-11's default: independent model family from the agent-under-test, vision-capable, no supportsTemperature:false override. */
export const DEFAULT_JUDGE_MODEL: JudgeModelSpec = { provider: "anthropic", modelId: "claude-sonnet-5" };

/** Open Question 1's recommendation -- named constant, easy to retune. */
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 50;

const VerdictSchema = z.object({
  layoutFidelity: z.number().min(0).max(1),
  componentPresence: z.number().min(0).max(1),
  visualStylingFidelity: z.number().min(0).max(1),
  rationale: z.string(),
});

const submitVerdictTool: Tool = {
  name: "submit_verdict",
  description: "Submit the visual-fidelity verdict comparing the expected mockup to the generated implementation.",
  parameters: Type.Object({
    layoutFidelity: Type.Number({ minimum: 0, maximum: 1 }),
    componentPresence: Type.Number({ minimum: 0, maximum: 1 }),
    visualStylingFidelity: Type.Number({ minimum: 0, maximum: 1 }),
    rationale: Type.String(),
  }),
};

export interface JudgeInput {
  expectedPng: Buffer;
  generatedPng: Buffer;
}

type CachedVerdict = { rawScore: number; detail: unknown };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createJudgeEvaluator(
  models: Models,
  modelSpec: JudgeModelSpec,
  lookupCachedVerdict: (fingerprint: string) => Promise<CachedVerdict | null>,
): EvaluatorPort {
  const model = models.getModel(modelSpec.provider, modelSpec.modelId);
  if (!model) {
    throw new Error(`createJudgeEvaluator: unknown model ${modelSpec.provider}/${modelSpec.modelId}`);
  }
  // Pitfall 3: claude-opus-4-7/4-8 reject temperature=0 -- fail loudly here at
  // construction time, not via the transient-error retry loop.
  const compat = model.compat as { supportsTemperature?: boolean } | undefined;
  if (compat?.supportsTemperature === false) {
    throw new Error(
      `createJudgeEvaluator: model ${modelSpec.provider}/${modelSpec.modelId} does not support temperature=0 (compat.supportsTemperature === false)`,
    );
  }

  return {
    name: "judge",
    async evaluate(rawInput: unknown) {
      const input = rawInput as JudgeInput;
      const fingerprint = sha256(Buffer.concat([input.expectedPng, input.generatedPng, Buffer.from(RUBRIC_VERSION)]));

      const cached = await lookupCachedVerdict(fingerprint);
      if (cached) {
        return {
          rawScore: cached.rawScore,
          detail: { ...(cached.detail as Record<string, unknown>), cached: true },
        };
      }

      const context: Context = {
        systemPrompt:
          "You are a strict visual QA judge comparing the expected mockup to the generated implementation. " +
          "Score three dimensions each from 0 to 1: layoutFidelity, componentPresence, visualStylingFidelity, " +
          "and give a short rationale. You must respond by calling submit_verdict -- never respond in plain text.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Expected mockup:" },
              { type: "image", data: input.expectedPng.toString("base64"), mimeType: "image/png" },
              { type: "text", text: "Generated implementation:" },
              { type: "image", data: input.generatedPng.toString("base64"), mimeType: "image/png" },
            ],
            timestamp: Date.now(),
          },
        ],
        tools: [submitVerdictTool],
      };

      let lastError: unknown = new Error("judge evaluator: no attempts made");
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await models.complete(model, context, { temperature: 0 });
          const toolCall = response.content.find(
            (block): block is ToolCall => block.type === "toolCall" && block.name === "submit_verdict",
          );
          if (!toolCall) {
            throw new Error("judge response did not call submit_verdict");
          }
          const parsed = VerdictSchema.parse(toolCall.arguments);
          const rawScore = (parsed.layoutFidelity + parsed.componentPresence + parsed.visualStylingFidelity) / 3;
          return {
            rawScore,
            detail: { ...parsed, fingerprint, cached: false, usage: response.usage },
          };
        } catch (error) {
          lastError = error;
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_BACKOFF_MS * (attempt + 1));
          }
        }
      }

      // rawScore: 0 here is a placeholder never trusted by the composite
      // step, which reads detail.dropped instead (03-RESEARCH.md).
      return { rawScore: 0, detail: { dropped: true, reason: String(lastError) } };
    },
  };
}
