// SCORE-01/D3-01..D3-04: pure weighted-mean composite scorer, no I/O and no
// knowledge of which concrete evaluators exist — it only ever sees the
// EvaluatorOutcome[] array its caller (evaluateRun, 03-05-PLAN.md) constructs.
export const DEFAULT_EVALUATOR_WEIGHTS: Record<string, number> = {
  pixelmatch: 0.25,
  dom: 0.25,
  axe: 0.25,
  judge: 0.25,
};

export interface EvalResult {
  evaluatorName: string;
  rawScore: number;
  dropped: false;
}

export interface DroppedResult {
  evaluatorName: string;
  dropped: true;
  reason: string;
}

export type EvaluatorOutcome = EvalResult | DroppedResult;

export interface CompositeResult {
  /** null only when every evaluator dropped (D3-04 escalate to eval_error) — never 0 or NaN. */
  compositeScore: number | null;
  /** The renormalized weights actually applied — re-derivable from evaluations + this (D-21). */
  weightsUsed: Record<string, number>;
}

/**
 * Weighted mean over survivors only. A dropped evaluator's weight is never
 * counted as 0 — the survivors' weights are renormalized to sum to 1
 * (D3-01/D3-03). If every evaluator drops, short-circuits to null before any
 * division (Pitfall 5).
 */
export function composeScore(
  outcomes: EvaluatorOutcome[],
  defaultWeights: Record<string, number> = DEFAULT_EVALUATOR_WEIGHTS,
): CompositeResult {
  const survivors = outcomes.filter((o): o is EvalResult => !o.dropped);
  if (survivors.length === 0) return { compositeScore: null, weightsUsed: {} };

  const survivorWeightSum = survivors.reduce((sum, s) => sum + (defaultWeights[s.evaluatorName] ?? 0), 0);
  const weightsUsed: Record<string, number> = {};
  let compositeScore = 0;
  for (const s of survivors) {
    const w = (defaultWeights[s.evaluatorName] ?? 0) / survivorWeightSum;
    weightsUsed[s.evaluatorName] = w;
    compositeScore += s.rawScore * w;
  }
  return { compositeScore, weightsUsed };
}
