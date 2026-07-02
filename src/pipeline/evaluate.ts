// EVAL-05/SCORE-02: the orchestration point that turns "a registry of
// evaluators + a shared input" into "N persisted evaluations rows + one
// composite score written to the runs row" (D3-15). This module never
// imports src/eval/registry.ts or any concrete evaluator module, and never
// imports "playwright" -- it only knows the EvaluatorPort seam (D-23).
import type Database from "better-sqlite3";
import type { EvaluatorPort } from "../core/ports.js";
import { insertEvaluation, updateRunComposite, linkDiffScreenshot } from "../storage/evaluations.js";
import { composeScore, DEFAULT_EVALUATOR_WEIGHTS, type EvaluatorOutcome } from "./composite.js";

export interface EvaluateRunInput {
  db: Database.Database;
  runId: string;
  repIndex: number;
  expectedPng: Buffer;
  generatedPng: Buffer;
  viewport: { width: number; height: number };
  page: unknown;
  registry: EvaluatorPort[];
  defaultWeights?: Record<string, number>;
}

export interface EvaluateRunResult {
  compositeScore: number | null;
  weightsUsed: Record<string, number>;
  outcomes: EvaluatorOutcome[];
}

/**
 * Runs every registry entry against the same shared input, persists each
 * outcome as its own evaluations row (survivor or dropped -- a dropped
 * evaluator's raw_score is NULL, never 0, D3-04), links the pixelmatch
 * evaluator's diff image as a screenshots.role='diff' artifact (D3-07, the
 * one evaluator-specific branch in an otherwise fully-generic loop), and
 * writes the composite score onto the runs row only when at least one
 * evaluator survived (SCORE-02, Pitfall 5).
 */
export async function evaluateRun(input: EvaluateRunInput): Promise<EvaluateRunResult> {
  const sharedInput = {
    expectedPng: input.expectedPng,
    generatedPng: input.generatedPng,
    viewport: input.viewport,
    page: input.page,
  };

  const outcomes: EvaluatorOutcome[] = [];

  for (const evaluator of input.registry) {
    const result = await evaluator.evaluate(sharedInput);
    const detail = result.detail as { dropped?: boolean; reason?: unknown; diffPng?: Buffer } | null | undefined;

    if (detail?.dropped === true) {
      const reason = String(detail.reason ?? "unknown");
      insertEvaluation(input.db, input.runId, input.repIndex, evaluator.name, null, result.detail);
      outcomes.push({ evaluatorName: evaluator.name, dropped: true, reason });
      continue;
    }

    insertEvaluation(input.db, input.runId, input.repIndex, evaluator.name, result.rawScore, result.detail);
    outcomes.push({ evaluatorName: evaluator.name, rawScore: result.rawScore, dropped: false });

    if (evaluator.name === "pixelmatch" && detail?.diffPng) {
      linkDiffScreenshot(input.db, input.runId, detail.diffPng, input.viewport);
    }
  }

  const { compositeScore, weightsUsed } = composeScore(outcomes, input.defaultWeights ?? DEFAULT_EVALUATOR_WEIGHTS);
  if (compositeScore !== null) {
    updateRunComposite(input.db, input.runId, compositeScore, weightsUsed);
  }

  return { compositeScore, weightsUsed, outcomes };
}
