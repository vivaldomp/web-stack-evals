// EVAL-05/D3-09/D3-15/D3-16: the registry. A plain array-builder, not a
// plugin framework (03-RESEARCH.md Pattern 2) -- pixelmatch/axe/judge are
// unconditional (D3-16); dom is the ONLY conditional entry, included solely
// when the scenario declares a non-empty expectedElements list (D3-09).
// Adding a fifth evaluator means editing only this file (D3-15) --
// evaluate.ts stays unaware of how many/which evaluators exist.
import type Database from "better-sqlite3";
import type { Models } from "@earendil-works/pi-ai";
import type { EvaluatorPort } from "../core/ports.js";
import { createPixelMatchEvaluator } from "./pixelmatchEvaluator.js";
import { createJudgeEvaluator, DEFAULT_JUDGE_MODEL, type JudgeModelSpec } from "./judgeEvaluator.js";
import { createDomEvaluator } from "./domEvaluator.js";
import { createAxeEvaluator } from "./axeEvaluator.js";
import { lookupCachedJudgeVerdict } from "../storage/evaluations.js";

export interface RegistryDeps {
  db: Database.Database;
  models: Models;
  expectedElements?: string[];
  judgeModel?: JudgeModelSpec;
}

export function buildRegistry(deps: RegistryDeps): EvaluatorPort[] {
  const lookupCachedVerdict = (fingerprint: string) =>
    Promise.resolve(lookupCachedJudgeVerdict(deps.db, fingerprint));

  const evaluators: EvaluatorPort[] = [
    createPixelMatchEvaluator(),
    createAxeEvaluator(),
    createJudgeEvaluator(deps.models, deps.judgeModel ?? DEFAULT_JUDGE_MODEL, lookupCachedVerdict),
  ];

  if (deps.expectedElements && deps.expectedElements.length > 0) {
    evaluators.push(createDomEvaluator(deps.expectedElements));
  }

  return evaluators;
}
